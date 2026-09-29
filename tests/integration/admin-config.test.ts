import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  createPricingRule,
  createQuestion,
  createService,
  deleteService,
  previewQuote,
  reorderQuestions,
  updateQuestion,
  upsertAutomation,
  upsertMessageTemplate,
} from "@/server/services/config-admin";
import { applyQuoteConfig, exportQuoteConfig } from "@/server/services/config-io";
import { createOrganization } from "@/server/services/organizations";
import { createProposal, decideProposal } from "@/server/services/ai-config";
import { completeSession, getPublicConfig, startSession, submitLead, updateSession } from "@/server/services/quote-flow";
import { updateLead } from "@/server/services/leads";
import { handleBookingWebhook, signWebhook } from "@/server/services/webhooks";
import { getAnalytics } from "@/server/services/analytics";
import { resolveOrgContext } from "@/server/authz";
import { bookkeepingAnswers, createAccountingOrg, createUser, resetDb, testProviders } from "./helpers";

let providers: ReturnType<typeof testProviders>;
beforeEach(async () => {
  await resetDb();
  providers = testProviders();
});

describe("admin builds a service from scratch (no code)", () => {
  it("service + questions + conditional logic + pricing rules drive the public quote", async () => {
    const owner = await createUser("owner@blank.test");
    await createOrganization(owner.id, { name: "Blank Co", slug: "blank-co" });
    const ctx = await resolveOrgContext(owner.id, "blank-co");

    const service = await createService(ctx, { slug: "cleaning", name: "Office Cleaning", basePriceCents: 10_000, billingPeriod: "MONTHLY" });
    const size = await createQuestion(ctx, service.id, { key: "sqft", label: "Office size (sq ft)", type: "NUMBER", config: { min: 100 } });
    const kitchen = await createQuestion(ctx, service.id, { key: "kitchen", label: "Do you have a kitchen?", type: "BOOLEAN" });
    const fridges = await createQuestion(ctx, service.id, {
      key: "fridges",
      label: "How many fridges?",
      type: "NUMBER",
      visibleWhen: { field: "kitchen", op: "eq", value: true },
    });
    expect(fridges.options).toEqual([]);
    await createPricingRule(ctx, service.id, { key: "big", name: "Large office", condition: { field: "sqft", op: "gt", value: 2000 }, action: { type: "ADD", amountCents: 5_000 } });
    await createPricingRule(ctx, service.id, { key: "fridge", name: "Per fridge", priority: 200, action: { type: "PER_UNIT", field: "fridges", amountCents: 1_000 } });
    await expect(
      createPricingRule(ctx, service.id, { key: "bad", name: "Bad", condition: { field: "sqft", op: "gt", value: "big" }, action: { type: "ADD", amountCents: 1 } }),
    ).rejects.toMatchObject({ name: "ZodError" });

    // Reorder: kitchen first
    await reorderQuestions(ctx, service.id, [kitchen.id, fridges.id, size.id]);
    const cfg = await getPublicConfig("blank-co");
    expect(cfg.services[0].questions.map((q) => q.key)).toEqual(["kitchen", "fridges", "sqft"]);

    // Admin preview (sandbox) and a real visitor quote agree
    const answers = { kitchen: true, fridges: 2, sqft: 2500 };
    const preview = await previewQuote(ctx, service.id, answers);
    expect(preview.outcome.kind === "PRICE" && preview.outcome.priceCents).toBe(17_000);

    const s = await startSession("blank-co", { serviceSlug: "cleaning", attribution: {} });
    await updateSession("blank-co", s.sessionId, s.token, { answers });
    expect((await completeSession("blank-co", s.sessionId, s.token)).priceCents).toBe(17_000);

    // Switch to human review: the next quote has no price
    await prisma.service.update({ where: { id: service.id }, data: { quoteMode: "HUMAN_REVIEW" } });
    const s2 = await startSession("blank-co", { serviceSlug: "cleaning", attribution: {} });
    await updateSession("blank-co", s2.sessionId, s2.token, { answers });
    expect((await completeSession("blank-co", s2.sessionId, s2.token)).kind).toBe("REVIEW");

    // Editing options on a select question replaces them
    const q = await updateQuestion(ctx, size.id, { type: "SINGLE_SELECT", options: [{ label: "Small", value: "s" }, { label: "Large", value: "l" }] });
    expect(q.options.map((o) => o.value).sort()).toEqual(["l", "s"]);

    // Services with quote history are deactivated, not deleted
    expect(await deleteService(ctx, service.id)).toEqual({ deleted: false, deactivated: true });
  });
});

