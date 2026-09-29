/**
 * Claude-backed AIProvider (enabled with AI_PROVIDER=anthropic + ANTHROPIC_API_KEY).
 *
 * The model never produces prices shown to visitors: config proposals are validated and
 * require admin approval, summaries are told to use only the system estimate, and assistant
 * replies are post-filtered by stripPrices() in the calling service.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { AIProvider, AssistantInput, LeadSummaryInput } from "../types";
import { aiProposalSchema, aiProposalToServiceConfig } from "./proposal";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
// Server-side fallback: if the primary model declines, the API re-runs on a fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

function textOf(msg: { content: Array<{ type: string }>; stop_reason: string | null }): string {
  if (msg.stop_reason === "refusal") throw new Error("AI provider declined the request");
  return msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export class AnthropicAIProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async proposeConfig(input: {
    prompt: string;
    currency: string;
    existingService?: { slug: string; name: string; questions: { key: string; label: string; type: string }[] } | null;
  }) {
    const existing = input.existingService
      ? `The admin is editing the existing service "${input.existingService.name}" (slug "${input.existingService.slug}") whose questions are: ${JSON.stringify(input.existingService.questions)}. Reuse those keys where they fit.`
      : "Create a new service.";
    const response = await this.client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: betaZodOutputFormat(aiProposalSchema) },
      ...FALLBACK,
      system:
        "You convert a professional-services firm's plain-English pricing description into a structured quote configuration. " +
        "All money values are integer minor units (cents) in " + input.currency + ". " +
        "Only use amounts the admin stated; when an amount is not stated, use a clearly placeholder amount and say so in `explanation`. " +
        "Question keys are camelCase. Visitor-facing labels are short, friendly questions for non-accountants. " +
        "Use REQUIRE_REVIEW for situations the admin says need a human. Never invent services the admin did not mention.",
      messages: [{ role: "user", content: `${existing}\n\nAdmin description:\n${input.prompt}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      throw new Error("AI provider did not return a usable proposal");
    }
    const p = response.parsed_output;
    return { config: { services: [aiProposalToServiceConfig(p)] }, explanation: p.explanation };
  }

  async summarizeLead(input: LeadSummaryInput): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      ...FALLBACK,
      system:
        "Write a 1-2 sentence summary of an inbound sales lead for a busy advisor. Plain English, no bullet points. " +
        "Only mention a price if a system estimate is provided, and quote it exactly. Never invent facts.",
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
    return textOf(response);
  }

  async answerVisitorQuestion(input: AssistantInput): Promise<string> {
    const response = await this.client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { effort: "low" },
      ...FALLBACK,
      system:
        `You help visitors of ${input.organizationName} understand questions in an online quote form` +
        (input.serviceName ? ` for ${input.serviceName}` : "") +
        ". Explain terminology simply in at most 3 sentences. " +
        "Never state, estimate or negotiate prices or discounts: pricing is calculated by the firm's system from the visitor's answers. " +
        "If asked about price, say the estimate appears after the questions and an advisor will confirm it.\n\nContext:\n" +
        input.context,
      messages: [{ role: "user", content: input.question }],
    });
    return textOf(response);
  }
}
