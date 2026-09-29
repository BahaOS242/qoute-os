/** Display helpers shared by server (emails, summaries) and client (templates, dashboard). */
import { formatMoney } from "@/core/pricing";
import { BILLING_SUFFIX, type BillingPeriod } from "@/core/quote";

export { formatMoney };

export function formatEstimate(q: {
  estimatedPriceCents?: number | null;
  rangeLowCents?: number | null;
  rangeHighCents?: number | null;
  currency: string;
  billingPeriod?: BillingPeriod | null;
}): string | null {
  if (q.estimatedPriceCents === null || q.estimatedPriceCents === undefined) return null;
  const suffix = q.billingPeriod ? BILLING_SUFFIX[q.billingPeriod] : "";
  if (q.rangeLowCents != null && q.rangeHighCents != null) {
    return `${formatMoney(q.rangeLowCents, q.currency)}–${formatMoney(q.rangeHighCents, q.currency)}${suffix}`;
  }
  return `${formatMoney(q.estimatedPriceCents, q.currency)}${suffix}`;
}

export const BILLING_LABEL: Record<BillingPeriod, string> = {
  ONE_TIME: "One-time",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};

export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[_\s-])(\w)/g, (_, sep: string, c: string) => (sep ? " " : "") + c.toUpperCase());
}

export function formatDateTime(d: Date | string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}
