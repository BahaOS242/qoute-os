/**
 * Deterministic pricing engine.
 *
 * - Pure function of (service pricing config, rules, answers). No I/O, no randomness, no AI.
 * - All arithmetic in integer minor units (cents); multiplicative steps round half away from zero.
 * - Rules run in ascending `priority`, ties broken by `key`, so the same inputs always produce
 *   the same breakdown.
 * - Invalid rules never throw: they are skipped and reported in `warnings`.
 * - The returned calculation embeds a snapshot of every rule it evaluated, so a stored quote can
 *   always explain itself even after the live rules change.
 */
import { z } from "zod";
import { evaluateCondition, validateCondition, toNumber, describeCondition, type Answers } from "../conditions";

export const ENGINE_VERSION = 1;

export const PRICING_ACTION_TYPES = [
  "ADD",
  "SUBTRACT",
  "MULTIPLY",
  "SET",
  "PERCENTAGE",
  "PER_UNIT",
  "REQUIRE_REVIEW",
] as const;
export type PricingActionType = (typeof PRICING_ACTION_TYPES)[number];

const cents = z.number().int().min(0).max(1_000_000_000);

export const pricingActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD"), amountCents: cents }),
  z.object({ type: z.literal("SUBTRACT"), amountCents: cents }),
  z.object({ type: z.literal("SET"), amountCents: cents }),
  z.object({ type: z.literal("MULTIPLY"), factor: z.number().min(0).max(100) }),
  /** Percentage of the running total; negative values are discounts. */
  z.object({ type: z.literal("PERCENTAGE"), percent: z.number().min(-100).max(1000) }),
  /** amountCents × max(0, answers[field] − includedUnits), optionally capped at maxUnits billable units. */
  z.object({
    type: z.literal("PER_UNIT"),
    field: z.string().min(1),
    amountCents: cents,
    includedUnits: z.number().min(0).optional(),
    maxUnits: z.number().min(0).optional(),
  }),
  /** Routes the quote to a human instead of showing a price. */
  z.object({ type: z.literal("REQUIRE_REVIEW"), reason: z.string().max(300).optional() }),
]);
export type PricingAction = z.infer<typeof pricingActionSchema>;

export interface PricingRuleDef {
  key: string;
  name: string;
  priority: number;
  condition?: unknown;
  action: unknown;
  active?: boolean;
}

export interface ServicePricingDef {
  basePriceCents: number;
  minimumPriceCents?: number | null;
  currency: string;
}

export interface Adjustment {
  rule: string;
  ruleName: string;
  type: PricingActionType;
  description: string;
  amountCents: number;
  runningTotalCents: number;
}

export interface RuleSnapshot {
  key: string;
  name: string;
  priority: number;
  condition: unknown;
  action: unknown;
  matched: boolean;
}

export interface PriceCalculation {
  engineVersion: number;
  currency: string;
  basePriceCents: number;
  adjustments: Adjustment[];
  subtotalCents: number;
  minimumPriceCents: number | null;
  minimumApplied: boolean;
  totalCents: number;
  requiresReview: boolean;
  reviewReasons: string[];
  warnings: string[];
  rules: RuleSnapshot[];
  rulesFingerprint: string;
}

export function sortRules<T extends { priority: number; key: string }>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

