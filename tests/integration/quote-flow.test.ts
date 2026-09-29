import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  completeSession,
  getPublicConfig,
  markAbandonedSessions,
  startSession,
  submitLead,
  updateSession,
  authorizeSession,
  toPublicSession,
  askAssistant,
} from "@/server/services/quote-flow";
import { updatePricingRule } from "@/server/services/config-admin";
import { bookkeepingAnswers, createAccountingOrg, resetDb, testProviders } from "./helpers";

const instagram = {
  source: "Instagram",
  medium: "paid_social",
  campaign: "bookkeeping-september",
  content: "reel-1",
  term: null,
  referrer: "https://l.instagram.com/",
  landingPage: "https://demo.test/q/acme?utm_source=instagram",
};

let providers: ReturnType<typeof testProviders>;

beforeEach(async () => {
  await resetDb();
  providers = testProviders();
});

async function completeBookkeeping(slug: string, answers: Record<string, unknown> = bookkeepingAnswers) {
  const s = await startSession(slug, { serviceSlug: "bookkeeping", visitorId: "v-1", attribution: instagram });
  await updateSession(slug, s.sessionId, s.token, { answers, currentStep: 5 });
  const quote = await completeSession(slug, s.sessionId, s.token);
  return { ...s, quote };
}

describe("public quote flow", () => {
  it("public config exposes questions but never pricing rules or base prices", async () => {
    await createAccountingOrg("acme");
    const cfg = await getPublicConfig("acme");
    expect(cfg.services.map((s) => s.slug)).toContain("bookkeeping");
    const json = JSON.stringify(cfg);
    expect(json).not.toMatch(/pricingRules|basePriceCents|amountCents|webhookSecret/);
  });

  it("starts, resumes, answers conditionally and completes with a server-side price", async () => {
    await createAccountingOrg("acme");
    const s = await startSession("acme", { serviceSlug: "bookkeeping", visitorId: "v-1", attribution: instagram });
    expect(s.token.length).toBeGreaterThan(30);

    await updateSession("acme", s.sessionId, s.token, { answers: { monthlyTransactions: 340, payroll: true }, currentStep: 2 });
    // Resume from a fresh request
    const resumed = toPublicSession(await authorizeSession("acme", s.sessionId, s.token));
    expect(resumed.answers).toEqual({ monthlyTransactions: 340, payroll: true });
    expect(resumed.currentStep).toBe(2);

    // Required conditional question (employees, shown because payroll=true) blocks completion
    await expect(completeSession("acme", s.sessionId, s.token)).rejects.toMatchObject({ status: 400 });

    await updateSession("acme", s.sessionId, s.token, { answers: bookkeepingAnswers });
    const quote = await completeSession("acme", s.sessionId, s.token);
    expect(quote.kind).toBe("PRICE");
    expect(quote.priceCents).toBe(51_500);
    expect(quote.display).toBe("$515/month");
    expect(quote.breakdown?.items.map((i) => i.label)).toEqual([
      "Transaction volume over 250",
      "2–3 bank accounts",
      "Payroll",
      "Payroll per employee (after 5)",
    ]);
    // Completing again is idempotent and returns the same stored quote
    expect((await completeSession("acme", s.sessionId, s.token)).quoteId).toBe(quote.quoteId);
  });

  it("drops answers to questions hidden by later changes before pricing", async () => {
    await createAccountingOrg("acme");
    const { quote } = await completeBookkeeping("acme", { ...bookkeepingAnswers, payroll: false, employees: 500 });
    expect(quote.priceCents).toBe(40_000); // 250 + 100 + 50, employees ignored
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quote.quoteId } });
    expect((stored.answersSnapshot as { key: string }[]).map((a) => a.key)).not.toContain("employees");
  });

  it("rejects invalid, unknown and out-of-range answers", async () => {
    await createAccountingOrg("acme");
    const s = await startSession("acme", { serviceSlug: "bookkeeping", attribution: {} });
    await expect(updateSession("acme", s.sessionId, s.token, { answers: { monthlyTransactions: "lots" } })).rejects.toMatchObject({ status: 400 });
    await expect(updateSession("acme", s.sessionId, s.token, { answers: { price: 1 } })).rejects.toMatchObject({ status: 400 });
    await expect(updateSession("acme", s.sessionId, s.token, { answers: { accountingSoftware: "excel-hack" } })).rejects.toMatchObject({ status: 400 });
    await expect(updateSession("acme", s.sessionId, s.token, { answers: { bankAccounts: 0 } })).rejects.toMatchObject({ status: 400 });
  });

  it("requires the session token and the owning organization", async () => {
    await createAccountingOrg("acme");
    await createAccountingOrg("globex");
    const s = await startSession("acme", { serviceSlug: "bookkeeping", attribution: {} });
    await expect(updateSession("acme", s.sessionId, "wrong-token", { currentStep: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(updateSession("acme", s.sessionId, null, { currentStep: 1 })).rejects.toMatchObject({ status: 401 });
    await expect(updateSession("globex", s.sessionId, s.token, { currentStep: 1 })).rejects.toMatchObject({ status: 404 });
  });

  it("creates a lead that preserves attribution, snapshot and server-side value", async () => {
    const { org } = await createAccountingOrg("acme");
    const { sessionId, token, quote } = await completeBookkeeping("acme");
    const result = await submitLead("acme", sessionId, token, {
      name: "Jane Builder",
      company: "ABC Construction",
      email: "Jane@ABC.test",
      phone: "+1 242 555 0100",
      // Extra fields a tampering client might send are not part of the schema and are ignored.
      ...({ estimatedValueCents: 1, status: "WON" } as object),
    });
    expect(result.status).toBe("NEW");

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { quote: true } });
    expect(lead.organizationId).toBe(org.id);
    expect(lead.email).toBe("jane@abc.test");
    expect(lead.estimatedValueCents).toBe(quote.priceCents);
    expect(lead.billingPeriod).toBe("MONTHLY");
    expect(lead.source).toBe("instagram");
    expect(lead.medium).toBe("paid_social");
    expect(lead.campaign).toBe("bookkeeping-september");
    expect(lead.content).toBe("reel-1");
    expect(lead.landingPage).toContain("utm_source=instagram");
    expect(lead.industry).toBe("Construction & trades");
    expect(lead.urgency).toBe("Within 30 days");
    // 10 completed + 40 value + 20 urgent + 10 payroll = 80
    expect(lead.score).toBe(80);
    expect(lead.intent).toBe("HIGH");
    expect((lead.qualification as { tags: string[] }).tags).toContain("paid");
    expect(lead.summary).toMatch(/ABC Construction appears to need bookkeeping/);
    expect(lead.quote?.calculation).toBeTruthy();

    const events = await prisma.event.findMany({ where: { quoteSessionId: sessionId }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["QUOTE_STARTED", "QUESTION_ANSWERED", "QUOTE_COMPLETED", "LEAD_CREATED"]));

    // Automations: staff notification (brief format) + estimate confirmation to the visitor
    const staff = providers.email.outbox.find((m) => m.to === "staff@acme.test");
    expect(staff?.text).toContain("New qualified lead");
    expect(staff?.text).toContain("ABC Construction");
    expect(staff?.text).toContain("$515/month");
    expect(staff?.text).toContain("Instagram");
    expect(staff?.text).toContain("Within 30 days");
    expect(providers.email.outbox.find((m) => m.to === "jane@abc.test")?.subject).toBe("Your Bookkeeping estimate from acme Accounting");
    // High-value (>= $500) follow-up task
    expect(await prisma.task.count({ where: { leadId: lead.id } })).toBe(1);
    // Disabled WhatsApp automation did not run
    expect(providers.whatsapp.outbox).toHaveLength(0);

    await expect(submitLead("acme", sessionId, token, { name: "Again", email: "a@b.co" })).rejects.toMatchObject({ status: 409 });
  });

  it("refuses leads before the quote is complete and rejects honeypot/invalid input", async () => {
    await createAccountingOrg("acme");
    const s = await startSession("acme", { serviceSlug: "bookkeeping", attribution: {} });
    await expect(submitLead("acme", s.sessionId, s.token, { name: "X", email: "x@y.co" })).rejects.toMatchObject({ status: 400 });
    const { leadInputSchema } = await import("@/server/services/quote-flow");
    expect(leadInputSchema.safeParse({ name: "Bot", email: "b@b.co", website: "spam" }).success).toBe(false);
    expect(leadInputSchema.safeParse({ name: "X", email: "not-an-email" }).success).toBe(false);
  });

  it("derives attribution from the referrer and falls back to direct", async () => {
    await createAccountingOrg("acme");
    const a = await startSession("acme", { serviceSlug: "bookkeeping", attribution: { referrer: "https://www.google.com/search?q=x" } });
    const b = await startSession("acme", { serviceSlug: "bookkeeping", attribution: {} });
    const [sa, sb] = await Promise.all([
      prisma.quoteSession.findUniqueOrThrow({ where: { id: a.sessionId } }),
      prisma.quoteSession.findUniqueOrThrow({ where: { id: b.sessionId } }),
    ]);
    expect([sa.source, sa.medium]).toEqual(["google", "organic"]);
    expect([sb.source, sb.medium]).toEqual(["direct", "none"]);
  });
});

