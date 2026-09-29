import { describe, expect, it } from "vitest";
import { evaluateCondition, validateCondition, describeCondition, conditionFields } from "@/core/conditions";
import {
  getVisibleQuestions,
  pruneAnswers,
  validateAnswer,
  validateSubmission,
  formatAnswer,
  lintQuestions,
  type QuestionDef,
} from "@/core/questions";

const questions: QuestionDef[] = [
  { key: "payroll", label: "Do you need payroll?", type: "BOOLEAN", required: true, order: 1 },
  {
    key: "employees",
    label: "How many employees do you have?",
    type: "NUMBER",
    required: true,
    order: 2,
    config: { min: 1, max: 5000 },
    visibleWhen: { field: "payroll", op: "eq", value: true },
  },
  {
    key: "payFrequency",
    label: "Pay frequency",
    type: "SINGLE_SELECT",
    required: true,
    order: 3,
    options: [
      { label: "Weekly", value: "weekly" },
      { label: "Monthly", value: "monthly" },
    ],
    visibleWhen: { all: [{ field: "payroll", op: "eq", value: true }, { field: "employees", op: "gt", value: 0 }] },
  },
  { key: "notes", label: "Anything else?", type: "TEXT", required: false, order: 4 },
  { key: "legacy", label: "Old question", type: "TEXT", required: true, order: 5, active: false },
];

describe("conditions", () => {
  it("evaluates operators", () => {
    const a = { n: 5, s: "quickbooks", arr: ["vat", "tax"], b: true, empty: "" };
    expect(evaluateCondition({ field: "n", op: "eq", value: "5" }, a)).toBe(true);
    expect(evaluateCondition({ field: "n", op: "neq", value: 6 }, a)).toBe(true);
    expect(evaluateCondition({ field: "s", op: "in", value: ["xero", "quickbooks"] }, a)).toBe(true);
    expect(evaluateCondition({ field: "s", op: "notIn", value: ["xero"] }, a)).toBe(true);
    expect(evaluateCondition({ field: "arr", op: "contains", value: "vat" }, a)).toBe(true);
    expect(evaluateCondition({ field: "arr", op: "notContains", value: "audit" }, a)).toBe(true);
    expect(evaluateCondition({ field: "b", op: "eq", value: "true" }, a)).toBe(true);
    expect(evaluateCondition({ field: "empty", op: "exists" }, a)).toBe(false);
    expect(evaluateCondition({ field: "missing", op: "notExists" }, a)).toBe(true);
    expect(evaluateCondition({ any: [{ field: "n", op: "gt", value: 10 }, { field: "b", op: "eq", value: true }] }, a)).toBe(true);
    expect(evaluateCondition({ not: { field: "n", op: "lt", value: 10 } }, a)).toBe(false);
    expect(evaluateCondition(null, a)).toBe(true);
  });

  it("never throws on malformed input", () => {
    expect(evaluateCondition({ field: "n", op: "wat" }, { n: 1 })).toBe(false);
    expect(evaluateCondition("garbage", {})).toBe(false);
    expect(evaluateCondition({ all: "nope" }, {})).toBe(false);
    expect(evaluateCondition({ field: "n", op: "between", value: 3 }, { n: 3 })).toBe(false);
  });

  it("validates and describes conditions", () => {
    expect(validateCondition({ field: "n", op: "gt", value: 3 }).ok).toBe(true);
    expect(validateCondition({ field: "n", op: "gt", value: "x" }).ok).toBe(false);
    expect(validateCondition({ field: "n", op: "in", value: 3 }).ok).toBe(false);
    expect(validateCondition({ field: "n", op: "gt", value: 3, extra: 1 }).ok).toBe(false);
    expect(describeCondition({ all: [{ field: "a", op: "gt", value: 1 }, { field: "b", op: "exists" }] }, { a: "A" })).toBe(
      "A > 1 AND b is answered",
    );
    expect(conditionFields({ any: [{ field: "a", op: "exists" }, { not: { field: "b", op: "exists" } }] })).toEqual(["a", "b"]);
  });
});

