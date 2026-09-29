/**
 * Apply / export portable QuoteConfig documents.
 *
 * Used by: JSON import, vertical recipes (client cloning), AI proposal approval and the seed.
 *
 * Modes
 *  - "merge":   upsert everything in the document (by slug/key/name); leave other config alone
 *  - "replace": as merge, then remove questions/rules/lead rules/automations that are not in
 *               the document and deactivate services that are not in it (services are never
 *               deleted so historical quotes keep their links; quotes keep snapshots anyway)
 */
import type { Prisma } from "@prisma/client";
import { validateQuoteConfig, type QuoteConfig, type ServiceConfig } from "@/core/config/schema";
import { prisma, type Tx } from "../db";
import { badRequest } from "../errors";
import { audit } from "../audit";

export type ApplyMode = "merge" | "replace";

export interface ApplyResult {
  services: { slug: string; created: boolean }[];
  warnings: string[];
}

const json = (v: unknown) => (v === null || v === undefined ? undefined : (v as Prisma.InputJsonValue));
const nullableJson = (v: unknown) => (v === null || v === undefined ? ("DbNull" as const) : (v as Prisma.InputJsonValue));

async function applyService(tx: Tx, organizationId: string, s: ServiceConfig, mode: ApplyMode) {
  const existing = await tx.service.findUnique({ where: { organizationId_slug: { organizationId, slug: s.slug } } });
  const data = {
    name: s.name,
    description: s.description ?? null,
    inclusions: s.inclusions,
    assumptions: s.assumptions,
    active: s.active,
    quoteMode: s.quoteMode,
    basePriceCents: s.basePriceCents,
    minimumPriceCents: s.minimumPriceCents ?? null,
    billingPeriod: s.billingPeriod,
    estimateRangePercent: s.estimateRangePercent ?? null,
    order: s.order,
    icon: s.icon ?? null,
  };
  const service = existing
    ? await tx.service.update({ where: { id: existing.id }, data })
    : await tx.service.create({ data: { ...data, organizationId, slug: s.slug } });

  for (const q of s.questions) {
    const qData = {
      label: q.label,
      description: q.description ?? null,
      helpText: q.helpText ?? null,
      type: q.type,
      required: q.required,
      order: q.order,
      active: q.active,
      config: q.config as Prisma.InputJsonValue,
      visibleWhen: q.visibleWhen == null ? ("DbNull" as const) : (q.visibleWhen as Prisma.InputJsonValue),
      leadField: q.leadField ?? null,
    };
    const question = await tx.question.upsert({
      where: { serviceId_key: { serviceId: service.id, key: q.key } },
      create: { ...qData, organizationId, serviceId: service.id, key: q.key },
      update: qData,
    });
    await tx.questionOption.deleteMany({ where: { questionId: question.id } });
    if (q.options.length) {
      await tx.questionOption.createMany({
        data: q.options.map((o, i) => ({
          questionId: question.id,
          label: o.label,
          value: o.value,
          order: i,
          metadata: o.description ? { description: o.description } : {},
        })),
      });
    }
  }

  for (const r of s.pricingRules) {
    const rData = {
      name: r.name,
      description: r.description ?? null,
      priority: r.priority,
      condition: nullableJson(r.condition),
      action: r.action as Prisma.InputJsonValue,
      active: r.active,
    };
    await tx.pricingRule.upsert({
      where: { serviceId_key: { serviceId: service.id, key: r.key } },
      create: { ...rData, organizationId, serviceId: service.id, key: r.key },
      update: rData,
    });
  }

  if (mode === "replace") {
    await tx.question.deleteMany({ where: { serviceId: service.id, key: { notIn: s.questions.map((q) => q.key) } } });
    await tx.pricingRule.deleteMany({ where: { serviceId: service.id, key: { notIn: s.pricingRules.map((r) => r.key) } } });
  }
  return { slug: s.slug, created: !existing };
}

