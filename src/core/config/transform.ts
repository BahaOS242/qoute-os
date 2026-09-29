/**
 * Pure transforms used when cloning a recipe into a new client:
 *   Recipe + client branding + client pricing = new organization
 */
import type { QuoteConfig, ServiceConfig } from "./schema";

export interface ServicePricingOverride {
  basePriceCents?: number;
  minimumPriceCents?: number | null;
  active?: boolean;
  quoteMode?: ServiceConfig["quoteMode"];
}

export interface PricingCustomization {
  /** Scale every money amount (base prices, fixed adjustments, per-unit amounts) by this percent, e.g. 110 = +10%. */
  scalePercent?: number;
  /** Per-service overrides applied after scaling. */
  services?: Record<string, ServicePricingOverride>;
}

const scale = (cents: number, pct: number) => Math.max(0, Math.round((cents * pct) / 100 / 100) * 100);

export function customizePricing(config: QuoteConfig, custom: PricingCustomization = {}): QuoteConfig {
  const pct = custom.scalePercent ?? 100;
  const services = config.services.map((s) => {
    const scaled: ServiceConfig = {
      ...s,
      basePriceCents: scale(s.basePriceCents, pct),
      minimumPriceCents: s.minimumPriceCents == null ? s.minimumPriceCents : scale(s.minimumPriceCents, pct),
      pricingRules: s.pricingRules.map((r) => {
        const a = r.action;
        if (a.type === "ADD" || a.type === "SUBTRACT" || a.type === "SET" || a.type === "PER_UNIT") {
          return { ...r, action: { ...a, amountCents: scale(a.amountCents, pct) } };
        }
        return r;
      }),
    };
    const o = custom.services?.[s.slug];
    if (!o) return scaled;
    return {
      ...scaled,
      ...(o.basePriceCents !== undefined ? { basePriceCents: o.basePriceCents } : {}),
      ...(o.minimumPriceCents !== undefined ? { minimumPriceCents: o.minimumPriceCents } : {}),
      ...(o.active !== undefined ? { active: o.active } : {}),
      ...(o.quoteMode !== undefined ? { quoteMode: o.quoteMode } : {}),
    };
  });
  return { ...config, services };
}
