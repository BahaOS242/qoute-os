/**
 * Public (visitor-facing) quote flow. Server-authoritative:
 *  - sessions are bound to an organization and a secret token held by the browser
 *  - every answer is validated against the stored question definition
 *  - visibility, pricing and outcome are recomputed on the server at completion
 *  - prices, estimated values and statuses are never accepted from the client
 */
import type { Prisma, Quote, QuoteSession, Service } from "@prisma/client";
import { z } from "zod";
import { validateAnswer, validateSubmission, formatAnswer, type QuestionDef } from "@/core/questions";
import { resolveQuoteOutcome, outcomeHasPrice } from "@/core/quote";
import { buildLeadContext, qualifyLead } from "@/core/leads";
import type { Answers } from "@/core/conditions";
import { formatEstimate } from "@/lib/format";
import { prisma } from "../db";
import { badRequest, conflict, notFound, AppError } from "../errors";
import { randomToken, safeEqual, sha256 } from "../crypto";
import { recordEvent } from "../events";
import { loadEngineConfig, toQuestionDef } from "./config-loader";
import { dispatchAutomations, ensureReviewNotification, type AutomationTriggerInput } from "./automations";
import { getProviders } from "../providers";
import { stripPrices } from "../providers/ai/heuristic";

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

const attrString = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const attributionSchema = z.object({
  source: attrString(),
  medium: attrString(),
  campaign: attrString(),
  content: attrString(),
  term: attrString(),
  referrer: attrString(1000),
  landingPage: attrString(1000),
});
export type Attribution = z.infer<typeof attributionSchema>;

const REFERRER_SOURCES: [RegExp, string, string][] = [
  [/(^|\.)instagram\.com$/, "instagram", "social"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "facebook", "social"],
  [/(^|\.)linkedin\.com$|lnkd\.in$/, "linkedin", "social"],
  [/(^|\.)t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, "twitter", "social"],
  [/(^|\.)tiktok\.com$/, "tiktok", "social"],
  [/(^|\.)google\./, "google", "organic"],
  [/(^|\.)bing\.com$/, "bing", "organic"],
];

/**
 * Normalize attribution. UTM values win; otherwise the referrer host is classified; otherwise
 * the visit is "direct". Nothing is invented beyond what the browser reported.
 */