describe("question visibility (decision tree)", () => {
  it("hides follow-up questions until their condition is met", () => {
    expect(getVisibleQuestions(questions, {}).map((q) => q.key)).toEqual(["payroll", "notes"]);
    expect(getVisibleQuestions(questions, { payroll: false }).map((q) => q.key)).toEqual(["payroll", "notes"]);
    expect(getVisibleQuestions(questions, { payroll: true }).map((q) => q.key)).toEqual(["payroll", "employees", "notes"]);
    expect(getVisibleQuestions(questions, { payroll: true, employees: 8 }).map((q) => q.key)).toEqual([
      "payroll",
      "employees",
      "payFrequency",
      "notes",
    ]);
  });

  it("does not let stale answers to hidden questions unlock other questions", () => {
    // employees answered earlier, then payroll switched off: payFrequency must stay hidden
    const visible = getVisibleQuestions(questions, { payroll: false, employees: 8 }).map((q) => q.key);
    expect(visible).not.toContain("payFrequency");
    expect(pruneAnswers(questions, { payroll: false, employees: 8, payFrequency: "weekly", bogus: 1 })).toEqual({ payroll: false });
  });

  it("excludes inactive questions", () => {
    expect(getVisibleQuestions(questions, {}).some((q) => q.key === "legacy")).toBe(false);
  });
});

describe("answer validation", () => {
  it("validates by type", () => {
    const num = questions[1];
    expect(validateAnswer(num, "12")).toEqual({ ok: true, value: 12 });
    expect(validateAnswer(num, 0).ok).toBe(false);
    expect(validateAnswer(num, 99999).ok).toBe(false);
    expect(validateAnswer(num, "abc").ok).toBe(false);
    expect(validateAnswer(questions[0], "true")).toEqual({ ok: true, value: true });
    expect(validateAnswer(questions[2], "daily").ok).toBe(false);
    expect(validateAnswer({ key: "e", label: "E", type: "EMAIL", required: true, order: 0 }, "A@B.co")).toEqual({ ok: true, value: "a@b.co" });
    expect(validateAnswer({ key: "p", label: "P", type: "PHONE", required: true, order: 0 }, "+1 (242) 555-0100").ok).toBe(true);
    expect(validateAnswer({ key: "p", label: "P", type: "PHONE", required: true, order: 0 }, "call me").ok).toBe(false);
    const multi: QuestionDef = { key: "m", label: "M", type: "MULTI_SELECT", required: true, order: 0, options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] };
    expect(validateAnswer(multi, ["a", "a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(validateAnswer(multi, ["c"]).ok).toBe(false);
  });

  it("validates a full submission server-side, requiring only visible questions", () => {
    const r1 = validateSubmission(questions, { payroll: "false" });
    expect(r1.ok).toBe(true);
    expect(r1.answers).toEqual({ payroll: false });

    const r2 = validateSubmission(questions, { payroll: true });
    expect(r2.ok).toBe(false);
    expect(Object.keys(r2.errors)).toEqual(["employees"]);

    const r3 = validateSubmission(questions, { payroll: true, employees: 8, payFrequency: "weekly", injected: 1e9 });
    expect(r3.ok).toBe(true);
    expect(r3.answers).toEqual({ payroll: true, employees: 8, payFrequency: "weekly" });
  });

  it("formats answers for humans", () => {
    expect(formatAnswer(questions[0], true)).toBe("Yes");
    expect(formatAnswer(questions[2], "weekly")).toBe("Weekly");
    expect(formatAnswer({ key: "r", label: "R", type: "CURRENCY", required: true, order: 0 }, 50000)).toBe("$50,000");
  });

  it("lints forward references and missing options", () => {
    const issues = lintQuestions([
      { key: "a", label: "A", type: "TEXT", required: true, order: 1, visibleWhen: { field: "b", op: "exists" } },
      { key: "b", label: "B", type: "SINGLE_SELECT", required: true, order: 2 },
    ]);
    expect(issues.map((i) => i.questionKey)).toEqual(["a", "b"]);
  });
});
