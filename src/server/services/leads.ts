/** Lead management for staff. All access is scoped by the caller's organization. */
import type { LeadStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { formatEstimate } from "@/lib/format";
import { prisma } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { recordEvent } from "../events";
import { getProviders } from "../providers";
import type { OrgContext } from "../authz";
import { dispatchAutomations } from "./automations";
import type { AnswerSnapshotItem, ServiceSnapshot } from "./quote-flow";

export const LEAD_STATUSES = ["NEW", "NEEDS_REVIEW", "CONTACTED", "QUALIFIED", "PROPOSAL_SENT", "WON", "LOST", "DISQUALIFIED"] as const;

export const leadFiltersSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  serviceId: z.string().max(40).optional(),
  source: z.string().max(100).optional(),
  ownerId: z.string().max(60).optional(),
  q: z.string().max(100).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listLeads(ctx: OrgContext, filters: z.infer<typeof leadFiltersSchema>) {
  const where: Prisma.LeadWhereInput = {
    organizationId: ctx.organizationId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId === "unassigned" ? null : filters.ownerId } : {}),
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: "insensitive" } },
            { company: { contains: filters.q, mode: "insensitive" } },
            { email: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.take,
      skip: filters.skip,
      include: { service: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } },
    }),
    prisma.lead.count({ where }),
  ]);
  return { items, total };
}

export async function getLeadDetail(ctx: OrgContext, id: string) {
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      service: true,
      owner: { select: { id: true, name: true, email: true } },
      quote: true,
      quoteSession: true,
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      tasks: { orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }] },
      appointments: { orderBy: { startsAt: "asc" } },
      messages: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!lead) throw notFound("Lead");
  const events = await prisma.event.findMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [{ leadId: lead.id }, ...(lead.quoteSessionId ? [{ quoteSessionId: lead.quoteSessionId }] : [])],
    },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const members = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return {
    lead,
    events,
    members: members.map((m) => m.user),
    answers: (lead.quote?.answersSnapshot ?? []) as unknown as AnswerSnapshotItem[],
    serviceSnapshot: (lead.quote?.serviceSnapshot ?? null) as unknown as ServiceSnapshot | null,
  };
}

async function ownedLead(ctx: OrgContext, id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!lead) throw notFound("Lead");
  return lead;
}

export const updateLeadSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().max(60).nullable().optional(),
});

/** Staff can change status and owner. Estimated value and attribution are not editable. */
export async function updateLead(ctx: OrgContext, id: string, input: z.infer<typeof updateLeadSchema>) {
  const before = await ownedLead(ctx, id);
  const data: Prisma.LeadUncheckedUpdateInput = {};
  if (input.ownerId !== undefined && input.ownerId !== before.ownerId) {
    if (input.ownerId) {
      const member = await prisma.membership.findFirst({ where: { organizationId: ctx.organizationId, userId: input.ownerId } });
      if (!member) throw badRequest("Owner must be a member of this organization");
    }
    data.ownerId = input.ownerId;
  }
  if (input.status && input.status !== before.status) data.status = input.status;
  if (!Object.keys(data).length) return before;

  const lead = await prisma.lead.update({ where: { id }, data });
  if (data.status) {
    await recordEvent({ organizationId: ctx.organizationId, type: "LEAD_STATUS_CHANGED", leadId: id, userId: ctx.userId, payload: { from: before.status, to: lead.status } });
  }
  if (data.ownerId !== undefined) {
    await recordEvent({ organizationId: ctx.organizationId, type: "LEAD_ASSIGNED", leadId: id, userId: ctx.userId, payload: { from: before.ownerId, to: lead.ownerId } });
  }
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "lead.update", entityType: "Lead", entityId: id, before: { status: before.status, ownerId: before.ownerId }, after: { status: lead.status, ownerId: lead.ownerId } });
  if (data.status) await dispatchAutomations([{ organizationId: ctx.organizationId, trigger: "LEAD_STATUS_CHANGED", leadId: id, extra: { "lead.previousStatus": before.status } }]);
  return lead;
}