export function normalizeAttribution(a: Attribution, ownHost?: string | null): Attribution {
  const out = { ...a };
  out.source = out.source?.toLowerCase() ?? null;
  out.medium = out.medium?.toLowerCase() ?? null;
  out.campaign = out.campaign?.toLowerCase() ?? null;
  if (!out.source && out.referrer) {
    try {
      const host = new URL(out.referrer).hostname.replace(/^www\./, "");
      if (host && host !== ownHost) {
        const known = REFERRER_SOURCES.find(([re]) => re.test(host));
        out.source = known ? known[1] : host;
        out.medium ??= known ? known[2] : "referral";
      }
    } catch {
      /* ignore malformed referrer */
    }
  }
  if (!out.source) {
    out.source = "direct";
    out.medium ??= "none";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

async function findOrg(orgSlug: string) {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw notFound("Organization");
  return org;
}

/** Visitor-safe configuration: branding, active services and questions. No pricing data. */
export async function getPublicConfig(orgSlug: string) {
  const org = await findOrg(orgSlug);
  const services = await prisma.service.findMany({
    where: { organizationId: org.id, active: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { questions: { where: { active: true }, include: { options: true }, orderBy: { order: "asc" } } },
  });
  return {
    organization: {
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      brand: org.brand as Record<string, unknown>,
      templateKey: org.templateKey,
      currency: org.currency,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      website: org.website,
      hasBooking: !!org.bookingUrl,
    },
    services: services.map((s) => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      icon: s.icon,
      quoteMode: s.quoteMode,
      billingPeriod: s.billingPeriod,
      questions: s.questions.map(toQuestionDef),
    })),
  };
}
export type PublicConfig = Awaited<ReturnType<typeof getPublicConfig>>;
export type PublicService = PublicConfig["services"][number];

export async function recordView(orgSlug: string, input: { visitorId?: string | null; serviceSlug?: string | null; attribution: Attribution }) {
  const org = await findOrg(orgSlug);
  const attribution = normalizeAttribution(input.attribution);
  await recordEvent({
    organizationId: org.id,
    type: "QUOTE_VIEWED",
    visitorId: input.visitorId ?? null,
    payload: { service: input.serviceSlug ?? null, source: attribution.source, campaign: attribution.campaign },
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const startSessionSchema = z.object({
  serviceSlug: z.string().max(60).optional().nullable(),
  visitorId: z.string().max(100).optional().nullable(),
  attribution: attributionSchema.prefault({}),
});

export async function startSession(
  orgSlug: string,
  raw: z.input<typeof startSessionSchema>,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
) {
  const input = startSessionSchema.parse(raw);
  const org = await findOrg(orgSlug);
  let service: Service | null = null;
  if (input.serviceSlug) {
    service = await prisma.service.findFirst({ where: { organizationId: org.id, slug: input.serviceSlug, active: true } });
    if (!service) throw notFound("Service");
  }
  const token = randomToken();
  const a = normalizeAttribution(input.attribution);
  const session = await prisma.quoteSession.create({
    data: {
      organizationId: org.id,
      serviceId: service?.id ?? null,
      publicTokenHash: sha256(token),
      visitorId: input.visitorId ?? null,
      source: a.source,
      medium: a.medium,
      campaign: a.campaign,
      content: a.content,
      term: a.term,
      referrer: a.referrer,
      landingPage: a.landingPage,
      ipHash: meta.ipHash ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  await recordEvent({
    organizationId: org.id,
    type: "QUOTE_STARTED",
    visitorId: session.visitorId,
    quoteSessionId: session.id,
    serviceId: service?.id ?? null,
    payload: { source: a.source, campaign: a.campaign },
  });
  return { sessionId: session.id, token, serviceSlug: service?.slug ?? null };
}

/** Load a session for a visitor, verifying organization and token (constant-time). */
export async function authorizeSession(orgSlug: string, sessionId: string, token: string | null) {
  if (!token) throw new AppError(401, "unauthorized", "Missing session token");
  const session = await prisma.quoteSession.findFirst({
    where: { id: sessionId, organization: { slug: orgSlug } },
    include: { service: true, quote: true, lead: { select: { id: true, status: true } } },
  });
  if (!session || !safeEqual(session.publicTokenHash, sha256(token))) throw notFound("Quote session");
  return session;
}

type SessionWithRelations = Awaited<ReturnType<typeof authorizeSession>>;

export function toPublicSession(s: SessionWithRelations) {
  return {
    sessionId: s.id,
    serviceSlug: s.service?.slug ?? null,
    answers: s.answers as Answers,
    currentStep: s.currentStep,
    completed: !!s.completedAt,
    quote: s.quote ? toPublicQuote(s.quote) : null,
    leadSubmitted: !!s.lead,
  };
}

export const updateSessionSchema = z.object({
  serviceSlug: z.string().max(60).optional(),
  answers: z.record(z.string().max(60), z.unknown()).optional(),
  currentStep: z.number().int().min(0).max(500).optional(),
});

export async function updateSession(orgSlug: string, sessionId: string, token: string | null, raw: z.input<typeof updateSessionSchema>) {
  const input = updateSessionSchema.parse(raw);
  const session = await authorizeSession(orgSlug, sessionId, token);
  if (session.completedAt) throw conflict("This quote is already complete. Start a new quote to change your answers.");

  let serviceId = session.serviceId;
  let answers = { ...((session.answers ?? {}) as Answers) };
  if (input.serviceSlug && input.serviceSlug !== session.service?.slug) {
    const service = await prisma.service.findFirst({
      where: { organizationId: session.organizationId, slug: input.serviceSlug, active: true },
    });
    if (!service) throw notFound("Service");
    serviceId = service.id;
    answers = {};
  }

  const answeredKeys: string[] = [];
  if (input.answers && Object.keys(input.answers).length) {
    if (!serviceId) throw badRequest("Choose a service before answering questions");
    const { questions } = await loadEngineConfig(session.organizationId, serviceId);
    const byKey = new Map(questions.map((q) => [q.key, q]));
    const errors: Record<string, string> = {};
    for (const [key, raw] of Object.entries(input.answers)) {
      const q = byKey.get(key);
      if (!q) {
        errors[key] = "Unknown question";
        continue;
      }
      // Partial saves allow blanks; required-ness is enforced at completion.
      const r = validateAnswer({ ...q, required: false }, raw);
      if (!r.ok) errors[key] = r.error;
      else if (r.value === undefined) delete answers[key];
      else {
        answers[key] = r.value;
        answeredKeys.push(key);
      }
    }
    if (Object.keys(errors).length) throw badRequest("Some answers are invalid", { fields: errors });
  }

  const updated = await prisma.quoteSession.update({
    where: { id: session.id },
    data: {
      serviceId,
      answers: answers as Prisma.InputJsonValue,
      currentStep: input.currentStep ?? session.currentStep,
      lastActivityAt: new Date(),
      abandonedAt: null,
    },
    include: { service: true, quote: true, lead: { select: { id: true, status: true } } },
  });
  for (const key of answeredKeys) {
    await recordEvent({
      organizationId: session.organizationId,
      type: "QUESTION_ANSWERED",
      quoteSessionId: session.id,
      visitorId: session.visitorId,
      serviceId,
      payload: { key, step: updated.currentStep },
    });
  }
  return toPublicSession(updated);
}

// ---------------------------------------------------------------------------
// Completion -> immutable quote
// ---------------------------------------------------------------------------

export interface AnswerSnapshotItem {
  key: string;
  label: string;
  value: unknown;
  display: string;
}

export interface ServiceSnapshot {
  name: string;
  slug: string;
  quoteMode: string;
  basePriceCents: number;
  minimumPriceCents: number | null;
  billingPeriod: string;
  inclusions: string[];
  assumptions: string[];
}

export function buildAnswerSnapshot(questions: QuestionDef[], answers: Answers, currency: string): AnswerSnapshotItem[] {
  return questions
    .filter((q) => answers[q.key] !== undefined)
    .map((q) => ({ key: q.key, label: q.label, value: answers[q.key], display: formatAnswer(q, answers[q.key], currency) }));
}

export type PublicQuote = ReturnType<typeof toPublicQuote>;

/** Visitor-facing view of a stored quote (built only from the immutable snapshot). */
export function toPublicQuote(q: Quote) {
  const svc = q.serviceSnapshot as unknown as ServiceSnapshot;
  const calc = q.calculation as unknown as {
    basePriceCents: number;
    adjustments: { ruleName: string; amountCents: number }[];
    minimumApplied: boolean;
    totalCents: number;
  } | null;
  const kind: "PRICE" | "RANGE" | "REVIEW" | "CONTACT" =
    q.status === "NEEDS_REVIEW" ? "REVIEW"
    : q.status === "CONTACT_REQUESTED" ? "CONTACT"
    : q.rangeLowCents !== null ? "RANGE"
    : q.estimatedPriceCents !== null ? "PRICE"
    : q.quoteMode === "CONTACT_ONLY" ? "CONTACT"
    : "REVIEW";
  const priced = kind === "PRICE" || kind === "RANGE";
  return {
    quoteId: q.id,
    kind,
    serviceName: svc.name,
    currency: q.currency,
    billingPeriod: q.billingPeriod,
    priceCents: priced ? q.estimatedPriceCents : null,
    lowCents: kind === "RANGE" ? q.rangeLowCents : null,
    highCents: kind === "RANGE" ? q.rangeHighCents : null,
    display: priced ? formatEstimate(q) : null,
    breakdown:
      priced && calc
        ? {
            basePriceCents: kind === "PRICE" ? calc.basePriceCents : null,
            items: calc.adjustments.map((a) => ({ label: a.ruleName, amountCents: kind === "PRICE" ? a.amountCents : null })),
            minimumApplied: calc.minimumApplied,
          }
        : null,
    inclusions: svc.inclusions ?? [],
    assumptions: svc.assumptions ?? [],
    expiresAt: q.expiresAt,
    generatedAt: q.generatedAt,
  };
}

export async function completeSession(orgSlug: string, sessionId: string, token: string | null) {
  const session = await authorizeSession(orgSlug, sessionId, token);
  if (session.quote) return toPublicQuote(session.quote); // idempotent
  if (!session.serviceId) throw badRequest("Choose a service first");

  const org = await prisma.organization.findUniqueOrThrow({ where: { id: session.organizationId } });
  const { service, questions, rules } = await loadEngineConfig(org.id, session.serviceId);
  if (!service.active) throw badRequest("This service is no longer available");

  const submission = validateSubmission(questions, (session.answers ?? {}) as Answers);
  if (!submission.ok) throw badRequest("Please answer the remaining questions", { fields: submission.errors });

  const outcome = resolveQuoteOutcome({
    service: {
      quoteMode: service.quoteMode,
      basePriceCents: service.basePriceCents,
      minimumPriceCents: service.minimumPriceCents,
      estimateRangePercent: service.estimateRangePercent,
      currency: org.currency,
    },
    rules,
    answers: submission.answers,
  });

  const serviceSnapshot: ServiceSnapshot = {
    name: service.name,
    slug: service.slug,
    quoteMode: service.quoteMode,
    basePriceCents: service.basePriceCents,
    minimumPriceCents: service.minimumPriceCents,
    billingPeriod: service.billingPeriod,
    inclusions: service.inclusions,
    assumptions: service.assumptions,
  };
  const now = new Date();
  const status = outcome.kind === "REVIEW" ? "NEEDS_REVIEW" : outcome.kind === "CONTACT" ? "CONTACT_REQUESTED" : "ESTIMATED";

  const quote = await prisma.$transaction(async (tx) => {
    // Guard against double-completion races: only one request can flip completedAt.
    const flipped = await tx.quoteSession.updateMany({
      where: { id: session.id, completedAt: null },
      data: { completedAt: now, lastActivityAt: now, abandonedAt: null, answers: submission.answers as Prisma.InputJsonValue },
    });
    if (flipped.count === 0) throw conflict("Quote already completed");
    return tx.quote.create({
      data: {
        organizationId: org.id,
        quoteSessionId: session.id,
        serviceId: service.id,
        quoteMode: service.quoteMode,
        status,
        answersSnapshot: buildAnswerSnapshot(questions, submission.answers, org.currency) as unknown as Prisma.InputJsonValue,
        serviceSnapshot: serviceSnapshot as unknown as Prisma.InputJsonValue,
        calculation: (outcome.calculation ?? undefined) as Prisma.InputJsonValue | undefined,
        estimatedPriceCents: outcomeHasPrice(outcome) ? outcome.priceCents : null,
        rangeLowCents: outcome.kind === "RANGE" ? outcome.lowCents : null,
        rangeHighCents: outcome.kind === "RANGE" ? outcome.highCents : null,
        billingPeriod: service.billingPeriod,
        currency: org.currency,
        expiresAt: outcomeHasPrice(outcome) ? new Date(now.getTime() + org.quoteValidityDays * 86_400_000) : null,
        generatedAt: now,
      },
    });
  });

  await recordEvent({
    organizationId: org.id,
    type: "QUOTE_COMPLETED",
    quoteSessionId: session.id,
    quoteId: quote.id,
    visitorId: session.visitorId,
    serviceId: service.id,
    payload: { outcome: outcome.kind, estimatedPriceCents: quote.estimatedPriceCents, reasons: outcome.kind === "REVIEW" ? outcome.reasons : undefined },
  });
  await dispatchAutomations([{ organizationId: org.id, trigger: "QUOTE_COMPLETED", quoteSessionId: session.id }]);
  return toPublicQuote(quote);
}

// ---------------------------------------------------------------------------
// Lead capture
// ---------------------------------------------------------------------------

export const leadInputSchema = z.object({
  name: z.string().trim().min(1, "Please tell us your name").max(120),
  company: z.string().trim().max(160).optional().nullable(),
  email: z.string().trim().toLowerCase().email("Please enter a valid email").max(254),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9 ()\-.]{7,20}$/, "Please enter a valid phone number")
    .optional()
    .nullable()
    .or(z.literal("")),
  message: z.string().trim().max(2000).optional().nullable(),
  /** Honeypot: real visitors never fill this hidden field. */
  website: z.string().max(0, "Invalid submission").optional().or(z.literal("")),
});

export async function submitLead(orgSlug: string, sessionId: string, token: string | null, raw: z.input<typeof leadInputSchema>) {
  // Services validate their own input: callers other than the route handler get the same guarantees.
  const input = leadInputSchema.parse(raw);
  const session = await authorizeSession(orgSlug, sessionId, token);
  if (!session.quote || !session.completedAt) throw badRequest("Please finish the quote first");
  if (session.lead) throw conflict("We already have your details for this quote");

  const quote = session.quote;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: session.organizationId } });
  const answersSnapshot = quote.answersSnapshot as unknown as AnswerSnapshotItem[];
  const answers = Object.fromEntries(answersSnapshot.map((a) => [a.key, a.value]));

  // Lead attribute mapping (industry/urgency/company) is configured per question.
  const leadFieldQuestions = session.serviceId
    ? await prisma.question.findMany({
        where: { organizationId: org.id, serviceId: session.serviceId, leadField: { not: null } },
        select: { key: true, leadField: true },
      })
    : [];
  const mapped: Record<string, string> = {};
  for (const q of leadFieldQuestions) {
    const item = answersSnapshot.find((a) => a.key === q.key);
    if (item && q.leadField) mapped[q.leadField] = item.display;
  }

  const serviceSlug = (quote.serviceSnapshot as unknown as ServiceSnapshot).slug;
  const leadRules = await prisma.leadRule.findMany({
    where: { organizationId: org.id, active: true, OR: [{ serviceId: null }, { serviceId: session.serviceId ?? undefined }] },
  });
  const qualification = qualifyLead(
    leadRules.map((r) => ({ name: r.name, priority: r.priority, condition: r.condition, action: r.action, active: r.active })),
    buildLeadContext(answers, {
      service: serviceSlug,
      estimatedValueCents: quote.estimatedPriceCents,
      source: session.source,
      medium: session.medium,
      campaign: session.campaign,
      quoteMode: quote.quoteMode,
    }),
  );

  let ownerId: string | null = null;
  if (qualification.assignToEmail) {
    const m = await prisma.membership.findFirst({
      where: { organizationId: org.id, user: { email: qualification.assignToEmail } },
    });
    ownerId = m?.userId ?? null;
  }

  const needsReview = quote.status === "NEEDS_REVIEW" || qualification.needsReview;
  const lead = await prisma.lead.create({
    data: {
      organizationId: org.id,
      quoteId: quote.id,
      quoteSessionId: session.id,
      serviceId: session.serviceId,
      name: input.name,
      company: input.company || mapped.company || null,
      email: input.email,
      phone: input.phone || null,
      industry: mapped.industry ?? null,
      urgency: mapped.urgency ?? null,
      qualification: { ...qualification, message: input.message ?? null } as unknown as Prisma.InputJsonValue,
      score: qualification.score,
      intent: qualification.intent,
      // Estimated value comes from the stored quote, never from the request.
      estimatedValueCents: quote.estimatedPriceCents,
      billingPeriod: quote.estimatedPriceCents !== null ? quote.billingPeriod : null,
      currency: quote.currency,
      status: needsReview ? "NEEDS_REVIEW" : "NEW",
      ownerId,
      source: session.source,
      medium: session.medium,
      campaign: session.campaign,
      content: session.content,
      term: session.term,
      referrer: session.referrer,
      landingPage: session.landingPage,
    },
  });

  await recordEvent({
    organizationId: org.id,
    type: "LEAD_CREATED",
    leadId: lead.id,
    quoteId: quote.id,
    quoteSessionId: session.id,
    visitorId: session.visitorId,
    serviceId: session.serviceId,
    payload: { status: lead.status, intent: lead.intent, estimatedValueCents: lead.estimatedValueCents, source: lead.source, campaign: lead.campaign },
  });
  if (input.message) {
    await prisma.leadNote.create({ data: { leadId: lead.id, body: `Message from visitor: ${input.message}` } });
  }

  // Deterministic summary by default; AI-generated when an AI provider is configured.
  try {
    const summary = await getProviders().ai.summarizeLead({
      organizationName: org.name,
      company: lead.company,
      contactName: lead.name,
      serviceName: (quote.serviceSnapshot as unknown as ServiceSnapshot).name,
      answers: answersSnapshot.map((a) => ({ label: a.label, display: a.display })),
      estimate: formatEstimate(quote),
      urgency: lead.urgency,
    });
    await prisma.lead.update({ where: { id: lead.id }, data: { summary: summary.slice(0, 2000) } });
  } catch (e) {
    console.warn("[lead] summary failed", (e as Error).message);
  }

  const triggers: AutomationTriggerInput[] = [{ organizationId: org.id, trigger: "LEAD_CREATED", leadId: lead.id }];
  const highValue =
    lead.estimatedValueCents !== null && org.highValueThresholdCents !== null && lead.estimatedValueCents >= org.highValueThresholdCents;
  if (highValue) triggers.push({ organizationId: org.id, trigger: "HIGH_VALUE_LEAD", leadId: lead.id });
  if (needsReview) triggers.push({ organizationId: org.id, trigger: "NEEDS_REVIEW", leadId: lead.id });
  await dispatchAutomations(triggers);
  if (needsReview) await ensureReviewNotification(org.id, lead.id).catch((e) => console.error("[lead] review notify failed", e));

  const bookingUrl = getProviders().calendar.bookingUrl({ baseUrl: org.bookingUrl, name: lead.name, email: lead.email, leadId: lead.id });
  return { leadId: lead.id, status: lead.status, bookingUrl };
}

// ---------------------------------------------------------------------------
// Abandonment
// ---------------------------------------------------------------------------

/** Mark idle, incomplete sessions as abandoned and fire QUOTE_ABANDONED. Safe to run repeatedly. */
export async function markAbandonedSessions(opts: { idleMinutes?: number; now?: Date; organizationId?: string } = {}) {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.idleMinutes ?? 30) * 60_000);
  const stale = await prisma.quoteSession.findMany({
    where: {
      completedAt: null,
      abandonedAt: null,
      lastActivityAt: { lt: cutoff },
      ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
    },
    take: 500,
  });
  const marked: QuoteSession[] = [];
  for (const s of stale) {
    const r = await prisma.quoteSession.updateMany({ where: { id: s.id, abandonedAt: null, completedAt: null }, data: { abandonedAt: now } });
    if (!r.count) continue;
    marked.push(s);
    await recordEvent({
      organizationId: s.organizationId,
      type: "QUOTE_ABANDONED",
      quoteSessionId: s.id,
      visitorId: s.visitorId,
      serviceId: s.serviceId,
      payload: { step: s.currentStep, answered: Object.keys((s.answers ?? {}) as object).length },
    });
    await dispatchAutomations([{ organizationId: s.organizationId, trigger: "QUOTE_ABANDONED", quoteSessionId: s.id }]);
  }
  return { abandoned: marked.length };
}

