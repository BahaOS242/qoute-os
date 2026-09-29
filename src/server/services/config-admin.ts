/**
 * Staff-facing configuration CRUD. Every function:
 *  - takes an OrgContext produced by authz (never an organization id from the client)
 *  - scopes reads and writes by ctx.organizationId (cross-tenant ids resolve to 404)
 *  - requires ADMIN for writes
 *  - writes an audit log entry
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  automationInput,
  leadRuleInput,
  messageTemplateInput,
  pricingRuleInput,
  questionInput,
  serviceInput,
} from "@/core/config/schema";
import { lintQuestions } from "@/core/questions";
import { validateSubmission } from "@/core/questions";
import { resolveQuoteOutcome } from "@/core/quote";
import { conditionFields } from "@/core/conditions";
import type { Answers } from "@/core/conditions";
import { prisma } from "../db";
import { badRequest, notFound } from "../errors";
import { audit } from "../audit";
import { assertRole, type OrgContext } from "../authz";
import { loadEngineConfig, toQuestionDef } from "./config-loader";

const nullableJson = (v: unknown) => (v === null || v === undefined ? ("DbNull" as const) : (v as Prisma.InputJsonValue));

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function listServices(ctx: OrgContext) {
  return prisma.service.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { _count: { select: { questions: true, pricingRules: true, quotes: true, leads: true } } },
  });
}

export async function getServiceDetail(ctx: OrgContext, serviceId: string) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, organizationId: ctx.organizationId },
    include: {
      questions: { include: { options: { orderBy: { order: "asc" } } }, orderBy: [{ order: "asc" }, { key: "asc" }] },
      pricingRules: { orderBy: [{ priority: "asc" }, { key: "asc" }] },
    },
  });
  if (!service) throw notFound("Service");
  const issues = lintQuestions(service.questions.map(toQuestionDef));
  const questionKeys = new Set(service.questions.map((q) => q.key));
  for (const r of service.pricingRules) {
    for (const f of conditionFields(r.condition)) {
      if (!questionKeys.has(f)) issues.push({ questionKey: r.key, message: `Pricing rule "${r.name}" references unknown question "${f}"` });
    }
  }
  return { service, issues };
}

async function ownedService(ctx: OrgContext, id: string) {
  const s = await prisma.service.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!s) throw notFound("Service");
  return s;
}

export async function createService(ctx: OrgContext, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const input = serviceInput.parse(raw);
  const service = await prisma.service.create({
    data: { ...input, description: input.description ?? null, icon: input.icon ?? null, organizationId: ctx.organizationId },
  });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "service.create", entityType: "Service", entityId: service.id, after: service });
  return service;
}

export async function updateService(ctx: OrgContext, id: string, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const before = await ownedService(ctx, id);
  const input = serviceInput.partial().parse(raw);
  const service = await prisma.service.update({ where: { id: before.id }, data: input });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "service.update", entityType: "Service", entityId: id, before, after: service });
  return service;
}

/** Services with quote history are deactivated rather than deleted. */
export async function deleteService(ctx: OrgContext, id: string) {
  assertRole(ctx, "ADMIN");
  const before = await ownedService(ctx, id);
  const quotes = await prisma.quote.count({ where: { serviceId: id } });
  if (quotes > 0) {
    await prisma.service.update({ where: { id }, data: { active: false } });
    await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "service.deactivate", entityType: "Service", entityId: id, before });
    return { deleted: false, deactivated: true };
  }
  await prisma.service.delete({ where: { id } });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "service.delete", entityType: "Service", entityId: id, before });
  return { deleted: true, deactivated: false };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

async function ownedQuestion(ctx: OrgContext, id: string) {
  const q = await prisma.question.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { options: true } });
  if (!q) throw notFound("Question");
  return q;
}

function questionData(input: Partial<z.infer<typeof questionInput>>) {
  const { options: _o, visibleWhen, config, ...rest } = input;
  return {
    ...rest,
    ...(config !== undefined ? { config: config as Prisma.InputJsonValue } : {}),
    ...(visibleWhen !== undefined ? { visibleWhen: nullableJson(visibleWhen) } : {}),
  };
}

async function replaceOptions(questionId: string, options: z.infer<typeof questionInput>["options"]) {
  const values = options.map((o) => o.value);
  if (new Set(values).size !== values.length) throw badRequest("Option values must be unique");
  await prisma.questionOption.deleteMany({ where: { questionId } });
  if (options.length) {
    await prisma.questionOption.createMany({
      data: options.map((o, i) => ({ questionId, label: o.label, value: o.value, order: i, metadata: o.description ? { description: o.description } : {} })),
    });
  }
}