describe("historical quote immutability", () => {
  it("changing pricing rules affects new quotes but never existing ones", async () => {
    const { ctx } = await createAccountingOrg("acme");
    const first = await completeBookkeeping("acme");
    expect(first.quote.priceCents).toBe(51_500);
    const before = await prisma.quote.findUniqueOrThrow({ where: { id: first.quote.quoteId } });

    const rule = await prisma.pricingRule.findFirstOrThrow({ where: { organizationId: ctx.organizationId, key: "payroll" } });
    await updatePricingRule(ctx, rule.id, { action: { type: "ADD", amountCents: 20_000 } });
    await prisma.service.updateMany({ where: { organizationId: ctx.organizationId, slug: "bookkeeping" }, data: { basePriceCents: 30_000 } });

    const second = await completeBookkeeping("acme");
    expect(second.quote.priceCents).toBe(30_000 + 10_000 + 5_000 + 20_000 + 1_500);

    const after = await prisma.quote.findUniqueOrThrow({ where: { id: first.quote.quoteId } });
    expect(after.estimatedPriceCents).toBe(51_500);
    expect(after.calculation).toEqual(before.calculation);
    expect(after.serviceSnapshot).toEqual(before.serviceSnapshot);
    const snapRule = (after.calculation as { rules: { key: string; action: unknown }[] }).rules.find((r) => r.key === "payroll");
    expect(snapRule?.action).toEqual({ type: "ADD", amountCents: 10_000 });
  });

  it("does not allow answers to change after completion", async () => {
    await createAccountingOrg("acme");
    const { sessionId, token } = await completeBookkeeping("acme");
    await expect(updateSession("acme", sessionId, token, { answers: { monthlyTransactions: 1 } })).rejects.toMatchObject({ status: 409 });
  });
});