// ---------------------------------------------------------------------------
// Conversational assistance
// ---------------------------------------------------------------------------

export const assistantSchema = z.object({
  question: z.string().trim().min(2).max(500),
  serviceSlug: z.string().max(60).optional().nullable(),
  questionKey: z.string().max(60).optional().nullable(),
});

export async function askAssistant(orgSlug: string, raw: z.input<typeof assistantSchema>) {
  const input = assistantSchema.parse(raw);
  const org = await findOrg(orgSlug);
  const service = input.serviceSlug
    ? await prisma.service.findFirst({ where: { organizationId: org.id, slug: input.serviceSlug, active: true } })
    : null;
  const q =
    service && input.questionKey
      ? await prisma.question.findFirst({ where: { organizationId: org.id, serviceId: service.id, key: input.questionKey } })
      : null;
  const glossary = (Array.isArray(org.glossary) ? org.glossary : []) as { term: string; definition: string }[];
  const context = [
    q ? `CURRENT QUESTION: ${q.label}` : "",
    q?.helpText ? `HELP: ${q.helpText}` : "",
    ...glossary.map((g) => `GLOSSARY ${g.term}: ${g.definition}`),
  ]
    .filter(Boolean)
    .join("\n");
  const answer = await getProviders().ai.answerVisitorQuestion({
    organizationName: org.name,
    serviceName: service?.name ?? null,
    question: input.question,
    context,
  });
  // Deterministic pricing guard: assistants may explain, never quote.
  return { answer: stripPrices(answer).slice(0, 1500) };
}
