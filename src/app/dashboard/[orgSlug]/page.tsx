import Link from "next/link";
import { requireOrgPage } from "@/server/page-auth";
import { getAnalytics } from "@/server/services/analytics";
import { BarList, TrendChart } from "@/components/dashboard/charts";
import { Card, PageHeader, ButtonLink } from "@/components/ui";
import { StatusBadge } from "@/components/dashboard/badges";
import { formatMoney, titleCase, BILLING_LABEL } from "@/lib/format";
import { BILLING_SUFFIX } from "@/core/quote";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900 [overflow-wrap:anywhere]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default async function OverviewPage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ days?: string }> }) {
  const { orgSlug } = await params;
  const days = [7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const ctx = await requireOrgPage(orgSlug);
  const a = await getAnalytics(ctx, { days });
  const base = `/dashboard/${orgSlug}`;

  // Pipeline is summed per billing period; different periods are never added together.
  const order = ["MONTHLY", "QUARTERLY", "ANNUAL", "ONE_TIME"];
  const periods = [...a.pipeline].sort((x, y) => order.indexOf(x.billingPeriod ?? "ONE_TIME") - order.indexOf(y.billingPeriod ?? "ONE_TIME"));
  const fmtPeriod = (p: (typeof periods)[number]) =>
    `${formatMoney(p.totalCents, p.currency)}${p.billingPeriod && p.billingPeriod !== "ONE_TIME" ? BILLING_SUFFIX[p.billingPeriod] : " one-time"}`;
  const pipelineMain = periods[0] ? fmtPeriod(periods[0]) : "—";
  const pipelineSub = [...periods.slice(1).map((p) => `+ ${fmtPeriod(p)}`), `${a.pipeline.reduce((s, p) => s + p.leads, 0)} open leads with an estimate`].join(" · ");

  const f = a.funnel;
  const funnel = [
    { label: "Visitors", value: f.visitors, detail: [`${f.views} page views`] },
    { label: "Quotes started", value: f.starts, note: pct(a.rates.startRate), detail: [`${pct(a.rates.startRate)} of visitors`] },
    { label: "Quotes completed", value: f.completions, note: pct(a.rates.completionRate), detail: [`${pct(a.rates.completionRate)} of starts`, `${f.abandoned} abandoned`] },
    { label: "Leads", value: f.leads, note: pct(a.rates.leadRate), detail: [`${pct(a.rates.leadRate)} of completions`] },
    { label: "Consultations booked", value: f.appointments, note: pct(a.rates.appointmentRate), detail: [`${pct(a.rates.appointmentRate)} of leads`] },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Funnel performance for the last ${days} days. Values only include leads with a stored estimate - nothing is inferred.`}
        actions={[7, 30, 90].map((d) => (
          <ButtonLink key={d} href={`${base}?days=${d}`} variant={d === days ? "primary" : "secondary"}>
            {d} days
          </ButtonLink>
        ))}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Quotes started" value={f.starts.toLocaleString()} sub={`${f.visitors} visitors`} />
        <Stat label="Quotes completed" value={f.completions.toLocaleString()} sub={`${pct(a.rates.completionRate)} completion rate`} />
        <Stat label="Leads" value={f.leads.toLocaleString()} sub={`${a.qualifiedLeads} qualified · ${pct(a.rates.conversionRate)} of visitors`} />
        <Stat label="Estimated open pipeline" value={pipelineMain} sub={pipelineSub} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Card title="Daily activity">
          <TrendChart data={a.series} />
        </Card>
        <Card title="Conversion funnel">
          <BarList data={funnel} />
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Top services">
          <BarList
            data={a.topServices.map((s) => ({
              label: s.name,
              value: s.leads,
              note: s.valueCents ? formatMoney(s.valueCents, ctx.organization.currency) : undefined,
              detail: [`${s.completions} completed quotes`, `${s.leads} leads`, s.valueCents ? `${formatMoney(s.valueCents, ctx.organization.currency)} estimated value` : "No priced value"],
            }))}
            emptyLabel="No leads yet"
          />
        </Card>
        <Card title="Lead sources">
          <BarList data={a.leadSources.map((s) => ({ label: titleCase(s.source), value: s.leads, detail: [`${s.leads} leads`] }))} emptyLabel="No leads yet" />
        </Card>
        <Card title="Recent leads" actions={<Link href={`${base}/leads`} className="text-xs font-medium text-slate-500 hover:text-slate-900">View all →</Link>} padded={false}>
          <ul className="divide-y divide-slate-100">
            {a.recentLeads.map((l) => (
              <li key={l.id}>
                <Link href={`${base}/leads/${l.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">{l.company || l.name}</span>
                    <span className="block text-xs text-slate-500">
                      {l.service?.name ?? "—"} · {l.estimatedValueCents !== null ? `${formatMoney(l.estimatedValueCents, l.currency)}${l.billingPeriod ? BILLING_SUFFIX[l.billingPeriod] : ""}` : "Review"}
                    </span>
                  </span>
                  <StatusBadge status={l.status} />
                </Link>
              </li>
            ))}
            {!a.recentLeads.length && <li className="px-5 py-8 text-center text-sm text-slate-400">No leads yet - share your quote page to get started.</li>}
          </ul>
        </Card>
      </div>
      {a.won.length > 0 && (
        <p className="mt-6 text-xs text-slate-500">
          Won (estimated at quote time): {a.won.map((w) => `${formatMoney(w.totalCents, w.currency)} ${w.billingPeriod ? BILLING_LABEL[w.billingPeriod].toLowerCase() : ""}`).join(" · ")}
        </p>
      )}
    </>
  );
}