describe("human review path", () => {
  it("HUMAN_REVIEW services never produce a price and create NEEDS_REVIEW leads with staff notification", async () => {
    await createAccountingOrg("acme");
    const s = await startSession("acme", { serviceSlug: "audit", attribution: {} });
    await updateSession("acme", s.sessionId, s.token, {
      answers: { auditType: "lender", annualRevenue: 4_000_000, entities: 2, timeline: "within_30_days" },
    });
    const quote = await completeSession("acme", s.sessionId, s.token);
    expect(quote.kind).toBe("REVIEW");
    expect(quote.priceCents).toBeNull();
    expect(quote.display).toBeNull();
    expect(quote.breakdown).toBeNull();

    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quote.quoteId } });
    expect(stored.status).toBe("NEEDS_REVIEW");
    expect(stored.estimatedPriceCents).toBeNull();
    expect(stored.calculation).toBeNull();

    const r = await submitLead("acme", s.sessionId, s.token, { name: "Pat Partner", company: "Big Co", email: "pat@bigco.test" });
    expect(r.status).toBe("NEEDS_REVIEW");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId } });
    expect(lead.estimatedValueCents).toBeNull();
    expect(lead.intent).toBe("HIGH"); // lead rule: audit is partner-led

    const staffMail = providers.email.outbox.filter((m) => m.to === "staff@acme.test");
    expect(staffMail).toHaveLength(1);
    expect(staffMail[0].text).toContain("New lead needs review");
    expect(staffMail[0].text).toContain("Personalized review");
    expect(providers.email.outbox.some((m) => m.to === "pat@bigco.test" && /received your Audit request/.test(m.subject))).toBe(true);
  });

  it("a REQUIRE_REVIEW rule turns an instant service into a review without leaking the price", async () => {
    await createAccountingOrg("acme");
    const { quote } = await completeBookkeeping("acme", { ...bookkeepingAnswers, monthlyTransactions: 9_000 });
    expect(quote.kind).toBe("REVIEW");
    expect(quote.priceCents).toBeNull();
    const stored = await prisma.quote.findUniqueOrThrow({ where: { id: quote.quoteId } });
    expect(stored.estimatedPriceCents).toBeNull();
    // The internal calculation is kept for staff
    expect((stored.calculation as { requiresReview: boolean }).requiresReview).toBe(true);
  });

  it("notifies staff even when an organization has no review automation", async () => {
    const { org } = await createAccountingOrg("acme");
    await prisma.automation.deleteMany({ where: { organizationId: org.id } });
    const s = await startSession("acme", { serviceSlug: "audit", attribution: {} });
    await updateSession("acme", s.sessionId, s.token, { answers: { auditType: "grant", annualRevenue: 10, entities: 1, timeline: "researching" } });
    await completeSession("acme", s.sessionId, s.token);
    await submitLead("acme", s.sessionId, s.token, { name: "Sam", email: "sam@x.test" });
    expect(providers.email.outbox.filter((m) => m.to === "staff@acme.test")).toHaveLength(1);
  });

  it("ESTIMATE services return a range, CONTACT_ONLY services return no price", async () => {
    await createAccountingOrg("acme");
    const v = await startSession("acme", { serviceSlug: "vat", attribution: {} });
    await updateSession("acme", v.sessionId, v.token, {
      answers: { businessType: "company", monthlyRevenue: 80_000, vatRegistered: "yes", filingFrequency: "quarterly", importsExports: false, timeline: "researching" },
    });
    const vat = await completeSession("acme", v.sessionId, v.token);
    expect(vat.kind).toBe("RANGE");
    expect([vat.lowCents, vat.priceCents, vat.highCents]).toEqual([25_500, 30_000, 34_500]);
    expect(vat.breakdown?.items.every((i) => i.amountCents === null)).toBe(true);

    const a = await startSession("acme", { serviceSlug: "financial-advisory", attribution: {} });
    await updateSession("acme", a.sessionId, a.token, { answers: { goals: ["cfo"], companyStage: "growing", timeline: "within_30_days" } });
    const adv = await completeSession("acme", a.sessionId, a.token);
    expect(adv.kind).toBe("CONTACT");
    expect(adv.priceCents).toBeNull();
  });
});

