/**
 * Data-driven question engine: visibility (decision tree), answer validation and display.
 *
 * Pure and framework-free so the exact same code runs in the browser (instant UX) and on the
 * server (authoritative validation before pricing).
 */
import { evaluateCondition, conditionFields, toNumber, type Answers } from "../conditions";

export const QUESTION_TYPES = [
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "NUMBER",
  "CURRENCY",
  "TEXT",
  "BOOLEAN",
  "RANGE",
  "EMAIL",
  "PHONE",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface QuestionConfig {
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  maxLength?: number;
}

export interface QuestionOptionDef {
  label: string;
  value: string;
  description?: string;
}

export interface QuestionDef {
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  order: number;
  active?: boolean;
  description?: string | null;
  helpText?: string | null;
  config?: QuestionConfig | null;
  visibleWhen?: unknown;
  options?: QuestionOptionDef[];
  leadField?: string | null;
}

const sortQuestions = (qs: QuestionDef[]) =>
  [...qs].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));

/**
 * Returns the questions that should be shown for the given answers, in order.
 *
 * A question's condition is evaluated only against answers to questions that are themselves
 * visible and appear *earlier* in the flow. This makes the decision tree deterministic and
 * guarantees a stale answer to a now-hidden question can never unlock other questions.
 */
export function getVisibleQuestions(questions: QuestionDef[], answers: Answers): QuestionDef[] {
  const visible: QuestionDef[] = [];
  const effective: Answers = {};
  for (const q of sortQuestions(questions)) {
    if (q.active === false) continue;
    if (!evaluateCondition(q.visibleWhen ?? null, effective)) continue;
    visible.push(q);
    if (answers[q.key] !== undefined) effective[q.key] = answers[q.key];
  }
  return visible;
}

/** Drop answers to questions that are hidden or unknown. */
export function pruneAnswers(questions: QuestionDef[], answers: Answers): Answers {
  const out: Answers = {};
  for (const q of getVisibleQuestions(questions, answers)) {
    if (answers[q.key] !== undefined) out[q.key] = answers[q.key];
  }
  return out;
}

export type AnswerResult = { ok: true; value: unknown } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9 ()\-.]{7,20}$/;

export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Validate + normalize a single raw answer for a question. Blank values return `undefined`. */
export function validateAnswer(q: QuestionDef, raw: unknown): AnswerResult {
  if (isBlank(raw)) {
    return q.required ? { ok: false, error: "This question is required" } : { ok: true, value: undefined };
  }
  const cfg = q.config ?? {};
  switch (q.type) {
    case "NUMBER":
    case "CURRENCY":
    case "RANGE": {
      const n = toNumber(raw);
      if (n === null) return { ok: false, error: "Please enter a number" };
      if (n < 0 && (cfg.min === undefined || cfg.min >= 0)) return { ok: false, error: "Please enter a positive number" };
      if (cfg.min !== undefined && n < cfg.min) return { ok: false, error: `Must be at least ${cfg.min}` };
      if (cfg.max !== undefined && n > cfg.max) return { ok: false, error: `Must be at most ${cfg.max}` };
      return { ok: true, value: n };
    }
    case "BOOLEAN": {
      if (raw === true || raw === "true" || raw === "yes") return { ok: true, value: true };
      if (raw === false || raw === "false" || raw === "no") return { ok: true, value: false };
      return { ok: false, error: "Please choose yes or no" };
    }
    case "SINGLE_SELECT": {
      const v = String(raw);
      if (!(q.options ?? []).some((o) => o.value === v)) return { ok: false, error: "Please choose one of the options" };
      return { ok: true, value: v };
    }
    case "MULTI_SELECT": {
      const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      const allowed = new Set((q.options ?? []).map((o) => o.value));
      if (arr.some((v) => !allowed.has(v))) return { ok: false, error: "Please choose from the options" };
      const unique = [...new Set(arr)];
      if (q.required && unique.length === 0) return { ok: false, error: "Please choose at least one option" };
      return { ok: true, value: unique };
    }
    case "TEXT": {
      const s = String(raw).trim();
      const max = cfg.maxLength ?? 1000;
      if (s.length > max) return { ok: false, error: `Please keep this under ${max} characters` };
      if (q.required && !s) return { ok: false, error: "This question is required" };
      return { ok: true, value: s };
    }
    case "EMAIL": {
      const s = String(raw).trim().toLowerCase();
      if (!EMAIL_RE.test(s) || s.length > 254) return { ok: false, error: "Please enter a valid email address" };
      return { ok: true, value: s };
    }
    case "PHONE": {
      const s = String(raw).trim();
      if (!PHONE_RE.test(s)) return { ok: false, error: "Please enter a valid phone number" };
      return { ok: true, value: s };
    }
    default:
      return { ok: false, error: "Unsupported question type" };
  }
}

