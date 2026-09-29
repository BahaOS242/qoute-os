/**
 * Portable quote configuration ("QuoteConfig").
 *
 * The same JSON shape is used for:
 *  - configuration export / import
 *  - vertical recipes (src/recipes)
 *  - AI configuration proposals (validated here before an admin can approve them)
 *
 * It references things by stable keys/slugs, never database IDs, so it can be applied to any
 * organization.
 */
import { z } from "zod";
import { conditionFields, validateCondition } from "../conditions";
import { pricingActionSchema, validatePricingRule } from "../pricing";
import { lintQuestions, QUESTION_TYPES } from "../questions";
import { leadRuleActionSchema } from "../leads";
import { QUOTE_MODES, BILLING_PERIODS } from "../quote";

export const CONFIG_VERSION = 1;

const slug = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes");
const key = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Use letters, numbers and underscores, starting with a letter");

const conditionField = z.unknown().nullable().optional().superRefine((v, ctx) => {
  const r = validateCondition(v ?? null);
  if (!r.ok) ctx.addIssue({ code: "custom", message: r.error });
});

export const questionConfigSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().max(30).optional(),
    placeholder: z.string().max(120).optional(),
    maxLength: z.number().int().positive().max(5000).optional(),
  })
  .strict();

export const LEAD_FIELDS = ["industry", "urgency", "company"] as const;

export const questionOptionInput = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
});

export const questionInput = z.object({
  key,
  label: z.string().min(1).max(200),
  description: z.string().max(500).nullish(),
  helpText: z.string().max(500).nullish(),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean().default(true),
  order: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
  config: questionConfigSchema.default({}),
  visibleWhen: conditionField,
  leadField: z.enum(LEAD_FIELDS).nullish(),
  options: z.array(questionOptionInput).max(50).default([]),
});
export type QuestionInput = z.infer<typeof questionInput>;

export const pricingRuleInput = z.object({
  key,
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  priority: z.number().int().min(0).max(100_000).default(100),
  condition: conditionField,
  action: pricingActionSchema,
  active: z.boolean().default(true),
});
export type PricingRuleInput = z.infer<typeof pricingRuleInput>;

export const serviceInput = z.object({
  slug,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullish(),
  inclusions: z.array(z.string().max(200)).max(20).default([]),
  assumptions: z.array(z.string().max(300)).max(20).default([]),
  active: z.boolean().default(true),
  quoteMode: z.enum(QUOTE_MODES).default("INSTANT"),
  basePriceCents: z.number().int().min(0).max(1_000_000_000).default(0),
  minimumPriceCents: z.number().int().min(0).max(1_000_000_000).nullish(),
  billingPeriod: z.enum(BILLING_PERIODS).default("ONE_TIME"),
  estimateRangePercent: z.number().int().min(0).max(90).nullish(),
  order: z.number().int().min(0).max(10_000).default(0),
  icon: z.string().max(40).nullish(),
});
export type ServiceInput = z.infer<typeof serviceInput>;

export const serviceConfigSchema = serviceInput.extend({
  questions: z.array(questionInput).max(100).default([]),
  pricingRules: z.array(pricingRuleInput).max(200).default([]),
});
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export const leadRuleInput = z.object({
  name: z.string().min(1).max(120),
  serviceSlug: slug.nullish(),
  priority: z.number().int().min(0).max(100_000).default(100),
  condition: conditionField,
  action: leadRuleActionSchema,
  active: z.boolean().default(true),
});
export type LeadRuleInput = z.infer<typeof leadRuleInput>;

export const MESSAGE_CHANNELS = ["EMAIL", "WHATSAPP", "SMS"] as const;
export const messageTemplateInput = z.object({
  key,
  channel: z.enum(MESSAGE_CHANNELS),
  name: z.string().min(1).max(120),
  subject: z.string().max(200).nullish(),
  body: z.string().min(1).max(10_000),
});
export type MessageTemplateInput = z.infer<typeof messageTemplateInput>;

export const AUTOMATION_TRIGGERS = [
  "QUOTE_COMPLETED",
  "LEAD_CREATED",
  "HIGH_VALUE_LEAD",
  "NEEDS_REVIEW",
  "QUOTE_ABANDONED",
  "APPOINTMENT_BOOKED",
  "LEAD_STATUS_CHANGED",
] as const;
export type AutomationTriggerKey = (typeof AUTOMATION_TRIGGERS)[number];

