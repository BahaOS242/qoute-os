/**
 * Condition DSL shared by question visibility, pricing rules, lead rules and automations.
 *
 * A condition is plain JSON so it can be stored in the database, exported in recipes and
 * edited by the no-code builders:
 *
 *   { "field": "monthlyTransactions", "op": "gt", "value": 250 }
 *   { "all": [ {...}, {...} ] }   { "any": [ ... ] }   { "not": {...} }
 *
 * `null`/`undefined` means "always true". Evaluation never throws: a malformed condition
 * evaluates to `false` and is reported through `explainCondition`/`validateCondition`.
 */
import { z } from "zod";

export const OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "notIn",
  "contains",
  "notContains",
  "exists",
  "notExists",
] as const;

export type Operator = (typeof OPERATORS)[number];

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { field: string; op: Operator; value?: unknown };

export type Answers = Record<string, unknown>;

const leafSchema = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(OPERATORS),
  value: z.unknown().optional(),
});

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(conditionSchema).max(50) }).strict(),
    z.object({ any: z.array(conditionSchema).max(50) }).strict(),
    z.object({ not: conditionSchema }).strict(),
    leafSchema.strict(),
  ]),
) as z.ZodType<Condition>;

const OPS_REQUIRING_NUMBER = new Set<Operator>(["gt", "gte", "lt", "lte"]);

export type ConditionValidation = { ok: true; condition: Condition | null } | { ok: false; error: string };