export interface SubmissionResult {
  ok: boolean;
  answers: Answers;
  errors: Record<string, string>;
  visible: QuestionDef[];
}

/**
 * Server-authoritative validation of a full set of answers: recompute visibility, validate every
 * visible question (required ones must be answered), and discard anything else.
 */
export function validateSubmission(questions: QuestionDef[], rawAnswers: Answers): SubmissionResult {
  // Normalize first so visibility is computed on normalized values (e.g. "true" -> true).
  const normalized: Answers = {};
  const errors: Record<string, string> = {};
  const byKey = new Map(questions.map((q) => [q.key, q]));
  for (const [key, raw] of Object.entries(rawAnswers ?? {})) {
    const q = byKey.get(key);
    if (!q || isBlank(raw)) continue;
    const r = validateAnswer({ ...q, required: false }, raw);
    if (r.ok) normalized[key] = r.value;
  }
  const visible = getVisibleQuestions(questions, normalized);
  const answers: Answers = {};
  for (const q of visible) {
    const r = validateAnswer(q, rawAnswers?.[q.key]);
    if (!r.ok) errors[q.key] = r.error;
    else if (r.value !== undefined) answers[q.key] = r.value;
  }
  return { ok: Object.keys(errors).length === 0, answers, errors, visible };
}

/** Human-readable answer for summaries, snapshots and the admin lead view. */
export function formatAnswer(q: QuestionDef, value: unknown, currency = "USD"): string {
  if (isBlank(value)) return "—";
  switch (q.type) {
    case "BOOLEAN":
      return value === true ? "Yes" : "No";
    case "SINGLE_SELECT":
      return q.options?.find((o) => o.value === String(value))?.label ?? String(value);
    case "MULTI_SELECT":
      return (Array.isArray(value) ? value : [value])
        .map((v) => q.options?.find((o) => o.value === String(v))?.label ?? String(v))
        .join(", ");
    case "CURRENCY": {
      const n = toNumber(value);
      return n === null
        ? String(value)
        : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    }
    case "NUMBER":
    case "RANGE": {
      const n = toNumber(value);
      const unit = q.config?.unit ? ` ${q.config.unit}` : "";
      return n === null ? String(value) : `${n.toLocaleString("en-US")}${unit}`;
    }
    default:
      return String(value);
  }
}

export interface ConfigIssue {
  questionKey: string;
  message: string;
}

/**
 * Static analysis of a question set: conditions must only reference earlier questions and
 * select questions must have options.
 */
export function lintQuestions(questions: QuestionDef[]): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const seen = new Set<string>();
  const keys = new Set<string>();
  for (const q of sortQuestions(questions)) {
    if (keys.has(q.key)) issues.push({ questionKey: q.key, message: `Duplicate key "${q.key}"` });
    keys.add(q.key);
    for (const f of conditionFields(q.visibleWhen)) {
      if (!seen.has(f)) {
        issues.push({ questionKey: q.key, message: `Condition references "${f}", which is not an earlier question` });
      }
    }
    if ((q.type === "SINGLE_SELECT" || q.type === "MULTI_SELECT") && !(q.options ?? []).length) {
      issues.push({ questionKey: q.key, message: "Select questions need at least one option" });
    }
    seen.add(q.key);
  }
  return issues;
}
