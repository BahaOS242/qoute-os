import { describe, expect, it } from "vitest";
import { resolveQuoteOutcome, outcomeHasPrice, type QuoteServiceDef } from "@/core/quote";
import { qualifyLead, buildLeadContext, intentFromScore } from "@/core/leads";
import { validateQuoteConfig } from "@/core/config/schema";
import type { PricingRuleDef } from "@/core/pricing";

const rules: PricingRuleDef[] = [
  { key: "always", name: "Always", priority: 1, action: { type: "ADD", amountCents: 10_000 } },
  {
    key: "review_big",
    name: "Big",
    priority: 2,
    condition: { field: "revenue", op: "gt", value: 1_000_000 },
    action: { type: "REQUIRE_REVIEW", reason: "Revenue above $1M" },
  },
];
const svc = (quoteMode: QuoteServiceDef["quoteMode"], extra: Partial<QuoteServiceDef> = {}): QuoteServiceDef => ({
  quoteMode,
  basePriceCents: 20_000,
  currency: "USD",
  ...extra,
});

describe("quote outcome", () => {
  it("INSTANT returns an exact price", () => {
    const o = resolveQuoteOutcome({ service: svc("INSTANT"), rules, answers: {} });
    expect(o.kind).toBe("PRICE");
    expect(outcomeHasPrice(o) && o.priceCents).toBe(30_000);
  });

  it("ESTIMATE returns a rounded range around the total", () => {
    const o = resolveQuoteOutcome({ service: svc("ESTIMATE", { estimateRangePercent: 10 }), rules, answers: {} });
    expect(o).toMatchObject({ kind: "RANGE", priceCents: 30_000, lowCents: 27_000, highCents: 33_000 });
  });

  it("HUMAN_REVIEW never produces a price, even with matching rules", () => {
    const o = resolveQuoteOutcome({ service: svc("HUMAN_REVIEW", { basePriceCents: 99_999 }), rules, answers: { revenue: 5 } });
    expect(o.kind).toBe("REVIEW");
    expect(outcomeHasPrice(o)).toBe(false);
    expect(o.calculation).toBeNull();
  });

  it("CONTACT_ONLY never produces a price", () => {
    const o = resolveQuoteOutcome({ service: svc("CONTACT_ONLY"), rules, answers: {} });
    expect(o.kind).toBe("CONTACT");
    expect(outcomeHasPrice(o)).toBe(false);
  });

  it("a REQUIRE_REVIEW rule downgrades an INSTANT quote to review (keeps calc for staff)", () => {
    const o = resolveQuoteOutcome({ service: svc("INSTANT"), rules, answers: { revenue: 2_000_000 } });
    expect(o.kind).toBe("REVIEW");
    expect(outcomeHasPrice(o)).toBe(false);
    if (o.kind === "REVIEW") {
      expect(o.reasons).toEqual(["Revenue above $1M"]);
      expect(o.calculation?.totalCents).toBe(30_000);
    }
  });
});

describe("lead qualification", () => {
  const leadRules = [
    { name: "High value", priority: 1, condition: { field: "$estimatedValue", op: "gte", value: 500 }, action: { type: "ADD_SCORE", points: 40 } },
    { name: "Payroll", priority: 2, condition: { field: "payroll", op: "eq", value: true }, action: { type: "ADD_SCORE", points: 20 } },
    { name: "Instagram tag", priority: 3, condition: { field: "$source", op: "eq", value: "instagram" }, action: { type: "TAG", tag: "social" } },
    { name: "Assign", priority: 4, condition: { field: "$service", op: "eq", value: "audit" }, action: { type: "ASSIGN_TO", email: "Partner@Firm.test" } },
    { name: "Review", priority: 5, condition: { field: "$service", op: "eq", value: "audit" }, action: { type: "NEEDS_REVIEW" } },
    { name: "Broken", priority: 6, condition: { field: "x", op: "gt", value: "y" }, action: { type: "ADD_SCORE", points: 1000 } },
  ];

  it("scores, tags and derives intent deterministically", () => {
    const ctx = buildLeadContext({ payroll: true }, { service: "bookkeeping", estimatedValueCents: 62_500, source: "instagram", quoteMode: "INSTANT" });
    const q = qualifyLead(leadRules, ctx);
    expect(q.score).toBe(60);
    expect(q.intent).toBe("HIGH");
    expect(q.tags).toEqual(["social"]);
    expect(q.needsReview).toBe(false);
    expect(q.matchedRules).toEqual(["High value", "Payroll", "Instagram tag"]);
  });

  it("routes and flags review", () => {
    const ctx = buildLeadContext({}, { service: "audit", estimatedValueCents: null, quoteMode: "HUMAN_REVIEW" });
    const q = qualifyLead(leadRules, ctx);
    expect(q.assignToEmail).toBe("partner@firm.test");
    expect(q.needsReview).toBe(true);
    expect(q.intent).toBe("LOW");
  });

  it("maps score to intent", () => {
    expect(intentFromScore(0)).toBe("LOW");
    expect(intentFromScore(20)).toBe("MEDIUM");
    expect(intentFromScore(50)).toBe("HIGH");
  });
});

describe("config schema", () => {
  it("accepts a valid config and rejects duplicates / invalid rules", () => {
    const good = validateQuoteConfig({
      services: [
        {
          slug: "bookkeeping",
          name: "Bookkeeping",
          basePriceCents: 25_000,
          questions: [{ key: "tx", label: "Transactions", type: "NUMBER" }],
          pricingRules: [{ key: "tx_high", name: "High", condition: { field: "tx", op: "gt", value: 250 }, action: { type: "ADD", amountCents: 100 } }],
        },
      ],
    });
    expect(good.ok).toBe(true);
    expect(good.warnings).toEqual([]);

    const bad = validateQuoteConfig({
      services: [
        { slug: "a", name: "A", pricingRules: [{ key: "r", name: "R", action: { type: "ADD", amountCents: 1 } }, { key: "r", name: "R2", action: { type: "ADD", amountCents: 1 } }] },
        { slug: "a", name: "A again" },
      ],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join("\n")).toMatch(/Duplicate service slug/);
    expect(bad.errors.join("\n")).toMatch(/duplicate pricing rule key/);

    const invalidCondition = validateQuoteConfig({
      services: [{ slug: "a", name: "A", pricingRules: [{ key: "r", name: "R", condition: { field: "x", op: "gt", value: "abc" }, action: { type: "ADD", amountCents: 1 } }] }],
    });
    expect(invalidCondition.ok).toBe(false);
  });

  it("warns about references to unknown questions", () => {
    const r = validateQuoteConfig({
      services: [{ slug: "a", name: "A", pricingRules: [{ key: "r", name: "R", condition: { field: "ghost", op: "exists" }, action: { type: "ADD", amountCents: 1 } }] }],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/unknown question "ghost"/);
  });
});