export async function createQuestion(ctx: OrgContext, serviceId: string, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const service = await ownedService(ctx, serviceId);
  const input = questionInput.parse(raw);
  const max = await prisma.question.aggregate({ where: { serviceId: service.id }, _max: { order: true } });
  const q = await prisma.question.create({
    data: {
      ...questionData(input),
      key: input.key,
      label: input.label,
      type: input.type,
      order: (raw as { order?: number })?.order !== undefined ? input.order : (max._max.order ?? 0) + 10,
      organizationId: ctx.organizationId,
      serviceId: service.id,
    },
  });
  await replaceOptions(q.id, input.options);
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "question.create", entityType: "Question", entityId: q.id, after: input });
  return ownedQuestion(ctx, q.id);
}

export async function updateQuestion(ctx: OrgContext, id: string, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const before = await ownedQuestion(ctx, id);
  const input = questionInput.partial().parse(raw);
  await prisma.question.update({ where: { id }, data: questionData(input) });
  if (input.options) await replaceOptions(id, input.options);
  const after = await ownedQuestion(ctx, id);
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "question.update", entityType: "Question", entityId: id, before, after });
  return after;
}

export async function deleteQuestion(ctx: OrgContext, id: string) {
  assertRole(ctx, "ADMIN");
  const before = await ownedQuestion(ctx, id);
  await prisma.question.delete({ where: { id } });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "question.delete", entityType: "Question", entityId: id, before });
  return { deleted: true };
}

export async function reorderQuestions(ctx: OrgContext, serviceId: string, orderedIds: string[]) {
  assertRole(ctx, "ADMIN");
  const service = await ownedService(ctx, serviceId);
  const existing = await prisma.question.findMany({ where: { serviceId: service.id, organizationId: ctx.organizationId }, select: { id: true } });
  const ids = new Set(existing.map((q) => q.id));
  if (orderedIds.length !== ids.size || orderedIds.some((id) => !ids.has(id))) {
    throw badRequest("Reorder must include every question of this service exactly once");
  }
  await prisma.$transaction(orderedIds.map((id, i) => prisma.question.update({ where: { id }, data: { order: (i + 1) * 10 } })));
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "question.reorder", entityType: "Service", entityId: service.id, after: orderedIds });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pricing rules
// ---------------------------------------------------------------------------

async function ownedRule(ctx: OrgContext, id: string) {
  const r = await prisma.pricingRule.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!r) throw notFound("Pricing rule");
  return r;
}

export async function createPricingRule(ctx: OrgContext, serviceId: string, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const service = await ownedService(ctx, serviceId);
  const input = pricingRuleInput.parse(raw);
  const rule = await prisma.pricingRule.create({
    data: {
      organizationId: ctx.organizationId,
      serviceId: service.id,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      priority: input.priority,
      condition: nullableJson(input.condition),
      action: input.action as Prisma.InputJsonValue,
      active: input.active,
    },
  });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "pricing_rule.create", entityType: "PricingRule", entityId: rule.id, after: rule });
  return rule;
}

export async function updatePricingRule(ctx: OrgContext, id: string, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const before = await ownedRule(ctx, id);
  const input = pricingRuleInput.partial().parse(raw);
  const { condition, action, ...rest } = input;
  const rule = await prisma.pricingRule.update({
    where: { id },
    data: {
      ...rest,
      ...(condition !== undefined ? { condition: nullableJson(condition) } : {}),
      ...(action !== undefined ? { action: action as Prisma.InputJsonValue } : {}),
    },
  });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "pricing_rule.update", entityType: "PricingRule", entityId: id, before, after: rule });
  return rule;
}

export async function deletePricingRule(ctx: OrgContext, id: string) {
  assertRole(ctx, "ADMIN");
  const before = await ownedRule(ctx, id);
  await prisma.pricingRule.delete({ where: { id } });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "pricing_rule.delete", entityType: "PricingRule", entityId: id, before });
  return { deleted: true };
}

/** Admin sandbox: run the live engine against sample answers without persisting anything. */
export async function previewQuote(ctx: OrgContext, serviceId: string, answers: Answers) {
  const service = await ownedService(ctx, serviceId);
  const { questions, rules } = await loadEngineConfig(ctx.organizationId, service.id);
  const submission = validateSubmission(questions, answers);
  const outcome = resolveQuoteOutcome({
    service: {
      quoteMode: service.quoteMode,
      basePriceCents: service.basePriceCents,
      minimumPriceCents: service.minimumPriceCents,
      estimateRangePercent: service.estimateRangePercent,
      currency: ctx.organization.currency,
    },
    rules,
    answers: submission.answers,
  });
  return { valid: submission.ok, errors: submission.errors, visibleQuestions: submission.visible.map((q) => q.key), outcome };
}