describe("configuration export / import and recipes", () => {
  it("round-trips an organization's configuration into a new client", async () => {
    const src = await createAccountingOrg("source-firm");
    const exported = await exportQuoteConfig(src.org.id);
    expect(exported.services.map((s) => s.slug)).toEqual(["bookkeeping", "payroll", "vat", "tax-preparation", "audit", "financial-advisory"]);

    const owner = await createUser("o@target.test");
    const target = await createOrganization(owner.id, { name: "Target", slug: "target-firm" });
    const result = await applyQuoteConfig(target.id, exported, { mode: "replace", actorId: owner.id });
    expect(result.services).toHaveLength(6);

    const reExported = await exportQuoteConfig(target.id);
    expect(reExported).toEqual(exported);

    // Importing twice is idempotent (no duplicates)
    await applyQuoteConfig(target.id, exported, { mode: "merge", actorId: owner.id });
    expect(await prisma.leadRule.count({ where: { organizationId: target.id } })).toBe(exported.leadRules.length);
    expect(await prisma.automation.count({ where: { organizationId: target.id } })).toBe(exported.automations.length);
  });

  it("rejects invalid imports atomically", async () => {
    const { org } = await createAccountingOrg("acme");
    const before = await exportQuoteConfig(org.id);
    await expect(
      applyQuoteConfig(org.id, { services: [{ slug: "bookkeeping", name: "BK", pricingRules: [{ key: "r", name: "r", action: { type: "NOPE" } }] }] }, { mode: "replace" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await exportQuoteConfig(org.id)).toEqual(before);
  });

  it("clones the accounting recipe with client branding and client pricing", async () => {
    const owner = await createUser("owner@client.test");
    const org = await createOrganization(owner.id, {
      name: "Island Ledger",
      slug: "island-ledger",
      recipeKey: "accounting",
      templateKey: "premium",
      currency: "BSD",
      brand: { primaryColor: "#0f766e", headline: "Island Ledger quotes" },
      pricing: { scalePercent: 120, services: { audit: { active: false } } },
    });
    expect(org.templateKey).toBe("premium");
    expect(org.currency).toBe("BSD");
    expect((org.brand as { primaryColor: string; headline: string }).primaryColor).toBe("#0f766e");
    const bk = await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "bookkeeping" } });
    expect(bk.basePriceCents).toBe(30_000);
    const audit = await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "audit" } });
    expect(audit.active).toBe(false);
    const cfg = await getPublicConfig("island-ledger");
    expect(cfg.services.map((s) => s.slug)).not.toContain("audit");
    expect(await prisma.auditLog.count({ where: { organizationId: org.id, action: "recipe.apply:accounting" } })).toBe(1);
  });

  it("refuses planned recipes and duplicate slugs", async () => {
    const owner = await createUser();
    await expect(createOrganization(owner.id, { name: "Sun", slug: "sun-co", recipeKey: "solar" })).rejects.toMatchObject({ status: 400 });
    await createOrganization(owner.id, { name: "One", slug: "one-co" });
    await expect(createOrganization(owner.id, { name: "Two", slug: "one-co" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("AI configuration assistant", () => {
  it("proposes structured config that only takes effect after approval", async () => {
    const { ctx, org } = await createAccountingOrg("acme");
    const proposal = await createProposal(ctx, {
      prompt: "Monthly bookkeeping starts at $300 and goes up depending on transaction volume and payroll. Payroll adds $120.",
    });
    expect(proposal.status).toBe("PENDING");
    const svc = (proposal.proposal as { services: { slug: string; basePriceCents: number; pricingRules: { action: { amountCents?: number } }[] }[] }).services[0];
    expect(svc.slug).toBe("bookkeeping");
    expect(svc.basePriceCents).toBe(30_000);
    expect(svc.pricingRules.some((r) => r.action.amountCents === 12_000)).toBe(true);

    // Not active yet
    expect((await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "bookkeeping" } })).basePriceCents).toBe(25_000);

    const decided = await decideProposal(ctx, proposal.id, true);
    expect(decided.status).toBe("APPROVED");
    expect((await prisma.service.findFirstOrThrow({ where: { organizationId: org.id, slug: "bookkeeping" } })).basePriceCents).toBe(30_000);
    await expect(decideProposal(ctx, proposal.id, true)).rejects.toMatchObject({ status: 409 });
  });

  it("rejected proposals change nothing", async () => {
    const { ctx, org } = await createAccountingOrg("acme");
    const before = await exportQuoteConfig(org.id);
    const p = await createProposal(ctx, { prompt: "Payroll starts at $99 per month plus employees." });
    await decideProposal(ctx, p.id, false);
    expect(await exportQuoteConfig(org.id)).toEqual(before);
  });
});

describe("automations, webhooks and analytics", () => {
  async function makeLead(slug: string) {
    const s = await startSession(slug, { serviceSlug: "bookkeeping", visitorId: "vis-1", attribution: { source: "instagram", campaign: "bookkeeping-september" } });
    await updateSession(slug, s.sessionId, s.token, { answers: bookkeepingAnswers });
    await completeSession(slug, s.sessionId, s.token);
    return submitLead(slug, s.sessionId, s.token, { name: "Jane Builder", company: "ABC Construction", email: "jane@abc.test", phone: "+12425550100" });
  }

  it("runs a configured WhatsApp automation through the provider interface on status change", async () => {
    const { ctx } = await createAccountingOrg("acme");
    await upsertMessageTemplate(ctx, null, { key: "won_whatsapp", channel: "WHATSAPP", name: "Won", body: "Welcome aboard {{lead.firstName}}!" });
    await upsertAutomation(ctx, null, {
      name: "Welcome on win",
      trigger: "LEAD_STATUS_CHANGED",
      condition: { field: "$status", op: "eq", value: "WON" },
      actions: [{ type: "SEND_WHATSAPP", to: "lead", templateKey: "won_whatsapp" }],
    });
    const lead = await makeLead("acme");
    await updateLead(ctx, lead.leadId, { status: "CONTACTED" });
    expect(providers.whatsapp.outbox).toHaveLength(0);
    await updateLead(ctx, lead.leadId, { status: "WON" });
    expect(providers.whatsapp.outbox).toEqual([{ to: "+12425550100", body: "Welcome aboard Jane!" }]);
    expect(await prisma.event.count({ where: { leadId: lead.leadId, type: "WHATSAPP_SENT" } })).toBe(1);
  });

  it("records automation failures without breaking lead capture", async () => {
    const { ctx } = await createAccountingOrg("acme");
    await upsertAutomation(ctx, null, { name: "Broken", trigger: "LEAD_CREATED", actions: [{ type: "SEND_EMAIL", to: "lead", templateKey: "missing_template" }] });
    const lead = await makeLead("acme");
    expect(lead.leadId).toBeTruthy();
    const run = await prisma.automationRun.findFirstOrThrow({ where: { status: "FAILED" } });
    expect(run.error).toMatch(/missing_template/);
    expect(await prisma.event.count({ where: { type: "AUTOMATION_FAILED" } })).toBe(1);
  });

  it("verifies booking webhooks and records consultations idempotently", async () => {
    const { org, ctx } = await createAccountingOrg("acme");
    const lead = await makeLead("acme");
    const body = JSON.stringify({ event: "booking.created", provider: "calendly", externalId: "evt_1", startsAt: "2026-10-01T15:00:00Z", email: "jane@abc.test" });
    const ts = Math.floor(Date.now() / 1000);
    const headers = (sig: string, t = ts) => new Headers({ "x-quoteos-timestamp": String(t), "x-quoteos-signature": sig });

    await expect(handleBookingWebhook("acme", headers("sha256=deadbeef"), body)).rejects.toMatchObject({ status: 401 });
    await expect(handleBookingWebhook("acme", headers(signWebhook(org.webhookSecret, ts - 3600, body), ts - 3600), body)).rejects.toMatchObject({ status: 401 });
    await expect(handleBookingWebhook("acme", headers(signWebhook("other-secret", ts, body)), body)).rejects.toMatchObject({ status: 401 });

    const ok = await handleBookingWebhook("acme", headers(signWebhook(org.webhookSecret, ts, body)), body);
    expect(ok).toMatchObject({ ok: true, duplicate: false, matchedLead: true });
    const again = await handleBookingWebhook("acme", headers(signWebhook(org.webhookSecret, ts, body)), body);
    expect(again.duplicate).toBe(true);

    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.leadId } })).status).toBe("CONTACTED");
    const a = await getAnalytics(ctx, { days: 30 });
    expect(a.funnel).toMatchObject({ starts: 1, completions: 1, leads: 1, appointments: 1 });
  });

  it("analytics only reports value from real leads and splits recurring from one-time", async () => {
    const { ctx } = await createAccountingOrg("acme");
    await makeLead("acme");
    // A review lead contributes no value
    const s = await startSession("acme", { serviceSlug: "audit", attribution: {} });
    await updateSession("acme", s.sessionId, s.token, { answers: { auditType: "lender", annualRevenue: 1, entities: 1, timeline: "researching" } });
    await completeSession("acme", s.sessionId, s.token);
    await submitLead("acme", s.sessionId, s.token, { name: "R", email: "r@x.test" });

    const a = await getAnalytics(ctx, { days: 30 });
    expect(a.funnel.leads).toBe(2);
    expect(a.pipeline).toEqual([{ billingPeriod: "MONTHLY", currency: "USD", totalCents: 51_500, leads: 1 }]);
    expect(a.won).toEqual([]);
    expect(a.leadSources.find((x) => x.source === "instagram")?.leads).toBe(1);
    expect(a.rates.completionRate).toBe(1);
  });
});
