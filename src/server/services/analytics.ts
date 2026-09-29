/**
 * Funnel analytics computed from the append-only Event table and real Lead rows.
 * Revenue figures only include leads/quotes with an actual stored value - nothing is inferred.
 */
import type { BillingPeriod, EventType } from "@prisma/client";
import { prisma } from "../db";
import type { OrgContext } from "../authz";

const OPEN_STATUSES = ["NEW", "NEEDS_REVIEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT"] as const;
const QUALIFIED_STATUSES = ["QUALIFIED", "PROPOSAL_SENT", "WON"] as const;

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

export async function getAnalytics(ctx: OrgContext, opts: { days?: number } = {}) {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 365);
  const since = new Date(Date.now() - days * 86_400_000);
  const orgId = ctx.organizationId;

  const countEvents = (type: EventType) => prisma.event.count({ where: { organizationId: orgId, type, createdAt: { gte: since } } });

  const [visitorRows, views, starts, completions, abandoned, leadsCreated, appointments] = await Promise.all([
    prisma.event.findMany({
      where: { organizationId: orgId, type: "QUOTE_VIEWED", createdAt: { gte: since }, visitorId: { not: null } },
      distinct: ["visitorId"],
      select: { visitorId: true },
    }),
    countEvents("QUOTE_VIEWED"),
    countEvents("QUOTE_STARTED"),
    countEvents("QUOTE_COMPLETED"),
    countEvents("QUOTE_ABANDONED"),
    countEvents("LEAD_CREATED"),
    countEvents("CONSULTATION_BOOKED"),
  ]);
  const visitors = visitorRows.length;

  const leadWhere = { organizationId: orgId, createdAt: { gte: since } };
  const [qualifiedLeads, pipelineRows, wonRows, byService, bySource, services, recentLeads] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, OR: [{ intent: "HIGH" }, { status: { in: [...QUALIFIED_STATUSES] } }] } }),
    prisma.lead.groupBy({
      by: ["billingPeriod", "currency"],
      where: { ...leadWhere, status: { in: [...OPEN_STATUSES] }, estimatedValueCents: { not: null } },
      _sum: { estimatedValueCents: true },
      _count: true,
    }),
    prisma.lead.groupBy({
      by: ["billingPeriod", "currency"],
      where: { ...leadWhere, status: "WON", estimatedValueCents: { not: null } },
      _sum: { estimatedValueCents: true },
      _count: true,
    }),
    prisma.lead.groupBy({ by: ["serviceId"], where: leadWhere, _count: true, _sum: { estimatedValueCents: true } }),
    prisma.lead.groupBy({ by: ["source"], where: leadWhere, _count: true }),
    prisma.service.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
    prisma.lead.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { service: { select: { name: true } } },
    }),
  ]);
  const startsByService = await prisma.event.groupBy({
    by: ["serviceId"],
    where: { organizationId: orgId, type: "QUOTE_COMPLETED", createdAt: { gte: since } },
    _count: true,
  });
  const serviceName = new Map(services.map((s) => [s.id, s.name]));
  const completedMap = new Map(startsByService.map((r) => [r.serviceId, r._count]));

  const money = (rows: typeof pipelineRows) =>
    rows.map((r) => ({
      billingPeriod: r.billingPeriod as BillingPeriod | null,
      currency: r.currency,
      totalCents: r._sum.estimatedValueCents ?? 0,
      leads: r._count,
    }));

  // Daily series for the trend chart (leads + starts), bucketed in UTC.
  const series = await prisma.$queryRaw<{ day: Date; type: string; n: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, "type"::text AS type, COUNT(*)::bigint AS n
    FROM "Event"
    WHERE "organizationId" = ${orgId} AND "createdAt" >= ${since}
      AND "type" IN ('QUOTE_STARTED', 'QUOTE_COMPLETED', 'LEAD_CREATED')
    GROUP BY 1, 2 ORDER BY 1`;
  const byDay = new Map<string, { date: string; starts: number; completions: number; leads: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    byDay.set(d, { date: d, starts: 0, completions: 0, leads: 0 });
  }
  for (const row of series) {
    const d = new Date(row.day).toISOString().slice(0, 10);
    const b = byDay.get(d);
    if (!b) continue;
    if (row.type === "QUOTE_STARTED") b.starts = Number(row.n);
    if (row.type === "QUOTE_COMPLETED") b.completions = Number(row.n);
    if (row.type === "LEAD_CREATED") b.leads = Number(row.n);
  }

  return {
    days,
    funnel: { visitors, views, starts, completions, leads: leadsCreated, appointments, abandoned },
    rates: {
      startRate: rate(starts, visitors),
      completionRate: rate(completions, starts),
      leadRate: rate(leadsCreated, completions),
      conversionRate: rate(leadsCreated, visitors),
      appointmentRate: rate(appointments, leadsCreated),
    },
    qualifiedLeads,
    pipeline: money(pipelineRows),
    won: money(wonRows),
    topServices: byService
      .map((r) => ({
        serviceId: r.serviceId,
        name: r.serviceId ? (serviceName.get(r.serviceId) ?? "Deleted service") : "Unknown",
        leads: r._count,
        completions: completedMap.get(r.serviceId) ?? 0,
        valueCents: r._sum.estimatedValueCents ?? 0,
      }))
      .sort((a, b) => b.leads - a.leads),
    leadSources: bySource.map((r) => ({ source: r.source ?? "direct", leads: r._count })).sort((a, b) => b.leads - a.leads),
    series: [...byDay.values()],
    recentLeads,
  };
}
export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
