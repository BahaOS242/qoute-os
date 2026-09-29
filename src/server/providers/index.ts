/**
 * Provider registry. Chooses implementations from environment variables; tests can swap any
 * provider with setProvidersForTesting(). To add a vendor (e.g. Twilio WhatsApp), implement the
 * interface in ./types.ts and select it in the matching factory below - no core changes needed.
 */
import { randomUUID } from "node:crypto";
import type {
  AIProvider,
  AnalyticsProvider,
  CalendarProvider,
  ChatMessage,
  CRMProvider,
  EmailMessage,
  EmailProvider,
  Providers,
  SMSProvider,
  WhatsAppProvider,
} from "./types";
import { HeuristicAIProvider } from "./ai/heuristic";
import { AnthropicAIProvider } from "./ai/anthropic";

export * from "./types";

/** Records messages in memory and logs them. Default in development and tests. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  readonly outbox: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.outbox.push(message);
    if (process.env.NODE_ENV !== "test") console.info(`[email:console] to=${message.to} subject="${message.subject}"`);
    return { id: randomUUID(), status: "logged" as const };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(private apiKey: string, private from: string) {}
  async send(message: EmailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: message.fromName ? `${message.fromName} <${this.from.replace(/.*<|>.*/g, "")}>` : this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
      }),
    });
    if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? randomUUID(), status: "sent" as const };
  }
}

/** Placeholder for WhatsApp/SMS until a vendor is configured: records instead of sending. */
export class LogChatProvider implements WhatsAppProvider, SMSProvider {
  readonly outbox: ChatMessage[] = [];
  constructor(readonly name: string) {}
  async send(message: ChatMessage) {
    this.outbox.push(message);
    if (process.env.NODE_ENV !== "test") console.info(`[${this.name}] to=${message.to} ${message.body.slice(0, 60)}`);
    return { id: randomUUID(), status: "logged" as const };
  }
}

/** Uses the organization's configured booking URL (Calendly, Cal.com, ...), prefilled when possible. */
export class LinkCalendarProvider implements CalendarProvider {
  readonly name = "link";
  bookingUrl(input: { baseUrl: string | null; name: string; email: string; leadId: string }) {
    if (!input.baseUrl) return null;
    try {
      const u = new URL(input.baseUrl);
      u.searchParams.set("name", input.name);
      u.searchParams.set("email", input.email);
      u.searchParams.set("utm_content", input.leadId);
      return u.toString();
    } catch {
      return null;
    }
  }
}

/** QuoteOS is itself the system of record; external CRMs plug in here. */
export class InternalCRMProvider implements CRMProvider {
  readonly name = "internal";
  async upsertContact(contact: { leadId: string }) {
    return { externalId: contact.leadId };
  }
}

export class NoopAnalyticsProvider implements AnalyticsProvider {
  readonly name = "noop";
  async track() {}
}

/** Uses the primary AI provider and degrades to the deterministic heuristic on failure. */
export class FallbackAIProvider implements AIProvider {
  readonly name: string;
  constructor(private primary: AIProvider, private fallback: AIProvider) {
    this.name = `${primary.name}+${fallback.name}`;
  }
  private async run<T>(fn: (p: AIProvider) => Promise<T>): Promise<T> {
    try {
      return await fn(this.primary);
    } catch (e) {
      console.warn(`[ai] ${this.primary.name} failed, using ${this.fallback.name}:`, (e as Error).message);
      return fn(this.fallback);
    }
  }
  proposeConfig(input: Parameters<AIProvider["proposeConfig"]>[0]) {
    return this.run((p) => p.proposeConfig(input));
  }
  summarizeLead(input: Parameters<AIProvider["summarizeLead"]>[0]) {
    return this.run((p) => p.summarizeLead(input));
  }
  answerVisitorQuestion(input: Parameters<AIProvider["answerVisitorQuestion"]>[0]) {
    return this.run((p) => p.answerVisitorQuestion(input));
  }
}

function createDefaultProviders(): Providers {
  const email =
    process.env.EMAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY
      ? new ResendEmailProvider(process.env.RESEND_API_KEY, process.env.EMAIL_FROM || "QuoteOS <quotes@example.com>")
      : new ConsoleEmailProvider();
  const heuristic = new HeuristicAIProvider();
  const ai =
    process.env.AI_PROVIDER === "anthropic" && process.env.ANTHROPIC_API_KEY
      ? new FallbackAIProvider(new AnthropicAIProvider(process.env.ANTHROPIC_API_KEY), heuristic)
      : heuristic;
  return {
    email,
    whatsapp: new LogChatProvider("whatsapp:log"),
    sms: new LogChatProvider("sms:log"),
    calendar: new LinkCalendarProvider(),
    crm: new InternalCRMProvider(),
    ai,
    analytics: new NoopAnalyticsProvider(),
  };
}

const g = globalThis as unknown as { __quoteosProviders?: Providers };

export function getProviders(): Providers {
  return (g.__quoteosProviders ??= createDefaultProviders());
}

export function setProvidersForTesting(overrides: Partial<Providers>): Providers {
  g.__quoteosProviders = { ...createDefaultProviders(), ...overrides };
  return g.__quoteosProviders;
}
