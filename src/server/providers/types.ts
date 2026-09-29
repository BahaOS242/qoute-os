/**
 * Provider interfaces. Core business logic depends only on these contracts, never on a vendor SDK.
 * Add a vendor by implementing an interface and registering it in ./index.ts.
 */
import type { QuoteConfig } from "@/core/config/schema";

export interface SendResult {
  /** Provider-side message id (or a local id for log providers). */
  id: string;
  /** "sent" when handed to a real provider, "logged" when only recorded locally. */
  status: "sent" | "logged";
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  fromName?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export interface ChatMessage {
  to: string;
  body: string;
}

export interface WhatsAppProvider {
  readonly name: string;
  send(message: ChatMessage): Promise<SendResult>;
}

export interface SMSProvider {
  readonly name: string;
  send(message: ChatMessage): Promise<SendResult>;
}

export interface CalendarProvider {
  readonly name: string;
  /** Booking link for a lead (prefilled where the provider supports it), or null. */
  bookingUrl(input: { baseUrl: string | null; name: string; email: string; leadId: string }): string | null;
}

export interface CRMContact {
  leadId: string;
  organizationId: string;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  service?: string | null;
  estimatedValueCents?: number | null;
  source?: string | null;
}

export interface CRMProvider {
  readonly name: string;
  upsertContact(contact: CRMContact): Promise<{ externalId: string }>;
}

export interface AnalyticsEvent {
  type: string;
  organizationId: string;
  properties: Record<string, unknown>;
  at: Date;
}

export interface AnalyticsProvider {
  readonly name: string;
  track(event: AnalyticsEvent): Promise<void>;
}

export interface ConfigProposalResult {
  /** Partial QuoteConfig; always re-validated by validateQuoteConfig before storage. */
  config: Partial<QuoteConfig> & { services: QuoteConfig["services"] };
  explanation: string;
}

export interface LeadSummaryInput {
  organizationName: string;
  company: string | null;
  contactName: string;
  serviceName: string;
  answers: { label: string; display: string }[];
  estimate: string | null;
  urgency: string | null;
}

export interface AssistantInput {
  organizationName: string;
  serviceName: string | null;
  question: string;
  /** Visitor-facing context: current question label/help text and glossary entries. */
  context: string;
}

export interface AIProvider {
  readonly name: string;
  /** Convert an admin's natural-language description into a proposed configuration. */
  proposeConfig(input: {
    prompt: string;
    currency: string;
    existingService?: { slug: string; name: string; questions: { key: string; label: string; type: string }[] } | null;
  }): Promise<ConfigProposalResult>;
  /** Short plain-English summary of a lead for staff. Never includes invented prices. */
  summarizeLead(input: LeadSummaryInput): Promise<string>;
  /** Explain terminology to a visitor. Must not quote prices. */
  answerVisitorQuestion(input: AssistantInput): Promise<string>;
}

export interface Providers {
  email: EmailProvider;
  whatsapp: WhatsAppProvider;
  sms: SMSProvider;
  calendar: CalendarProvider;
  crm: CRMProvider;
  ai: AIProvider;
  analytics: AnalyticsProvider;
}