/** Validate and apply a config document to an organization inside one transaction. */
export async function applyQuoteConfig(
  organizationId: string,
  input: unknown,
  opts: { mode: ApplyMode; actorId?: string | null; auditAction?: string },
): Promise<ApplyResult> {
  const validation = validateQuoteConfig(input);
  if (!validation.ok || !validation.config) throw badRequest("Configuration is invalid", { errors: validation.errors });
  const config = validation.config;

  const result = await prisma.$transaction(
    async (tx) => {
      if (config.organization) {
        const o = config.organization;
        const current = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
        await tx.organization.update({
          where: { id: organizationId },
          data: {
            brand: o.brand ? ({ ...(current.brand as object), ...o.brand } as Prisma.InputJsonValue) : undefined,
            templateKey: o.templateKey,
            currency: o.currency,
            timezone: o.timezone,
            highValueThresholdCents: o.highValueThresholdCents,
            quoteValidityDays: o.quoteValidityDays,
            glossary: json(o.glossary),
          },
        });
      }

      const services: ApplyResult["services"] = [];
      for (const s of config.services) services.push(await applyService(tx, organizationId, s, opts.mode));
      if (opts.mode === "replace") {
        await tx.service.updateMany({
          where: { organizationId, slug: { notIn: config.services.map((s) => s.slug) } },
          data: { active: false },
        });
      }

      const slugToId = new Map(
        (await tx.service.findMany({ where: { organizationId }, select: { id: true, slug: true } })).map((s) => [s.slug, s.id]),
      );

      if (opts.mode === "replace") await tx.leadRule.deleteMany({ where: { organizationId } });
      for (const r of config.leadRules) {
        const data = {
          name: r.name,
          serviceId: r.serviceSlug ? (slugToId.get(r.serviceSlug) ?? null) : null,
          priority: r.priority,
          condition: nullableJson(r.condition),
          action: r.action as Prisma.InputJsonValue,
          active: r.active,
        };
        const existing = opts.mode === "merge" ? await tx.leadRule.findFirst({ where: { organizationId, name: r.name } }) : null;
        if (existing) await tx.leadRule.update({ where: { id: existing.id }, data });
        else await tx.leadRule.create({ data: { ...data, organizationId } });
      }

      for (const t of config.messageTemplates) {
        const data = { channel: t.channel, name: t.name, subject: t.subject ?? null, body: t.body };
        await tx.messageTemplate.upsert({
          where: { organizationId_key: { organizationId, key: t.key } },
          create: { ...data, organizationId, key: t.key },
          update: data,
        });
      }

      if (opts.mode === "replace") await tx.automation.deleteMany({ where: { organizationId } });
      for (const a of config.automations) {
        const data = {
          name: a.name,
          trigger: a.trigger,
          condition: nullableJson(a.condition),
          actions: a.actions as Prisma.InputJsonValue,
          active: a.active,
        };
        const existing = opts.mode === "merge" ? await tx.automation.findFirst({ where: { organizationId, name: a.name } }) : null;
        if (existing) await tx.automation.update({ where: { id: existing.id }, data });
        else await tx.automation.create({ data: { ...data, organizationId } });
      }

      await audit(
        {
          organizationId,
          actorId: opts.actorId ?? null,
          action: opts.auditAction ?? "config.import",
          entityType: "QuoteConfig",
          after: { mode: opts.mode, services: services.map((s) => s.slug), leadRules: config.leadRules.length, automations: config.automations.length },
        },
        tx,
      );
      return services;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return { services: result, warnings: validation.warnings };
}

/** Export an organization's configuration as a portable QuoteConfig document. */
export async function exportQuoteConfig(organizationId: string): Promise<QuoteConfig> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const services = await prisma.service.findMany({
    where: { organizationId },
    orderBy: [{ order: "asc" }, { slug: "asc" }],
    include: {
      questions: { include: { options: { orderBy: { order: "asc" } } }, orderBy: [{ order: "asc" }, { key: "asc" }] },
      pricingRules: { orderBy: [{ priority: "asc" }, { key: "asc" }] },
    },
  });
  const idToSlug = new Map(services.map((s) => [s.id, s.slug]));
  const [leadRules, templates, automations] = await Promise.all([
    prisma.leadRule.findMany({ where: { organizationId }, orderBy: [{ priority: "asc" }, { name: "asc" }] }),
    prisma.messageTemplate.findMany({ where: { organizationId }, orderBy: { key: "asc" } }),
    prisma.automation.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }),
  ]);
  const brand = org.brand as Record<string, unknown>;

  const doc = {
    version: 1,
    organization: {
      brand: {
        primaryColor: brand.primaryColor,
        accentColor: brand.accentColor,
        headline: brand.headline,
        subheadline: brand.subheadline,
        trustPoints: brand.trustPoints,
      },
      templateKey: org.templateKey,
      currency: org.currency,
      timezone: org.timezone,
      highValueThresholdCents: org.highValueThresholdCents,
      quoteValidityDays: org.quoteValidityDays,
      glossary: org.glossary,
    },
    services: services.map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      inclusions: s.inclusions,
      assumptions: s.assumptions,
      active: s.active,
      quoteMode: s.quoteMode,
      basePriceCents: s.basePriceCents,
      minimumPriceCents: s.minimumPriceCents,
      billingPeriod: s.billingPeriod,
      estimateRangePercent: s.estimateRangePercent,
      order: s.order,
      icon: s.icon,
      questions: s.questions.map((q) => ({
        key: q.key,
        label: q.label,
        description: q.description,
        helpText: q.helpText,
        type: q.type,
        required: q.required,
        order: q.order,
        active: q.active,
        config: q.config,
        visibleWhen: q.visibleWhen ?? null,
        leadField: q.leadField,
        options: q.options.map((o) => ({
          label: o.label,
          value: o.value,
          ...((o.metadata as { description?: string })?.description ? { description: (o.metadata as { description: string }).description } : {}),
        })),
      })),
      pricingRules: s.pricingRules.map((r) => ({
        key: r.key,
        name: r.name,
        description: r.description,
        priority: r.priority,
        condition: r.condition ?? null,
        action: r.action,
        active: r.active,
      })),
    })),
    leadRules: leadRules.map((r) => ({
      name: r.name,
      serviceSlug: r.serviceId ? (idToSlug.get(r.serviceId) ?? null) : null,
      priority: r.priority,
      condition: r.condition ?? null,
      action: r.action,
      active: r.active,
    })),
    messageTemplates: templates.map((t) => ({ key: t.key, channel: t.channel, name: t.name, subject: t.subject, body: t.body })),
    automations: automations.map((a) => ({ name: a.name, trigger: a.trigger, condition: a.condition ?? null, actions: a.actions, active: a.active })),
  };
  // Strip undefined brand keys so the document round-trips through validation.
  doc.organization.brand = Object.fromEntries(Object.entries(doc.organization.brand).filter(([, v]) => v !== undefined && v !== null)) as typeof doc.organization.brand;
  const v = validateQuoteConfig(doc);
  if (!v.ok || !v.config) throw new Error(`Exported config failed validation: ${v.errors.join("; ")}`);
  return v.config;
}
