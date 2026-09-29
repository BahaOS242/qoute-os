/**
 * Quote outcome resolution: the single place that decides whether a visitor sees a price.
 *
 * HUMAN_REVIEW and CONTACT_ONLY services never run the pricing engine and can never return a
 * price. INSTANT/ESTIMATE services are downgraded to review when a REQUIRE_REVIEW rule matches.
 */
import { calculatePrice, type PriceCalculation, type PricingRuleDef } from "../pricing";
import type { Answers } from "../conditions";

export const QUOTE_MODES = ["INSTANT", "ESTIMATE", "HUMAN_REVIEW", "CONTACT_ONLY"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];

export const BILLING_PERIODS = ["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const BILLING_SUFFIX: Record<BillingPeriod, string> = {
  ONE_TIME: "",
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  ANNUAL: "/year",
};

export interface QuoteServiceDef {
  quoteMode: QuoteMode;
  basePriceCents: number;
  minimumPriceCents?: number | null;
  estimateRangePercent?: number | null;
  currency: string;
}

export type QuoteOutcome =
  | { kind: "PRICE"; priceCents: number; calculation: PriceCalculation }
  | { kind: "RANGE"; priceCents: number; lowCents: number; highCents: number; calculation: PriceCalculation }
  | { kind: "REVIEW"; reasons: string[]; calculation: PriceCalculation | null }
  | { kind: "CONTACT"; calculation: null };

/** Round to whole currency units for displayed ranges. */
const roundToUnit = (c: number) => Math.round(c / 100) * 100;

export function resolveQuoteOutcome(input: {
  service: QuoteServiceDef;
  rules: PricingRuleDef[];
  answers: Answers;
}): QuoteOutcome {
  const { service } = input;
  if (service.quoteMode === "HUMAN_REVIEW") {
    return { kind: "REVIEW", reasons: ["This service requires a personalized review"], calculation: null };
  }
  if (service.quoteMode === "CONTACT_ONLY") return { kind: "CONTACT", calculation: null };

  const calculation = calculatePrice({
    service: { basePriceCents: service.basePriceCents, minimumPriceCents: service.minimumPriceCents, currency: service.currency },
    rules: input.rules,
    answers: input.answers,
  });

  // A rule asked for a human: keep the calculation for staff, but never show a price.
  if (calculation.requiresReview) return { kind: "REVIEW", reasons: calculation.reviewReasons, calculation };

  if (service.quoteMode === "ESTIMATE") {
    const pct = Math.max(0, Math.min(90, service.estimateRangePercent ?? 15));
    const low = roundToUnit((calculation.totalCents * (100 - pct)) / 100);
    const high = roundToUnit((calculation.totalCents * (100 + pct)) / 100);
    return { kind: "RANGE", priceCents: calculation.totalCents, lowCents: low, highCents: high, calculation };
  }
  return { kind: "PRICE", priceCents: calculation.totalCents, calculation };
}

/** Whether an outcome exposes a price to the visitor. */
export const outcomeHasPrice = (o: QuoteOutcome): o is Extract<QuoteOutcome, { priceCents: number }> =>
  o.kind === "PRICE" || o.kind === "RANGE";
