/**
 * Lead qualification & routing rules - deterministic, data-driven.
 *
 * Context fields available to conditions: every answer key plus the meta fields below.
 *   $service  $estimatedValue (major units)  $source  $medium  $campaign  $quoteMode  $hasPrice
 */
import { z } from "zod";
import { evaluateCondition, validateCondition, describeCondition, type Answers } from "../conditions";

export const LEAD_RULE_ACTIONS = ["ADD_SCORE", "SET_INTENT", "ASSIGN_TO", "NEEDS_REVIEW", "TAG"] as const;
export const LEAD_INTENTS = ["HIGH", "MEDIUM", "LOW"] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

export const leadRuleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ADD_SCORE"), points: z.number().int().min(-1000).max(1000) }),
  z.object({ type: z.literal("SET_INTENT"), intent: z.enum(LEAD_INTENTS) }),
  /** Assign by member email (portable across organizations/recipes). */
  z.object({ type: z.literal("ASSIGN_TO"), email: z.string().email() }),
  z.object({ type: z.literal("NEEDS_REVIEW"), reason: z.string().max(300).optional() }),
  z.object({ type: z.literal("TAG"), tag: z.string().min(1).max(50) }),
]);
export type LeadRuleAction = z.infer<typeof leadRuleActionSchema>;

export interface LeadRuleDef {
  name: string;
  priority: number;
  condition?: unknown;
  action: unknown;
  active?: boolean;
  serviceSlug?: string | null;
}

export interface LeadQualification {
  score: number;
  intent: LeadIntent;
  intentSource: "rule" | "score";
  assignToEmail: string | null;
  needsReview: boolean;
  reviewReasons: string[];
  tags: string[];
  matchedRules: string[];
}

export function buildLeadContext(answers: Answers, meta: {
  service: string;
  estimatedValueCents: number | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  quoteMode: string;
}): Answers {
  return {
    ...answers,
    $service: meta.service,
    $estimatedValue: meta.estimatedValueCents === null ? undefined : meta.estimatedValueCents / 100,
    $source: meta.source ?? undefined,
    $medium: meta.medium ?? undefined,
    $campaign: meta.campaign ?? undefined,
    $quoteMode: meta.quoteMode,
    $hasPrice: meta.estimatedValueCents !== null,
  };
}

/** Score thresholds used when no rule sets intent explicitly. */
export function intentFromScore(score: number): LeadIntent {
  if (score >= 50) return "HIGH";
  if (score >= 20) return "MEDIUM";
  return "LOW";
}

export function qualifyLead(rules: LeadRuleDef[], context: Answers): LeadQualification {
  const out: LeadQualification = {
    score: 0,
    intent: "MEDIUM",
    intentSource: "score",
    assignToEmail: null,
    needsReview: false,
    reviewReasons: [],
    tags: [],
    matchedRules: [],
  };
  let explicitIntent: LeadIntent | null = null;
  const sorted = [...rules]
    .filter((r) => r.active !== false)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const r of sorted) {
    if (!validateCondition(r.condition ?? null).ok) continue;
    const parsed = leadRuleActionSchema.safeParse(r.action);
    if (!parsed.success) continue;
    if (!evaluateCondition(r.condition ?? null, context)) continue;
    out.matchedRules.push(r.name);
    const a = parsed.data;
    if (a.type === "ADD_SCORE") out.score += a.points;
    else if (a.type === "SET_INTENT") explicitIntent = a.intent;
    else if (a.type === "ASSIGN_TO") out.assignToEmail ??= a.email.toLowerCase();
    else if (a.type === "NEEDS_REVIEW") {
      out.needsReview = true;
      out.reviewReasons.push(a.reason || r.name);
    } else if (a.type === "TAG" && !out.tags.includes(a.tag)) out.tags.push(a.tag);
  }
  if (explicitIntent) {
    out.intent = explicitIntent;
    out.intentSource = "rule";
  } else out.intent = intentFromScore(out.score);
  return out;
}

export function describeLeadRule(rule: LeadRuleDef, labels: Record<string, string> = {}): string {
  const parsed = leadRuleActionSchema.safeParse(rule.action);
  let action = "(invalid action)";
  if (parsed.success) {
    const a = parsed.data;
    action =
      a.type === "ADD_SCORE" ? `${a.points >= 0 ? "Add" : "Remove"} ${Math.abs(a.points)} points`
      : a.type === "SET_INTENT" ? `Set intent to ${a.intent}`
      : a.type === "ASSIGN_TO" ? `Assign to ${a.email}`
      : a.type === "NEEDS_REVIEW" ? "Mark as needs review"
      : `Tag "${a.tag}"`;
  }
  return `IF ${describeCondition(rule.condition ?? null, labels)} THEN ${action}`;
}