/** Recipient: the lead, the org's staff notification address, the lead owner, or a literal email. */
const recipient = z.union([z.enum(["lead", "staff", "owner"]), z.string().email()]);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("SEND_EMAIL"), to: recipient, templateKey: key }),
  z.object({ type: z.literal("SEND_WHATSAPP"), to: recipient, templateKey: key }),
  z.object({ type: z.literal("SEND_SMS"), to: recipient, templateKey: key }),
  z.object({
    type: z.literal("CREATE_TASK"),
    title: z.string().min(1).max(200),
    dueInHours: z.number().int().min(0).max(24 * 90).optional(),
  }),
  z.object({ type: z.literal("NOTIFY_USER"), templateKey: key.optional() }),
  z.object({ type: z.literal("CREATE_CRM_RECORD") }),
  z.object({ type: z.literal("BOOKING_LINK"), templateKey: key }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationInput = z.object({
  name: z.string().min(1).max(120),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  condition: conditionField,
  actions: z.array(automationActionSchema).min(1).max(10),
  active: z.boolean().default(true),
});
export type AutomationInput = z.infer<typeof automationInput>;

export const organizationSettingsInput = z.object({
  brand: z
    .object({
      primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      headline: z.string().max(160).optional(),
      subheadline: z.string().max(400).optional(),
      trustPoints: z.array(z.string().max(120)).max(6).optional(),
    })
    .optional(),
  templateKey: z.string().max(40).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  highValueThresholdCents: z.number().int().min(0).nullish(),
  quoteValidityDays: z.number().int().min(1).max(365).optional(),
});

export const quoteConfigSchema = z.object({
  version: z.literal(CONFIG_VERSION).default(CONFIG_VERSION),
  organization: organizationSettingsInput.optional(),
  services: z.array(serviceConfigSchema).max(100).default([]),
  leadRules: z.array(leadRuleInput).max(200).default([]),
  messageTemplates: z.array(messageTemplateInput).max(100).default([]),
  automations: z.array(automationInput).max(100).default([]),
});
export type QuoteConfig = z.infer<typeof quoteConfigSchema>;

export interface ConfigValidation {
  ok: boolean;
  config?: QuoteConfig;
  errors: string[];
  warnings: string[];
}

/**
 * Parse + cross-validate a config. Errors block import/approval; warnings are shown to the admin.
 */
export function validateQuoteConfig(input: unknown): ConfigValidation {
  const parsed = quoteConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
      warnings: [],
    };
  }
  const config = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  const slugs = new Set<string>();
  for (const s of config.services) {
    if (slugs.has(s.slug)) errors.push(`Duplicate service slug "${s.slug}"`);
    slugs.add(s.slug);

    for (const issue of lintQuestions(s.questions)) {
      const msg = `${s.slug}.${issue.questionKey}: ${issue.message}`;
      if (issue.message.startsWith("Duplicate")) errors.push(msg);
      else warnings.push(msg);
    }
    const qKeys = new Set(s.questions.map((q) => q.key));
    const ruleKeys = new Set<string>();
    for (const r of s.pricingRules) {
      if (ruleKeys.has(r.key)) errors.push(`${s.slug}: duplicate pricing rule key "${r.key}"`);
      ruleKeys.add(r.key);
      const err = validatePricingRule(r);
      if (err) errors.push(`${s.slug}.${r.key}: ${err}`);
      for (const f of conditionFields(r.condition)) {
        if (!qKeys.has(f)) warnings.push(`${s.slug}.${r.key}: condition references unknown question "${f}"`);
      }
      if (r.action.type === "PER_UNIT" && !qKeys.has(r.action.field)) {
        warnings.push(`${s.slug}.${r.key}: per-unit field "${r.action.field}" is not a question`);
      }
    }
    if ((s.quoteMode === "HUMAN_REVIEW" || s.quoteMode === "CONTACT_ONLY") && s.pricingRules.length) {
      warnings.push(`${s.slug}: pricing rules are ignored for ${s.quoteMode} services`);
    }
  }
  for (const r of config.leadRules) {
    if (r.serviceSlug && !slugs.has(r.serviceSlug)) warnings.push(`Lead rule "${r.name}" references unknown service "${r.serviceSlug}"`);
  }
  const templateKeys = new Set(config.messageTemplates.map((t) => t.key));
  for (const a of config.automations) {
    for (const act of a.actions) {
      if ("templateKey" in act && act.templateKey && !templateKeys.has(act.templateKey)) {
        warnings.push(`Automation "${a.name}" uses template "${act.templateKey}" which is not in this config`);
      }
    }
  }
  return { ok: errors.length === 0, config, errors, warnings };
}