/** Structural + semantic validation, used when admins save rules or import configs. */
export function validateCondition(input: unknown): ConditionValidation {
  if (input === null || input === undefined) return { ok: true, condition: null };
  const parsed = conditionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid condition: ${parsed.error.issues[0]?.message ?? "unknown"}` };
  const semanticError = findSemanticError(parsed.data, 0);
  if (semanticError) return { ok: false, error: semanticError };
  return { ok: true, condition: parsed.data };
}

function findSemanticError(c: Condition, depth: number): string | null {
  if (depth > 10) return "Condition nesting is too deep";
  if ("all" in c) return firstError(c.all, depth);
  if ("any" in c) return firstError(c.any, depth);
  if ("not" in c) return findSemanticError(c.not, depth + 1);
  if (OPS_REQUIRING_NUMBER.has(c.op) && toNumber(c.value) === null) {
    return `Operator "${c.op}" on "${c.field}" requires a numeric value`;
  }
  if (c.op === "between") {
    if (!Array.isArray(c.value) || c.value.length !== 2 || c.value.some((v) => toNumber(v) === null)) {
      return `Operator "between" on "${c.field}" requires [min, max]`;
    }
    const [min, max] = c.value.map((v) => toNumber(v)!);
    if (min > max) return `Operator "between" on "${c.field}" has min > max`;
  }
  if ((c.op === "in" || c.op === "notIn") && !Array.isArray(c.value)) {
    return `Operator "${c.op}" on "${c.field}" requires a list`;
  }
  return null;
}

function firstError(list: Condition[], depth: number): string | null {
  for (const c of list) {
    const e = findSemanticError(c, depth + 1);
    if (e) return e;
  }
  return null;
}

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na !== null && nb !== null) return na === nb;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a) === String(b);
  }
  return false;
}

/** Evaluate a condition against answers. Malformed conditions evaluate to `false`. */
export function evaluateCondition(condition: unknown, answers: Answers): boolean {
  if (condition === null || condition === undefined) return true;
  try {
    return evalNode(condition as Condition, answers, 0);
  } catch {
    return false;
  }
}

function evalNode(c: Condition, answers: Answers, depth: number): boolean {
  if (depth > 10 || typeof c !== "object" || c === null) return false;
  if ("all" in c) return Array.isArray(c.all) && c.all.every((x) => evalNode(x, answers, depth + 1));
  if ("any" in c) return Array.isArray(c.any) && c.any.some((x) => evalNode(x, answers, depth + 1));
  if ("not" in c) {
    if (typeof c.not !== "object" || c.not === null) return false;
    return !evalNode(c.not, answers, depth + 1);
  }
  if (typeof c.field !== "string" || !OPERATORS.includes(c.op)) return false;

  const actual = answers[c.field];
  const expected = c.value;

  switch (c.op) {
    case "exists":
      return !isEmpty(actual);
    case "notExists":
      return isEmpty(actual);
    case "eq":
      return !isEmpty(actual) && looseEquals(actual, expected);
    case "neq":
      return !looseEquals(actual, expected);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNumber(actual);
      const e = toNumber(expected);
      if (a === null || e === null) return false;
      if (c.op === "gt") return a > e;
      if (c.op === "gte") return a >= e;
      if (c.op === "lt") return a < e;
      return a <= e;
    }
    case "between": {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      const a = toNumber(actual);
      const min = toNumber(expected[0]);
      const max = toNumber(expected[1]);
      if (a === null || min === null || max === null) return false;
      return a >= min && a <= max;
    }
    case "in":
      return Array.isArray(expected) && !isEmpty(actual) && expected.some((e) => looseEquals(actual, e));
    case "notIn":
      return Array.isArray(expected) && !expected.some((e) => looseEquals(actual, e));
    case "contains":
      if (Array.isArray(actual)) return actual.some((a) => looseEquals(a, expected));
      if (typeof actual === "string" && typeof expected === "string") {
        return actual.toLowerCase().includes(expected.toLowerCase());
      }
      return false;
    case "notContains":
      if (Array.isArray(actual)) return !actual.some((a) => looseEquals(a, expected));
      if (typeof actual === "string" && typeof expected === "string") {
        return !actual.toLowerCase().includes(expected.toLowerCase());
      }
      return true;
    default:
      return false;
  }
}

/** Every field a condition reads. Used to validate references and draw dependency hints. */
export function conditionFields(condition: unknown): string[] {
  const out = new Set<string>();
  const walk = (c: unknown, depth: number) => {
    if (!c || typeof c !== "object" || depth > 10) return;
    const n = c as Record<string, unknown>;
    if (Array.isArray(n.all)) n.all.forEach((x) => walk(x, depth + 1));
    else if (Array.isArray(n.any)) n.any.forEach((x) => walk(x, depth + 1));
    else if (n.not) walk(n.not, depth + 1);
    else if (typeof n.field === "string") out.add(n.field);
  };
  walk(condition, 0);
  return [...out];
}

const OP_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "is between",
  in: "is one of",
  notIn: "is not one of",
  contains: "includes",
  notContains: "does not include",
  exists: "is answered",
  notExists: "is not answered",
};

export const OPERATOR_LABELS = OP_LABELS;

/** Human-readable preview, e.g. `Monthly transactions > 250 AND Payroll is true`. */
export function describeCondition(condition: unknown, labels: Record<string, string> = {}): string {
  if (condition === null || condition === undefined) return "Always";
  const d = (c: unknown, depth: number): string => {
    if (!c || typeof c !== "object" || depth > 10) return "(invalid)";
    const n = c as Record<string, unknown>;
    if (Array.isArray(n.all)) return n.all.length ? n.all.map((x) => wrap(x, depth)).join(" AND ") : "Always";
    if (Array.isArray(n.any)) return n.any.length ? n.any.map((x) => wrap(x, depth)).join(" OR ") : "Never";
    if (n.not) return `NOT ${wrap(n.not, depth)}`;
    if (typeof n.field === "string" && OPERATORS.includes(n.op as Operator)) {
      const label = labels[n.field] ?? n.field;
      const op = OP_LABELS[n.op as Operator];
      if (n.op === "exists" || n.op === "notExists") return `${label} ${op}`;
      if (n.op === "between" && Array.isArray(n.value)) return `${label} ${op} ${n.value[0]} and ${n.value[1]}`;
      const v = Array.isArray(n.value) ? n.value.join(", ") : String(n.value);
      return `${label} ${op} ${v}`;
    }
    return "(invalid)";
  };
  const wrap = (c: unknown, depth: number) => {
    const inner = d(c, depth + 1);
    const n = c as Record<string, unknown> | null;
    return n && (Array.isArray(n.all) || Array.isArray(n.any)) ? `(${inner})` : inner;
  };
  return d(condition, 0);
}
