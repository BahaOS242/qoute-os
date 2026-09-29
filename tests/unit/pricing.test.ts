import { describe, expect, it } from "vitest";
import { calculatePrice, describeRule, validatePricingRule, type PricingRuleDef } from "@/core/pricing";

const service = { basePriceCents: 25_000, currency: "USD" };

const bookkeepingRules: PricingRuleDef[] = [
  {
    key: "transaction_volume",
    name: "Transaction volume",
    priority: 10,
    condition: { field: "monthlyTransactions", op: "gt", value: 250 },
    action: { type: "ADD", amountCents: 10_000 },
  },
  {
    key: "bank_accounts",
    name: "Bank accounts",
    priority: 20,
    condition: { field: "bankAccounts", op: "between", value: [2, 3] },
    action: { type: "ADD", amountCents: 5_000 },
  },
  {
    key: "payroll",
    name: "Payroll",
    priority: 30,
    condition: { field: "payroll", op: "eq", value: true },
    action: { type: "ADD", amountCents: 10_000 },
  },
];

describe("pricing engine", () => {
  it("returns the base price when no rules match", () => {
    const calc = calculatePrice({ service, rules: bookkeepingRules, answers: { monthlyTransactions: 10 } });
    expect(calc.basePriceCents).toBe(25_000);
    expect(calc.adjustments).toHaveLength(0);
    expect(calc.totalCents).toBe(25_000);
    expect(calc.requiresReview).toBe(false);
  });

  it("reproduces the brief's bookkeeping example ($250 + $100 + $50 + $100 = $500)", () => {
    const calc = calculatePrice({
      service,
      rules: bookkeepingRules,
      answers: { monthlyTransactions: 340, bankAccounts: 3, employees: 8, payroll: true, accountingSoftware: "quickbooks" },
    });
    expect(calc.adjustments.map((a) => [a.rule, a.amountCents])).toEqual([
      ["transaction_volume", 10_000],
      ["bank_accounts", 5_000],
      ["payroll", 10_000],
    ]);
    expect(calc.subtotalCents).toBe(50_000);
    expect(calc.totalCents).toBe(50_000);
    expect(calc.currency).toBe("USD");
    expect(calc.adjustments.at(-1)?.runningTotalCents).toBe(50_000);
  });

  it("applies rules in priority order regardless of input order, ties broken by key", () => {
    const rules: PricingRuleDef[] = [
      { key: "b_double", name: "Double", priority: 20, action: { type: "MULTIPLY", factor: 2 } },
      { key: "a_add", name: "Add", priority: 10, action: { type: "ADD", amountCents: 1_000 } },
      { key: "z_same", name: "Z", priority: 20, action: { type: "ADD", amountCents: 1 } },
    ];
    const calc = calculatePrice({ service: { basePriceCents: 1_000, currency: "USD" }, rules, answers: {} });
    // (1000 + 1000) * 2 = 4000, then + 1
    expect(calc.adjustments.map((a) => a.rule)).toEqual(["a_add", "b_double", "z_same"]);
    expect(calc.totalCents).toBe(4_001);
    const reversed = calculatePrice({ service: { basePriceCents: 1_000, currency: "USD" }, rules: [...rules].reverse(), answers: {} });
    expect(reversed.totalCents).toBe(calc.totalCents);
    expect(reversed.rulesFingerprint).toBe(calc.rulesFingerprint);
  });

  it("supports negative adjustments and clamps at zero", () => {
    const calc = calculatePrice({
      service: { basePriceCents: 5_000, currency: "USD" },
      rules: [{ key: "discount", name: "Discount", priority: 1, action: { type: "SUBTRACT", amountCents: 8_000 } }],
      answers: {},
    });
    expect(calc.adjustments[0].amountCents).toBe(-8_000);
    expect(calc.subtotalCents).toBe(-3_000);
    expect(calc.totalCents).toBe(0);
    expect(calc.warnings.join()).toMatch(/negative/);
  });

  it("applies percentage surcharges and discounts on the running total", () => {
    const rules: PricingRuleDef[] = [
      { key: "rush", name: "Rush", priority: 1, action: { type: "PERCENTAGE", percent: 10 } },
      { key: "loyal", name: "Loyalty", priority: 2, action: { type: "PERCENTAGE", percent: -15 } },
    ];
    const calc = calculatePrice({ service: { basePriceCents: 33_333, currency: "USD" }, rules, answers: {} });
    // 33333 * 10% = 3333.3 -> 3333 => 36666; * -15% = -5499.9 -> -5500 => 31166
    expect(calc.adjustments.map((a) => a.amountCents)).toEqual([3_333, -5_500]);
    expect(calc.totalCents).toBe(31_166);
  });

  it("supports SET, MULTIPLY and PER_UNIT with included units and cap", () => {
    const rules: PricingRuleDef[] = [
      { key: "set", name: "Set", priority: 1, condition: { field: "plan", op: "eq", value: "pro" }, action: { type: "SET", amountCents: 40_000 } },
      { key: "per_employee", name: "Per employee", priority: 2, action: { type: "PER_UNIT", field: "employees", amountCents: 1_500, includedUnits: 5, maxUnits: 10 } },
      { key: "mult", name: "Multi-entity", priority: 3, condition: { field: "entities", op: "gte", value: 2 }, action: { type: "MULTIPLY", factor: 1.5 } },
    ];
    const calc = calculatePrice({ service, rules, answers: { plan: "pro", employees: 8, entities: 2 } });
    // SET 40000; +3 * 1500 = 44500; *1.5 = 66750
    expect(calc.adjustments.map((a) => a.amountCents)).toEqual([15_000, 4_500, 22_250]);
    expect(calc.totalCents).toBe(66_750);

    const capped = calculatePrice({ service, rules, answers: { employees: 100 } });
    expect(capped.adjustments[0].amountCents).toBe(15_000); // 10 units max
  });

  it("skips invalid conditions and actions without throwing", () => {
    const rules: PricingRuleDef[] = [
      { key: "bad_cond", name: "Bad", priority: 1, condition: { field: "x", op: "nope", value: 1 }, action: { type: "ADD", amountCents: 100 } },
      { key: "bad_gt", name: "Bad gt", priority: 2, condition: { field: "x", op: "gt", value: "abc" }, action: { type: "ADD", amountCents: 100 } },
      { key: "bad_action", name: "Bad action", priority: 3, action: { type: "EXPLODE" } },
      { key: "neg_amount", name: "Negative add", priority: 4, action: { type: "ADD", amountCents: -500 } },
      { key: "ok", name: "OK", priority: 5, action: { type: "ADD", amountCents: 100 } },
    ];
    const calc = calculatePrice({ service, rules, answers: { x: 5 } });
    expect(calc.adjustments.map((a) => a.rule)).toEqual(["ok"]);
    expect(calc.warnings).toHaveLength(4);
    expect(calc.totalCents).toBe(25_100);
  });

  it("treats boundary values exactly (gt vs gte, between inclusive)", () => {
    const rules: PricingRuleDef[] = [
      { key: "gt250", name: ">250", priority: 1, condition: { field: "n", op: "gt", value: 250 }, action: { type: "ADD", amountCents: 1 } },
      { key: "gte250", name: ">=250", priority: 2, condition: { field: "n", op: "gte", value: 250 }, action: { type: "ADD", amountCents: 10 } },
      { key: "btw", name: "250-500", priority: 3, condition: { field: "n", op: "between", value: [250, 500] }, action: { type: "ADD", amountCents: 100 } },
    ];
    const at = (n: number) => calculatePrice({ service: { basePriceCents: 0, currency: "USD" }, rules, answers: { n } }).totalCents;
    expect(at(249)).toBe(0);
    expect(at(250)).toBe(110);
    expect(at(251)).toBe(111);
    expect(at(500)).toBe(111);
    expect(at(501)).toBe(11);
  });

  it("does not apply rules whose fields are unanswered", () => {
    const calc = calculatePrice({ service, rules: bookkeepingRules, answers: {} });
    expect(calc.totalCents).toBe(25_000);
  });

  it("ignores inactive rules", () => {
    const calc = calculatePrice({
      service,
      rules: [{ ...bookkeepingRules[2], active: false }],
      answers: { payroll: true },
    });
    expect(calc.totalCents).toBe(25_000);
  });

  it("applies a minimum price", () => {
    const calc = calculatePrice({
      service: { basePriceCents: 10_000, minimumPriceCents: 15_000, currency: "USD" },
      rules: [],
      answers: {},
    });
    expect(calc.totalCents).toBe(15_000);
    expect(calc.minimumApplied).toBe(true);
  });

  it("flags REQUIRE_REVIEW without changing totals", () => {
    const calc = calculatePrice({
      service,
      rules: [
        { key: "big", name: "Large volume", priority: 1, condition: { field: "monthlyTransactions", op: "gt", value: 5000 }, action: { type: "REQUIRE_REVIEW", reason: "High volume" } },
      ],
      answers: { monthlyTransactions: 9000 },
    });
    expect(calc.requiresReview).toBe(true);
    expect(calc.reviewReasons).toEqual(["High volume"]);
    expect(calc.totalCents).toBe(25_000);
  });

  it("snapshots every evaluated rule for audit", () => {
    const calc = calculatePrice({ service, rules: bookkeepingRules, answers: { payroll: true } });
    expect(calc.rules).toHaveLength(3);
    expect(calc.rules.find((r) => r.key === "payroll")?.matched).toBe(true);
    expect(calc.rules.find((r) => r.key === "bank_accounts")?.matched).toBe(false);
    expect(calc.rules[0].action).toEqual({ type: "ADD", amountCents: 10_000 });
  });

  it("changes the fingerprint when rules change", () => {
    const a = calculatePrice({ service, rules: bookkeepingRules, answers: {} });
    const b = calculatePrice({
      service,
      rules: [{ ...bookkeepingRules[0], action: { type: "ADD", amountCents: 12_000 } }, ...bookkeepingRules.slice(1)],
      answers: {},
    });
    expect(a.rulesFingerprint).not.toBe(b.rulesFingerprint);
  });

  it("produces human-readable rule previews and validation errors", () => {
    expect(describeRule(bookkeepingRules[0], "USD", { monthlyTransactions: "Monthly transactions" })).toBe(
      "IF Monthly transactions > 250 THEN Add $100",
    );
    expect(validatePricingRule({ condition: null, action: { type: "PERCENTAGE", percent: 10 } })).toBeNull();
    expect(validatePricingRule({ condition: { field: "a", op: "between", value: [5, 1] }, action: { type: "ADD", amountCents: 1 } })).toMatch(/min > max/);
    expect(validatePricingRule({ action: { type: "ADD", amountCents: 1.5 } })).toMatch(/Invalid action/);
  });
});