/** Round half away from zero - symmetric for discounts and surcharges. */
function roundCents(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

export function formatMoney(centsValue: number, currency = "USD", opts: { decimals?: boolean } = {}): string {
  const showDecimals = opts.decimals ?? centsValue % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(centsValue / 100);
}

/** Human-readable description of a rule action ("Add $100", "Add 10%", ...). */
export function describeAction(action: unknown, currency = "USD", labels: Record<string, string> = {}): string {
  const parsed = pricingActionSchema.safeParse(action);
  if (!parsed.success) return "(invalid action)";
  const a = parsed.data;
  switch (a.type) {
    case "ADD":
      return `Add ${formatMoney(a.amountCents, currency)}`;
    case "SUBTRACT":
      return `Subtract ${formatMoney(a.amountCents, currency)}`;
    case "SET":
      return `Set price to ${formatMoney(a.amountCents, currency)}`;
    case "MULTIPLY":
      return `Multiply by ${a.factor}`;
    case "PERCENTAGE":
      return a.percent >= 0 ? `Add ${a.percent}%` : `Discount ${Math.abs(a.percent)}%`;
    case "PER_UNIT": {
      const label = labels[a.field] ?? a.field;
      const inc = a.includedUnits ? ` beyond the first ${a.includedUnits}` : "";
      const cap = a.maxUnits !== undefined ? ` (max ${a.maxUnits} units)` : "";
      return `Add ${formatMoney(a.amountCents, currency)} per ${label}${inc}${cap}`;
    }
    case "REQUIRE_REVIEW":
      return `Send to human review${a.reason ? `: ${a.reason}` : ""}`;
  }
}

/** "IF Monthly transactions > 250 THEN Add $100" */
export function describeRule(rule: PricingRuleDef, currency = "USD", labels: Record<string, string> = {}): string {
  return `IF ${describeCondition(rule.condition ?? null, labels)} THEN ${describeAction(rule.action, currency, labels)}`;
}

/** Validate a rule definition before it is stored. */
export function validatePricingRule(rule: { condition?: unknown; action: unknown }): string | null {
  const c = validateCondition(rule.condition ?? null);
  if (!c.ok) return c.error;
  const a = pricingActionSchema.safeParse(rule.action);
  if (!a.success) return `Invalid action: ${a.error.issues[0]?.message ?? "unknown"}`;
  return null;
}

/** Stable, dependency-free FNV-1a fingerprint of the rule set (browser + server safe). */
export function fingerprint(value: unknown): string {
  const s = stableStringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function calculatePrice(input: {
  service: ServicePricingDef;
  rules: PricingRuleDef[];
  answers: Answers;
}): PriceCalculation {
  const { service, answers } = input;
  const base = Math.max(0, Math.trunc(service.basePriceCents || 0));
  const rules = sortRules(input.rules.filter((r) => r.active !== false));
  const adjustments: Adjustment[] = [];
  const warnings: string[] = [];
  const reviewReasons: string[] = [];
  const snapshots: RuleSnapshot[] = [];
  let total = base;

  for (const rule of rules) {
    const snap: RuleSnapshot = {
      key: rule.key,
      name: rule.name,
      priority: rule.priority,
      condition: rule.condition ?? null,
      action: rule.action,
      matched: false,
    };
    snapshots.push(snap);

    const cond = validateCondition(rule.condition ?? null);
    if (!cond.ok) {
      warnings.push(`Rule "${rule.key}" skipped: ${cond.error}`);
      continue;
    }
    const parsed = pricingActionSchema.safeParse(rule.action);
    if (!parsed.success) {
      warnings.push(`Rule "${rule.key}" skipped: invalid action`);
      continue;
    }
    if (!evaluateCondition(cond.condition, answers)) continue;

    const action = parsed.data;
    let delta = 0;
    switch (action.type) {
      case "ADD":
        delta = action.amountCents;
        break;
      case "SUBTRACT":
        delta = -action.amountCents;
        break;
      case "SET":
        delta = action.amountCents - total;
        break;
      case "MULTIPLY":
        delta = roundCents(total * action.factor) - total;
        break;
      case "PERCENTAGE":
        delta = roundCents((total * action.percent) / 100);
        break;
      case "PER_UNIT": {
        const n = toNumber(answers[action.field]);
        if (n === null) {
          warnings.push(`Rule "${rule.key}" skipped: "${action.field}" is not a number`);
          continue;
        }
        let units = Math.max(0, n - (action.includedUnits ?? 0));
        if (action.maxUnits !== undefined) units = Math.min(units, action.maxUnits);
        delta = roundCents(units * action.amountCents);
        break;
      }
      case "REQUIRE_REVIEW":
        snap.matched = true;
        reviewReasons.push(action.reason || rule.name);
        continue;
    }
    snap.matched = true;
    total += delta;
    adjustments.push({
      rule: rule.key,
      ruleName: rule.name,
      type: action.type,
      description: describeAction(action, service.currency),
      amountCents: delta,
      runningTotalCents: total,
    });
  }

  const subtotal = total;
  const minimum = service.minimumPriceCents ?? null;
  let finalTotal = Math.max(0, subtotal);
  if (subtotal < 0) warnings.push("Adjustments produced a negative total; clamped to zero");
  let minimumApplied = false;
  if (minimum !== null && finalTotal < minimum) {
    finalTotal = minimum;
    minimumApplied = true;
  }

  return {
    engineVersion: ENGINE_VERSION,
    currency: service.currency,
    basePriceCents: base,
    adjustments,
    subtotalCents: subtotal,
    minimumPriceCents: minimum,
    minimumApplied,
    totalCents: finalTotal,
    requiresReview: reviewReasons.length > 0,
    reviewReasons,
    warnings,
    rules: snapshots,
    rulesFingerprint: fingerprint({ base, minimum, rules: snapshots.map(({ matched: _m, ...r }) => r) }),
  };
}