export async function addNote(ctx: OrgContext, id: string, body: string) {
  const lead = await ownedLead(ctx, id);
  const text = body.trim();
  if (!text || text.length > 5000) throw badRequest("Note must be 1-5000 characters");
  const note = await prisma.leadNote.create({ data: { leadId: lead.id, authorId: ctx.userId, body: text } });
  await recordEvent({ organizationId: ctx.organizationId, type: "NOTE_ADDED", leadId: lead.id, userId: ctx.userId, payload: { noteId: note.id } });
  return note;
}

/** Record that the client accepted the quote. Only status fields change - never the price. */
export async function markQuoteAccepted(ctx: OrgContext, leadId: string) {
  const lead = await ownedLead(ctx, leadId);
  if (!lead.quoteId) throw badRequest("This lead has no quote");
  const quote = await prisma.quote.findFirstOrThrow({ where: { id: lead.quoteId, organizationId: ctx.organizationId } });
  if (quote.status === "ACCEPTED") throw conflict("Quote already accepted");
  await prisma.quote.update({ where: { id: quote.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
  await recordEvent({ organizationId: ctx.organizationId, type: "QUOTE_ACCEPTED", leadId, quoteId: quote.id, userId: ctx.userId });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "quote.accept", entityType: "Quote", entityId: quote.id });
  return { ok: true };
}

export async function regenerateSummary(ctx: OrgContext, leadId: string) {
  const { lead, answers, serviceSnapshot } = await getLeadDetail(ctx, leadId);
  const summary = await getProviders().ai.summarizeLead({
    organizationName: ctx.organization.name,
    company: lead.company,
    contactName: lead.name,
    serviceName: serviceSnapshot?.name ?? lead.service?.name ?? "services",
    answers: answers.map((a) => ({ label: a.label, display: a.display })),
    estimate: lead.quote ? formatEstimate(lead.quote) : null,
    urgency: lead.urgency,
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { summary: summary.slice(0, 2000) } });
  return { summary };
}

export async function completeTask(ctx: OrgContext, taskId: string, completed: boolean) {
  const task = await prisma.task.findFirst({ where: { id: taskId, organizationId: ctx.organizationId } });
  if (!task) throw notFound("Task");
  return prisma.task.update({ where: { id: task.id }, data: { completedAt: completed ? new Date() : null } });
}

/** Record a consultation (from the booking webhook or manually by staff). Idempotent per externalId. */
export async function bookAppointment(
  organizationId: string,
  input: { leadId: string | null; startsAt: Date; provider: string; externalId: string | null; userId?: string | null },
) {
  if (input.externalId) {
    const existing = await prisma.appointment.findFirst({ where: { organizationId, provider: input.provider, externalId: input.externalId } });
    if (existing) return { appointment: existing, duplicate: true };
  }
  const appointment = await prisma.appointment.create({
    data: { organizationId, leadId: input.leadId, provider: input.provider, externalId: input.externalId, startsAt: input.startsAt },
  });
  await recordEvent({
    organizationId,
    type: "CONSULTATION_BOOKED",
    leadId: input.leadId,
    userId: input.userId ?? null,
    payload: { appointmentId: appointment.id, startsAt: input.startsAt.toISOString(), provider: input.provider },
  });
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, organizationId } });
    if (lead && (lead.status === "NEW" || lead.status === "NEEDS_REVIEW")) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "CONTACTED" } });
      await recordEvent({ organizationId, type: "LEAD_STATUS_CHANGED", leadId: lead.id, payload: { from: lead.status, to: "CONTACTED", reason: "consultation booked" } });
    }
  }
  await dispatchAutomations([{ organizationId, trigger: "APPOINTMENT_BOOKED", leadId: input.leadId }]);
  return { appointment, duplicate: false };
}

export const manualAppointmentSchema = z.object({ startsAt: z.coerce.date() });

export async function recordManualAppointment(ctx: OrgContext, leadId: string, input: z.infer<typeof manualAppointmentSchema>) {
  const lead = await ownedLead(ctx, leadId);
  const r = await bookAppointment(ctx.organizationId, { leadId: lead.id, startsAt: input.startsAt, provider: "manual", externalId: null, userId: ctx.userId });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "appointment.create", entityType: "Appointment", entityId: r.appointment.id });
  return r.appointment;
}

export type LeadStatusValue = LeadStatus;
