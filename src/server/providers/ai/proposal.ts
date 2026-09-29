/**
 * Flat, LLM-friendly shape for configuration proposals, plus conversion to the canonical
 * QuoteConfig. Whatever an AI returns is converted and then re-validated by
 * validateQuoteConfig before an admin ever sees it; nothing is activated without approval.
 */
import { z } from "zod";
import type { Condition } from "@/core/conditions";
import type { ServiceConfig } from "@/core/config/schema";

export const aiProposalSchema = z.object({
  explanation: z.string(),
  service: z.object({
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    quoteMode: z.enum(["INSTANT", "ESTIMATE", "HUMAN_REVIEW", "CONTACT_ONLY"]),
    billingPeriod: z.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"]),
    basePriceCents: z.number().int(),
    minimumPriceCents: z.number().int().nullable(),
  }),
  questions: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      helpText: z.string().nullable(),
      type: z.enum(["SINGLE_SELECT", "MULTI_SELECT", "NUMBER", "CURRENCY", "TEXT", "BOOLEAN", "RANGE"]),
      required: z.boolean(),
      options: z.array(z.object({ label: z.string(), value: z.string() })),
      showIfQuestionKey: z.string().nullable(),
      showIfEquals: z.string().nullable(),
    }),
  ),
  pricingRules: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      priority: z.number().int(),
      conditionQuestionKey: z.string().nullable(),
      conditionOperator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "between"]).nullable(),
      conditionValue: z.string().nullable(),
      conditionValueMax: z.number().nullable(),
      actionType: z.enum(["ADD", "SUBTRACT", "MULTIPLY", "SET", "PERCENTAGE", "PER_UNIT", "REQUIRE_REVIEW"]),
      amountCents: z.number().int().nullable(),
      percent: z.number().nullable(),
      factor: z.number().nullable(),
      perUnitQuestionKey: z.string().nullable(),
      includedUnits: z.number().nullable(),
    }),
  ),
});
export type AiProposal = z.infer<typeof aiProposalSchema>;

function coerce(v: string | null): unknown {
  if (v === null) return null;
  if (v === "true" || v === "false") return v === "true";
  const n = Number(v);
  return v.trim() !== "" && Number.isFinite(n) ? n : v;
}

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "service";
const toKey = (s: string) => {
  const k = s.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]+/, "");
  return (k || "q").slice(0, 60);
};

/** Convert the flat AI shape into a canonical ServiceConfig (validated by the caller). */
export function aiProposalToServiceConfig(p: AiProposal): ServiceConfig {
  const questions = p.questions.map((q, i) => ({
    key: toKey(q.key),
    label: q.label,
    helpText: q.helpText,
    type: q.type,
    required: q.required,
    order: (i + 1) * 10,
    active: true,
    config: {},
    options: q.options.map((o) => ({ label: o.label, value: o.value })),
    visibleWhen: q.showIfQuestionKey
      ? ({ field: toKey(q.showIfQuestionKey), op: "eq", value: coerce(q.showIfEquals ?? "true") } as Condition)
      : null,
  }));

  const pricingRules = p.pricingRules.map((r) => {
    let condition: Condition | null = null;
    if (r.conditionQuestionKey && r.conditionOperator) {
      const field = toKey(r.conditionQuestionKey);
      condition =
        r.conditionOperator === "between"
          ? { field, op: "between", value: [coerce(r.conditionValue), r.conditionValueMax] }
          : { field, op: r.conditionOperator, value: coerce(r.conditionValue) };
    }
    const action =
      r.actionType === "MULTIPLY" ? { type: "MULTIPLY" as const, factor: r.factor ?? 1 }
      : r.actionType === "PERCENTAGE" ? { type: "PERCENTAGE" as const, percent: r.percent ?? 0 }
      : r.actionType === "REQUIRE_REVIEW" ? { type: "REQUIRE_REVIEW" as const, reason: r.name }
      : r.actionType === "PER_UNIT"
        ? {
            type: "PER_UNIT" as const,
            field: toKey(r.perUnitQuestionKey ?? r.conditionQuestionKey ?? "units"),
            amountCents: Math.max(0, r.amountCents ?? 0),
            ...(r.includedUnits ? { includedUnits: r.includedUnits } : {}),
          }
        : { type: r.actionType, amountCents: Math.max(0, r.amountCents ?? 0) };
    return {
      key: toKey(r.key),
      name: r.name,
      priority: r.priority,
      active: true,
      condition,
      action,
    };
  });

  return {
    slug: toSlug(p.service.slug || p.service.name),
    name: p.service.name,
    description: p.service.description,
    inclusions: [],
    assumptions: [],
    active: true,
    quoteMode: p.service.quoteMode,
    basePriceCents: Math.max(0, p.service.basePriceCents),
    minimumPriceCents: p.service.minimumPriceCents,
    billingPeriod: p.service.billingPeriod,
    order: 0,
    questions,
    pricingRules: pricingRules as ServiceConfig["pricingRules"],
  };
}
