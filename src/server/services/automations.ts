/**
 * Trigger/action automation engine.
 *
 * Automations are data (Automation rows). The engine resolves the trigger context, evaluates the
 * optional condition, and executes each action through provider interfaces. Failures are
 * recorded (AutomationRun + AUTOMATION_FAILED event) and never break the visitor's request.
 *
 * Execution is inline for the MVP; `dispatchAutomations` is the seam where a job queue goes.
 */
import type { AutomationTrigger, MessageChannel, Prisma } from "@prisma/client";
import { evaluateCondition } from "@/core/conditions";
import { automationActionSchema, type AutomationAction } from "@/core/config/schema";
import { buildLeadContext } from "@/core/leads";
import { formatEstimate, titleCase } from "@/lib/format";
import { prisma } from "../db";
import { recordEvent } from "../events";
import { getProviders } from "../providers";
import { renderTemplate, textToHtml, type TemplateVars } from "../messaging/render";

export interface AutomationTriggerInput {
  organizationId: string;
  trigger: AutomationTrigger;
  leadId?: string | null;
  quoteSessionId?: string | null;
  extra?: TemplateVars;
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";

async function loadContext(input: AutomationTriggerInput) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
  const lead = input.leadId
    ? await prisma.lead.findFirst({
        where: { id: input.leadId, organizationId: org.id },
        include: { owner: true, service: true, quote: true },
      })
    : null;
  const session = input.quoteSessionId
    ? await prisma.quoteSession.findFirst({
        where: { id: input.quoteSessionId, organizationId: org.id },
        include: { service: true, quote: true },
      })
    : lead?.quoteSessionId
      ? await prisma.quoteSession.findFirst({ where: { id: lead.quoteSessionId }, include: { service: true, quote: true } })
      : null;

  const quote = lead?.quote ?? session?.quote ?? null;
  const serviceName = lead?.service?.name ?? session?.service?.name ?? "";
  const estimate = quote
    ? (formatEstimate({ ...quote, currency: quote.currency }) ?? "Personalized review")
    : lead?.estimatedValueCents != null
      ? formatEstimate({ estimatedPriceCents: lead.estimatedValueCents, currency: lead.currency, billingPeriod: lead.billingPeriod })
      : "";
  const bookingUrl = lead
    ? getProviders().calendar.bookingUrl({ baseUrl: org.bookingUrl, name: lead.name, email: lead.email, leadId: lead.id })
    : org.bookingUrl;

  const vars: TemplateVars = {
    "org.name": org.name,
    "lead.name": lead?.name,
    "lead.firstName": lead?.name.split(/\s+/)[0],
    "lead.company": lead?.company,
    "lead.email": lead?.email,
    "lead.phone": lead?.phone,
    "lead.status": lead ? titleCase(lead.status) : undefined,
    "lead.intent": lead ? titleCase(lead.intent) : undefined,
    "lead.source": lead?.source ?? session?.source ?? "Direct",
    "lead.campaign": lead?.campaign ?? session?.campaign,
    "lead.urgency": lead?.urgency,
    "lead.summary": lead?.summary,
    "service.name": serviceName,
    "quote.estimate": estimate,
    bookingUrl: bookingUrl ?? "",
    dashboardUrl: lead ? `${appUrl()}/dashboard/${org.slug}/leads/${lead.id}` : `${appUrl()}/dashboard/${org.slug}`,
    ...input.extra,
  };

  const answers = ((session?.answers ?? {}) as Record<string, unknown>) || {};
  const conditionContext = buildLeadContext(answers, {
    service: lead?.service?.slug ?? session?.service?.slug ?? "",
    estimatedValueCents: lead?.estimatedValueCents ?? quote?.estimatedPriceCents ?? null,
    source: lead?.source ?? session?.source,
    medium: lead?.medium ?? session?.medium,
    campaign: lead?.campaign ?? session?.campaign,
    quoteMode: quote?.quoteMode ?? session?.service?.quoteMode ?? "",
  });
  if (lead) {
    Object.assign(conditionContext, { $status: lead.status, $intent: lead.intent, $score: lead.score });
  }
  return { org, lead, session, vars, conditionContext };
}

type Ctx = Awaited<ReturnType<typeof loadContext>>;

