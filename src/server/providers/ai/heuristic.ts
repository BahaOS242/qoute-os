/**
 * Offline, deterministic AIProvider. Used by default (no API key needed), in tests, and as a
 * fallback when the remote provider fails. It is intentionally conservative: it proposes a
 * structure and clearly labels any amounts it had to assume.
 */
import type { AIProvider, AssistantInput, LeadSummaryInput } from "../types";
import { aiProposalToServiceConfig, type AiProposal } from "./proposal";

const FACTORS: {
  match: RegExp;
  question: AiProposal["questions"][number];
  rule: (amountCents: number) => Omit<AiProposal["pricingRules"][number], "key" | "priority">;
}[] = [
  {
    match: /transaction/i,
    question: { key: "monthlyTransactions", label: "About how many transactions do you have per month?", helpText: "Count every sale, purchase, deposit and payment across your accounts.", type: "NUMBER", required: true, options: [], showIfQuestionKey: null, showIfEquals: null },
    rule: (a) => ({ name: "Transaction volume over 250", conditionQuestionKey: "monthlyTransactions", conditionOperator: "gt", conditionValue: "250", conditionValueMax: null, actionType: "ADD", amountCents: a, percent: null, factor: null, perUnitQuestionKey: null, includedUnits: null }),
  },
  {
    match: /payroll/i,
    question: { key: "payroll", label: "Do you need payroll handled too?", helpText: null, type: "BOOLEAN", required: true, options: [], showIfQuestionKey: null, showIfEquals: null },
    rule: (a) => ({ name: "Payroll", conditionQuestionKey: "payroll", conditionOperator: "eq", conditionValue: "true", conditionValueMax: null, actionType: "ADD", amountCents: a, percent: null, factor: null, perUnitQuestionKey: null, includedUnits: null }),
  },
  {
    match: /employee|staff|headcount/i,
    question: { key: "employees", label: "How many employees do you have?", helpText: null, type: "NUMBER", required: true, options: [], showIfQuestionKey: null, showIfEquals: null },
    rule: (a) => ({ name: "Per employee", conditionQuestionKey: null, conditionOperator: null, conditionValue: null, conditionValueMax: null, actionType: "PER_UNIT", amountCents: Math.round(a / 10), percent: null, factor: null, perUnitQuestionKey: "employees", includedUnits: 5 }),
  },
  {
    match: /bank account/i,
    question: { key: "bankAccounts", label: "How many bank and credit card accounts do you use?", helpText: null, type: "NUMBER", required: true, options: [], showIfQuestionKey: null, showIfEquals: null },
    rule: (a) => ({ name: "Additional accounts", conditionQuestionKey: "bankAccounts", conditionOperator: "gt", conditionValue: "2", conditionValueMax: null, actionType: "ADD", amountCents: Math.round(a / 2), percent: null, factor: null, perUnitQuestionKey: null, includedUnits: null }),
  },
  {
    match: /revenue|turnover/i,
    question: { key: "annualRevenue", label: "What is your approximate annual revenue?", helpText: null, type: "CURRENCY", required: true, options: [], showIfQuestionKey: null, showIfEquals: null },
    rule: () => ({ name: "Revenue above $5M needs review", conditionQuestionKey: "annualRevenue", conditionOperator: "gt", conditionValue: "5000000", conditionValueMax: null, actionType: "REQUIRE_REVIEW", amountCents: null, percent: null, factor: null, perUnitQuestionKey: null, includedUnits: null }),
  },
];

const KNOWN_SERVICES = ["bookkeeping", "payroll", "vat", "tax preparation", "tax", "audit", "advisory", "consulting"];