describe("abandonment", () => {
  it("marks idle sessions abandoned once, and resuming clears it", async () => {
    await createAccountingOrg("acme");
    const s = await startSession("acme", { serviceSlug: "bookkeeping", attribution: {} });
    await updateSession("acme", s.sessionId, s.token, { answers: { monthlyTransactions: 50 } });
    const done = await completeBookkeeping("acme");

    const future = new Date(Date.now() + 60 * 60_000);
    expect(await markAbandonedSessions({ now: future })).toEqual({ abandoned: 1 });
    expect(await markAbandonedSessions({ now: future })).toEqual({ abandoned: 0 });
    const abandoned = await prisma.quoteSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    expect(abandoned.abandonedAt).not.toBeNull();
    expect((await prisma.quoteSession.findUniqueOrThrow({ where: { id: done.sessionId } })).abandonedAt).toBeNull();
    expect(await prisma.event.count({ where: { type: "QUOTE_ABANDONED" } })).toBe(1);

    await updateSession("acme", s.sessionId, s.token, { answers: { bankAccounts: 1 } });
    expect((await prisma.quoteSession.findUniqueOrThrow({ where: { id: s.sessionId } })).abandonedAt).toBeNull();
  });
});

describe("conversational assistance", () => {
  it("explains terminology from the glossary and never quotes prices", async () => {
    await createAccountingOrg("acme");
    const r = await askAssistant("acme", { question: "What counts as a transaction?", serviceSlug: "bookkeeping", questionKey: "monthlyTransactions" });
    expect(r.answer).toMatch(/money movement/);
    const p = await askAssistant("acme", { question: "How much does it cost?", serviceSlug: "bookkeeping" });
    expect(p.answer).not.toMatch(/\$\d/);
  });
});