async function staffEmails(ctx: Ctx): Promise<string[]> {
  if (ctx.org.notificationEmail) return [ctx.org.notificationEmail];
  const admins = await prisma.membership.findMany({
    where: { organizationId: ctx.org.id, role: { in: ["OWNER", "ADMIN"] } },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  if (admins.length) return admins.map((m) => m.user.email);
  return ctx.org.contactEmail ? [ctx.org.contactEmail] : [];
}

async function resolveEmailRecipients(to: string, ctx: Ctx): Promise<string[]> {
  if (to === "lead") return ctx.lead ? [ctx.lead.email] : [];
  if (to === "owner") return ctx.lead?.owner ? [ctx.lead.owner.email] : staffEmails(ctx);
  if (to === "staff") return staffEmails(ctx);
  return [to];
}

function resolvePhone(to: string, ctx: Ctx): string | null {
  if (to === "lead") return ctx.lead?.phone ?? null;
  if (to === "staff" || to === "owner") return ctx.org.contactPhone ?? null;
  return null;
}

async function loadTemplate(ctx: Ctx, key: string, channel: MessageChannel) {
  const t = await prisma.messageTemplate.findFirst({ where: { organizationId: ctx.org.id, key } });
  if (!t) throw new Error(`Message template "${key}" not found`);
  if (t.channel !== channel) throw new Error(`Template "${key}" is a ${t.channel} template, not ${channel}`);
  return t;
}

async function sendEmail(ctx: Ctx, to: string, subject: string, text: string) {
  const provider = getProviders().email;
  const res = await provider.send({
    to,
    subject,
    text,
    html: textToHtml(text),
    fromName: ctx.org.name,
    replyTo: ctx.org.contactEmail ?? undefined,
  });
  await prisma.outboundMessage.create({
    data: {
      organizationId: ctx.org.id,
      leadId: ctx.lead?.id ?? null,
      channel: "EMAIL",
      provider: provider.name,
      to,
      subject,
      body: text,
      status: res.status,
      providerId: res.id,
    },
  });
  return res;
}

/** The staff notification described in the product brief (used when no template is given). */
export function defaultStaffNotification(vars: TemplateVars, needsReview: boolean) {
  const heading = needsReview ? "New lead needs review" : "New qualified lead";
  const lines = [
    heading,
    "",
    String(vars["lead.company"] || vars["lead.name"] || ""),
    String(vars["service.name"] ?? ""),
    "",
    "Estimated value:",
    String(vars["quote.estimate"] || "Personalized review"),
    "",
    "Source:",
    titleCase(String(vars["lead.source"] || "Direct")),
  ];
  if (vars["lead.urgency"]) lines.push("", "Urgency:", String(vars["lead.urgency"]));
  lines.push("", `Contact: ${vars["lead.name"] ?? ""} <${vars["lead.email"] ?? ""}> ${vars["lead.phone"] ?? ""}`.trim());
  lines.push("", `Open lead: ${vars.dashboardUrl}`);
  return {
    subject: `${heading}: ${vars["lead.company"] || vars["lead.name"]} – ${vars["service.name"]}`,
    text: lines.join("\n"),
  };
}

async function executeAction(action: AutomationAction, ctx: Ctx): Promise<Record<string, unknown>> {
  const leadId = ctx.lead?.id ?? null;
  const base = { organizationId: ctx.org.id, leadId, quoteSessionId: ctx.session?.id ?? null };
  switch (action.type) {
    case "SEND_EMAIL":
    case "BOOKING_LINK": {
      const to = action.type === "BOOKING_LINK" ? "lead" : action.to;
      if (action.type === "BOOKING_LINK" && !ctx.vars.bookingUrl) return { skipped: "no booking URL configured" };
      const recipients = await resolveEmailRecipients(to, ctx);
      if (!recipients.length) return { skipped: "no recipient" };
      const t = await loadTemplate(ctx, action.templateKey, "EMAIL");
      const subject = renderTemplate(t.subject ?? t.name, ctx.vars);
      const text = renderTemplate(t.body, ctx.vars);
      for (const r of recipients) await sendEmail(ctx, r, subject, text);
      await recordEvent({ ...base, type: "EMAIL_SENT", payload: { template: t.key, to: recipients, action: action.type } });
      return { sent: recipients.length, template: t.key };
    }
    case "SEND_WHATSAPP":
    case "SEND_SMS": {
      const channel = action.type === "SEND_WHATSAPP" ? "WHATSAPP" : "SMS";
      const phone = action.to.includes("@") ? null : resolvePhone(action.to, ctx);
      if (!phone) return { skipped: "no phone number" };
      const t = await loadTemplate(ctx, action.templateKey, channel);
      const body = renderTemplate(t.body, ctx.vars);
      const provider = channel === "WHATSAPP" ? getProviders().whatsapp : getProviders().sms;
      const res = await provider.send({ to: phone, body });
      await prisma.outboundMessage.create({
        data: { organizationId: ctx.org.id, leadId, channel, provider: provider.name, to: phone, body, status: res.status, providerId: res.id },
      });
      await recordEvent({ ...base, type: channel === "WHATSAPP" ? "WHATSAPP_SENT" : "SMS_SENT", payload: { template: t.key, status: res.status } });
      return { status: res.status, provider: provider.name };
    }
    case "CREATE_TASK": {
      const task = await prisma.task.create({
        data: {
          organizationId: ctx.org.id,
          leadId,
          assigneeId: ctx.lead?.ownerId ?? null,
          title: renderTemplate(action.title, ctx.vars),
          dueAt: action.dueInHours !== undefined ? new Date(Date.now() + action.dueInHours * 3_600_000) : null,
        },
      });
      await recordEvent({ ...base, type: "TASK_CREATED", payload: { taskId: task.id, title: task.title } });
      return { taskId: task.id };
    }
    case "NOTIFY_USER": {
      const recipients = await resolveEmailRecipients("owner", ctx);
      if (!recipients.length) return { skipped: "no staff recipient" };
      let subject: string;
      let text: string;
      if (action.templateKey) {
        const t = await loadTemplate(ctx, action.templateKey, "EMAIL");
        subject = renderTemplate(t.subject ?? t.name, ctx.vars);
        text = renderTemplate(t.body, ctx.vars);
      } else {
        ({ subject, text } = defaultStaffNotification(ctx.vars, ctx.lead?.status === "NEEDS_REVIEW"));
      }
      for (const r of recipients) await sendEmail(ctx, r, subject, text);
      await recordEvent({ ...base, type: "NOTIFICATION_SENT", payload: { to: recipients } });
      return { notified: recipients };
    }
    case "CREATE_CRM_RECORD": {
      if (!ctx.lead) return { skipped: "no lead" };
      const crm = getProviders().crm;
      const r = await crm.upsertContact({
        leadId: ctx.lead.id,
        organizationId: ctx.org.id,
        name: ctx.lead.name,
        email: ctx.lead.email,
        phone: ctx.lead.phone,
        company: ctx.lead.company,
        service: ctx.lead.service?.name,
        estimatedValueCents: ctx.lead.estimatedValueCents,
        source: ctx.lead.source,
      });
      await recordEvent({ ...base, type: "CRM_RECORD_CREATED", payload: { provider: crm.name, externalId: r.externalId } });
      return { externalId: r.externalId, provider: crm.name };
    }
  }
}

export interface AutomationRunSummary {
  automationId: string;
  name: string;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED";
  results: unknown[];
  error?: string;
}

export async function runAutomations(input: AutomationTriggerInput): Promise<AutomationRunSummary[]> {
  const automations = await prisma.automation.findMany({
    where: { organizationId: input.organizationId, trigger: input.trigger, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!automations.length) return [];
  let ctx: Ctx;
  try {
    ctx = await loadContext(input);
  } catch (e) {
    console.error("[automations] failed to load context", e);
    return [];
  }
  const summaries: AutomationRunSummary[] = [];
  for (const a of automations) {
    const summary: AutomationRunSummary = { automationId: a.id, name: a.name, status: "SUCCEEDED", results: [] };
    try {
      if (!evaluateCondition(a.condition ?? null, ctx.conditionContext)) {
        summary.status = "SKIPPED";
      } else {
        const actions = Array.isArray(a.actions) ? a.actions : [];
        for (const raw of actions) {
          const parsed = automationActionSchema.safeParse(raw);
          if (!parsed.success) {
            summary.results.push({ error: "invalid action" });
            continue;
          }
          summary.results.push({ type: parsed.data.type, ...(await executeAction(parsed.data, ctx)) });
        }
      }
    } catch (e) {
      summary.status = "FAILED";
      summary.error = (e as Error).message;
      await recordEvent({
        organizationId: input.organizationId,
        type: "AUTOMATION_FAILED",
        leadId: input.leadId ?? null,
        quoteSessionId: input.quoteSessionId ?? null,
        payload: { automation: a.name, error: summary.error },
      }).catch(() => undefined);
    }
    if (summary.status !== "SKIPPED") {
      await prisma.automationRun.create({
        data: {
          organizationId: input.organizationId,
          automationId: a.id,
          trigger: input.trigger,
          leadId: input.leadId ?? null,
          quoteSessionId: input.quoteSessionId ?? ctx.session?.id ?? null,
          status: summary.status,
          results: summary.results as Prisma.InputJsonValue,
          error: summary.error ?? null,
        },
      });
    }
    summaries.push(summary);
  }
  return summaries;
}

/** Seam for moving execution to a queue later; today it runs inline and swallows errors. */
export async function dispatchAutomations(inputs: AutomationTriggerInput[]) {
  const out: AutomationRunSummary[] = [];
  for (const i of inputs) {
    try {
      out.push(...(await runAutomations(i)));
    } catch (e) {
      console.error("[automations] dispatch failed", e);
    }
  }
  return out;
}

/**
 * Guarantee for the human-review path: if an organization has no active NEEDS_REVIEW
 * automation, staff are still notified with the default notification.
 */
export async function ensureReviewNotification(organizationId: string, leadId: string) {
  const configured = await prisma.automation.count({ where: { organizationId, trigger: "NEEDS_REVIEW", active: true } });
  if (configured) return;
  const ctx = await loadContext({ organizationId, trigger: "NEEDS_REVIEW", leadId });
  await executeAction({ type: "NOTIFY_USER" }, ctx);
}