function parseMoney(s: string): number | null {
  const m = s.match(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Amount mentioned right next to a keyword, e.g. "payroll adds $100" or "$100 for payroll". */
function amountNear(prompt: string, keyword: RegExp): number | null {
  for (const sentence of prompt.split(/[.;,\n]| and /i)) {
    if (keyword.test(sentence) && !/start|base|from/i.test(sentence)) {
      const m = parseMoney(sentence);
      if (m !== null) return m;
    }
  }
  return null;
}

export function heuristicProposal(prompt: string, existing?: { slug: string; name: string } | null): AiProposal {
  const lower = prompt.toLowerCase();
  // The service is the known service word mentioned first ("consulting ... payroll adds $120" -> Consulting).
  const serviceWord = KNOWN_SERVICES.map((w) => ({ w, i: lower.indexOf(w) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i || b.w.length - a.w.length)[0]?.w;
  const name = existing?.name ?? (serviceWord ? serviceWord.replace(/\b\w/g, (c) => c.toUpperCase()) : "New service");
  const baseMatch = prompt.match(/(?:starts?\s+(?:at|from)|from|base(?:\s+price)?\s+(?:of|is)?|minimum(?:\s+of)?)\s*(\$\s?\d[\d,]*(?:\.\d{1,2})?\s*k?)/i);
  const base = (baseMatch ? parseMoney(baseMatch[1]) : null) ?? parseMoney(prompt) ?? 0;
  const billingPeriod: AiProposal["service"]["billingPeriod"] = /month/i.test(prompt)
    ? "MONTHLY"
    : /quarter/i.test(prompt)
      ? "QUARTERLY"
      : /year|annual/i.test(prompt)
        ? "ANNUAL"
        : "ONE_TIME";
  const review = /review|custom|bespoke|case[- ]by[- ]case/i.test(prompt) && !base;

  const questions: AiProposal["questions"] = [];
  const pricingRules: AiProposal["pricingRules"] = [];
  const assumed: string[] = [];
  FACTORS.forEach((f, i) => {
    if (!f.match.test(prompt)) return;
    questions.push(f.question);
    const stated = amountNear(prompt, f.match);
    const amount = stated ?? Math.max(2_500, Math.round((base || 20_000) * 0.25));
    if (stated === null && f.rule(amount).actionType !== "REQUIRE_REVIEW") assumed.push(f.question.key);
    pricingRules.push({ key: `${f.question.key}_rule`, priority: (i + 1) * 10, ...f.rule(amount) });
  });

  const explanation = [
    `Proposed "${name}" with a base price of $${(base / 100).toFixed(0)}${billingPeriod === "MONTHLY" ? "/month" : ""}.`,
    questions.length ? `Detected pricing factors: ${questions.map((q) => q.key).join(", ")}.` : "No pricing factors detected; add questions manually.",
    assumed.length ? `Amounts for ${assumed.join(", ")} were not stated and are placeholders - review them before approving.` : "",
    "Generated by the offline heuristic assistant. Nothing is active until you approve it.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    explanation,
    service: {
      slug: existing?.slug ?? name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      description: null,
      quoteMode: review ? "HUMAN_REVIEW" : "INSTANT",
      billingPeriod,
      basePriceCents: base,
      minimumPriceCents: null,
    },
    questions,
    pricingRules: review ? [] : pricingRules,
  };
}

/** Removes currency amounts from free text so assistants can never "quote" a price. */
export function stripPrices(text: string): string {
  return text.replace(/(?:[$£€]|USD|BSD|EUR|GBP)\s?\d[\d,]*(?:\.\d+)?\s*(?:k|K|m|M)?(?:\s*(?:\/|per)\s*\w+)?/g, "[see your estimate]");
}

export class HeuristicAIProvider implements AIProvider {
  readonly name = "heuristic";

  async proposeConfig(input: { prompt: string; existingService?: { slug: string; name: string } | null }) {
    const p = heuristicProposal(input.prompt, input.existingService);
    return { config: { services: [aiProposalToServiceConfig(p)] }, explanation: p.explanation };
  }

  async summarizeLead(input: LeadSummaryInput): Promise<string> {
    const who = input.company || input.contactName;
    const facts = input.answers
      .filter((a) => a.display && a.display !== "—")
      .slice(0, 5)
      .map((a) => `${a.label.replace(/\?$/, "").toLowerCase()}: ${a.display}`);
    const parts = [`${who} appears to need ${input.serviceName.toLowerCase()}.`];
    if (facts.length) parts.push(`Key details - ${facts.join("; ")}.`);
    if (input.estimate) parts.push(`System estimate: ${input.estimate}.`);
    if (input.urgency) parts.push(`Timeline: ${input.urgency}.`);
    return parts.join(" ");
  }

  async answerVisitorQuestion(input: AssistantInput): Promise<string> {
    const q = input.question.toLowerCase();
    const glossary = input.context
      .split("\n")
      .map((l) => l.match(/^GLOSSARY (.+?): (.+)$/))
      .filter((m): m is RegExpMatchArray => !!m);
    const hit = glossary.find(([, term]) => q.includes(term.toLowerCase()));
    if (hit) return `${hit[1]}: ${hit[2]}`;
    if (/price|cost|how much|fee|expensive|cheap/.test(q)) {
      return "Your estimate is calculated from your answers when you finish the questions, and the team will confirm it with you. Answer as accurately as you can - rough numbers are fine.";
    }
    const help = input.context.match(/^HELP: (.+)$/m);
    if (help) return `${help[1]} If you're unsure, pick the closest option - an advisor will confirm details with you.`;
    return `Good question. If you're unsure, give your best estimate - someone from ${input.organizationName} will review your answers with you.`;
  }
}