// ---------------------------------------------------------------------------
// Lead rules, message templates, automations (generic tenant-scoped CRUD)
// ---------------------------------------------------------------------------

export async function listLeadRules(ctx: OrgContext) {
  return prisma.leadRule.findMany({ where: { organizationId: ctx.organizationId }, orderBy: [{ priority: "asc" }, { name: "asc" }], include: { service: { select: { slug: true, name: true } } } });
}

async function resolveServiceSlug(ctx: OrgContext, slug: string | null | undefined) {
  if (!slug) return null;
  const s = await prisma.service.findFirst({ where: { organizationId: ctx.organizationId, slug } });
  if (!s) throw badRequest(`Unknown service "${slug}"`);
  return s.id;
}

export async function upsertLeadRule(ctx: OrgContext, id: string | null, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const input = leadRuleInput.parse(raw);
  const data = {
    name: input.name,
    serviceId: await resolveServiceSlug(ctx, input.serviceSlug),
    priority: input.priority,
    condition: nullableJson(input.condition),
    action: input.action as Prisma.InputJsonValue,
    active: input.active,
  };
  let rule;
  if (id) {
    const before = await prisma.leadRule.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw notFound("Lead rule");
    rule = await prisma.leadRule.update({ where: { id }, data });
  } else {
    rule = await prisma.leadRule.create({ data: { ...data, organizationId: ctx.organizationId } });
  }
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: id ? "lead_rule.update" : "lead_rule.create", entityType: "LeadRule", entityId: rule.id, after: rule });
  return rule;
}

export async function deleteLeadRule(ctx: OrgContext, id: string) {
  assertRole(ctx, "ADMIN");
  const r = await prisma.leadRule.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  if (!r.count) throw notFound("Lead rule");
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "lead_rule.delete", entityType: "LeadRule", entityId: id });
  return { deleted: true };
}

export async function listMessageTemplates(ctx: OrgContext) {
  return prisma.messageTemplate.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { key: "asc" } });
}

export async function upsertMessageTemplate(ctx: OrgContext, id: string | null, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const input = messageTemplateInput.parse(raw);
  const data = { key: input.key, channel: input.channel, name: input.name, subject: input.subject ?? null, body: input.body };
  let t;
  if (id) {
    const before = await prisma.messageTemplate.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw notFound("Template");
    t = await prisma.messageTemplate.update({ where: { id }, data });
  } else {
    t = await prisma.messageTemplate.create({ data: { ...data, organizationId: ctx.organizationId } });
  }
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: id ? "template.update" : "template.create", entityType: "MessageTemplate", entityId: t.id, after: t });
  return t;
}

export async function deleteMessageTemplate(ctx: OrgContext, id: string) {
  assertRole(ctx, "ADMIN");
  const r = await prisma.messageTemplate.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  if (!r.count) throw notFound("Template");
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "template.delete", entityType: "MessageTemplate", entityId: id });
  return { deleted: true };
}

export async function listAutomations(ctx: OrgContext) {
  const [automations, runs] = await Promise.all([
    prisma.automation.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" } }),
    prisma.automationRun.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 12, include: { automation: { select: { name: true } } } }),
  ]);
  return { automations, runs };
}

export async function upsertAutomation(ctx: OrgContext, id: string | null, raw: unknown) {
  assertRole(ctx, "ADMIN");
  const input = automationInput.parse(raw);
  const data = {
    name: input.name,
    trigger: input.trigger,
    condition: nullableJson(input.condition),
    actions: input.actions as Prisma.InputJsonValue,
    active: input.active,
  };
  let a;
  if (id) {
    const before = await prisma.automation.findFirst({ where: { id, organizationId: ctx.organizationId } });
    if (!before) throw notFound("Automation");
    a = await prisma.automation.update({ where: { id }, data });
  } else {
    a = await prisma.automation.create({ data: { ...data, organizationId: ctx.organizationId } });
  }
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: id ? "automation.update" : "automation.create", entityType: "Automation", entityId: a.id, after: a });
  return a;
}

export async function deleteAutomation(ctx: OrgContext, id: string) {
  assertRole(ctx, "ADMIN");
  const r = await prisma.automation.deleteMany({ where: { id, organizationId: ctx.organizationId } });
  if (!r.count) throw notFound("Automation");
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "automation.delete", entityType: "Automation", entityId: id });
  return { deleted: true };
}
