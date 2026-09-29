import { describe, expect, it } from "vitest";
import { RECIPES, getRecipe } from "@/recipes";
import { validateQuoteConfig, quoteConfigSchema } from "@/core/config/schema";
import { customizePricing } from "@/core/config/transform";
import { resolveQuoteOutcome } from "@/core/quote";
import { validateSubmission } from "@/core/questions";

describe("recipes", () => {
  it("every available recipe is a valid config with no warnings", () => {
    for (const r of RECIPES.filter((r) => r.status === "available")) {
      const v = validateQuoteConfig(r.config);
      expect(v.errors, r.key).toEqual([]);
      expect(v.warnings, r.key).toEqual([]);
    }
  });

  it("accounting recipe covers every quote mode", () => {
    const cfg = quoteConfigSchema.parse(getRecipe("accounting")!.config);
    expect(new Set(cfg.services.map((s) => s.quoteMode))).toEqual(new Set(["INSTANT", "ESTIMATE", "HUMAN_REVIEW", "CONTACT_ONLY"]));
    expect(cfg.services.find((s) => s.slug === "audit")?.quoteMode).toBe("HUMAN_REVIEW");
  });

  it("prices a typical bookkeeping client deterministically", () => {
    const cfg = quoteConfigSchema.parse(getRecipe("accounting")!.config);
    const svc = cfg.services.find((s) => s.slug === "bookkeeping")!;
    const sub = validateSubmission(svc.questions, {
      monthlyTransactions: 340, bankAccounts: 3, payroll: true, employees: 8,
      accountingSoftware: "quickbooks", reportingFrequency: "quarterly", industry: "construction", timeline: "within_30_days",
    });
    expect(sub.ok).toBe(true);
    const o = resolveQuoteOutcome({ service: { ...svc, currency: "USD" }, rules: svc.pricingRules, answers: sub.answers });
    // 250 + 100 (tx) + 50 (accounts) + 100 (payroll) + 3 x 5 (employees over 5) = 515
    expect(o.kind === "PRICE" && o.priceCents).toBe(51_500);
  });

  it("customizes pricing when cloning for a client", () => {
    const cfg = quoteConfigSchema.parse(getRecipe("accounting")!.config);
    const custom = customizePricing(cfg, { scalePercent: 120, services: { audit: { active: false }, payroll: { basePriceCents: 9_900 } } });
    const bk = custom.services.find((s) => s.slug === "bookkeeping")!;
    expect(bk.basePriceCents).toBe(30_000);
    const rule = bk.pricingRules.find((r) => r.key === "transaction_volume")!;
    expect(rule.action).toEqual({ type: "ADD", amountCents: 12_000 });
    expect(custom.services.find((s) => s.slug === "audit")!.active).toBe(false);
    expect(custom.services.find((s) => s.slug === "payroll")!.basePriceCents).toBe(9_900);
    // original untouched
    expect(cfg.services.find((s) => s.slug === "bookkeeping")!.basePriceCents).toBe(25_000);
  });
});
