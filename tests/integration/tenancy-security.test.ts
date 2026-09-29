import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { auth } from "@/server/auth";
import { resolveOrgContext } from "@/server/authz";
import {
  createPricingRule,
  deleteQuestion,
  getServiceDetail,
  previewQuote,
  reorderQuestions,
  updatePricingRule,
  updateService,
  upsertAutomation,
  upsertLeadRule,
} from "@/server/services/config-admin";
import { addNote, getLeadDetail, listLeads, updateLead } from "@/server/services/leads";
import { getAnalytics } from "@/server/services/analytics";
import { exportQuoteConfig } from "@/server/services/config-io";
import { rotateWebhookSecret, updateOrganizationSettings } from "@/server/services/organizations";
import { completeSession, startSession, submitLead, updateSession } from "@/server/services/quote-flow";
import { addMember, bookkeepingAnswers, createAccountingOrg, resetDb, testProviders } from "./helpers";

import * as leadsRoute from "@/app/api/orgs/[orgSlug]/leads/route";
import * as leadRoute from "@/app/api/orgs/[orgSlug]/leads/[leadId]/route";
import * as ruleRoute from "@/app/api/orgs/[orgSlug]/pricing-rules/[ruleId]/route";
import * as orgSettingsRoute from "@/app/api/orgs/[orgSlug]/route";
import * as configRoute from "@/app/api/orgs/[orgSlug]/config/route";
import * as publicConfigRoute from "@/app/api/public/[orgSlug]/config/route";
import * as sessionsRoute from "@/app/api/public/[orgSlug]/sessions/route";
import * as sessionRoute from "@/app/api/public/[orgSlug]/sessions/[sessionId]/route";
import * as completeRoute from "@/app/api/public/[orgSlug]/sessions/[sessionId]/complete/route";
import * as leadSubmitRoute from "@/app/api/public/[orgSlug]/sessions/[sessionId]/lead/route";
import * as cronRoute from "@/app/api/cron/abandon/route";

beforeEach(async () => {
  await resetDb();
  testProviders();
});

async function makeLead(slug: string) {
  const s = await startSession(slug, { serviceSlug: "bookkeeping", attribution: { source: "instagram" } });
  await updateSession(slug, s.sessionId, s.token, { answers: bookkeepingAnswers });
  await completeSession(slug, s.sessionId, s.token);
  return submitLead(slug, s.sessionId, s.token, { name: `Lead ${slug}`, email: `lead@${slug}.test` });
}

describe("multi-tenancy: organization A can never reach organization B", () => {
  it("membership resolution hides other organizations (404, not 403)", async () => {
    const a = await createAccountingOrg("org-a");
    await createAccountingOrg("org-b");
    await expect(resolveOrgContext(a.owner.id, "org-b")).rejects.toMatchObject({ status: 404 });
    await expect(resolveOrgContext(a.owner.id, "does-not-exist")).rejects.toMatchObject({ status: 404 });
  });

  it("services reject B's ids when called with A's context", async () => {
    const a = await createAccountingOrg("org-a");
    const b = await createAccountingOrg("org-b");
    const bLead = await makeLead("org-b");
    const bService = await prisma.service.findFirstOrThrow({ where: { organizationId: b.org.id, slug: "bookkeeping" } });
    const bRule = await prisma.pricingRule.findFirstOrThrow({ where: { organizationId: b.org.id } });
    const bQuestion = await prisma.question.findFirstOrThrow({ where: { organizationId: b.org.id } });
    const bLeadRule = await prisma.leadRule.findFirstOrThrow({ where: { organizationId: b.org.id } });
    const bAutomation = await prisma.automation.findFirstOrThrow({ where: { organizationId: b.org.id } });

    const attempts: (() => Promise<unknown>)[] = [
      () => getServiceDetail(a.ctx, bService.id),
      () => updateService(a.ctx, bService.id, { basePriceCents: 1 }),
      () => previewQuote(a.ctx, bService.id, {}),
      () => createPricingRule(a.ctx, bService.id, { key: "evil", name: "Evil", action: { type: "SET", amountCents: 0 } }),
      () => updatePricingRule(a.ctx, bRule.id, { action: { type: "SET", amountCents: 0 } }),
      () => deleteQuestion(a.ctx, bQuestion.id),
      () => reorderQuestions(a.ctx, bService.id, [bQuestion.id]),
      () => upsertLeadRule(a.ctx, bLeadRule.id, { name: "x", action: { type: "ADD_SCORE", points: 1 } }),
      () => upsertAutomation(a.ctx, bAutomation.id, { name: "x", trigger: "LEAD_CREATED", actions: [{ type: "CREATE_CRM_RECORD" }] }),
      () => getLeadDetail(a.ctx, bLead.leadId),
      () => updateLead(a.ctx, bLead.leadId, { status: "WON" }),
      () => addNote(a.ctx, bLead.leadId, "hi"),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ status: 404 });

    // Nothing in B changed
    expect((await prisma.service.findUniqueOrThrow({ where: { id: bService.id } })).basePriceCents).toBe(25_000);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: bLead.leadId } })).status).toBe("NEW");
    expect(await prisma.question.count({ where: { id: bQuestion.id } })).toBe(1);
  });

  it("lists, analytics and exports only contain the caller's data", async () => {
    const a = await createAccountingOrg("org-a");
    await createAccountingOrg("org-b");
    await makeLead("org-a");
    await makeLead("org-b");
    await makeLead("org-b");
    const leads = await listLeads(a.ctx, { take: 50, skip: 0 });
    expect(leads.total).toBe(1);
    expect(leads.items.every((l) => l.organizationId === a.org.id)).toBe(true);
    const analytics = await getAnalytics(a.ctx, { days: 30 });
    expect(analytics.funnel.leads).toBe(1);
    expect(analytics.funnel.starts).toBe(1);
    const exported = await exportQuoteConfig(a.org.id);
    expect(exported.services).toHaveLength(6);
  });

  it("lead owners must belong to the organization", async () => {
    const a = await createAccountingOrg("org-a");
    const b = await createAccountingOrg("org-b");
    const lead = await makeLead("org-a");
    await expect(updateLead(a.ctx, lead.leadId, { ownerId: b.owner.id })).rejects.toMatchObject({ status: 400 });
  });
});

describe("role-based permissions", () => {
  it("members can work leads but cannot change pricing or settings; admins cannot rotate secrets", async () => {
    const a = await createAccountingOrg("org-a");
    const member = await addMember(a.org.id, "MEMBER");
    const admin = await addMember(a.org.id, "ADMIN");
    const memberCtx = await resolveOrgContext(member.id, "org-a");
    const adminCtx = await resolveOrgContext(admin.id, "org-a");
    const rule = await prisma.pricingRule.findFirstOrThrow({ where: { organizationId: a.org.id } });
    const lead = await makeLead("org-a");

    await expect(updatePricingRule(memberCtx, rule.id, { action: { type: "ADD", amountCents: 1 } })).rejects.toMatchObject({ status: 403 });
    await expect(updateOrganizationSettings(memberCtx, { templateKey: "modern" })).rejects.toMatchObject({ status: 403 });
    await expect(resolveOrgContext(member.id, "org-a", "ADMIN")).rejects.toMatchObject({ status: 403 });
    await expect(updateLead(memberCtx, lead.leadId, { status: "CONTACTED" })).resolves.toMatchObject({ status: "CONTACTED" });

    await expect(updatePricingRule(adminCtx, rule.id, { priority: 7 })).resolves.toMatchObject({ priority: 7 });
    await expect(rotateWebhookSecret(adminCtx)).rejects.toMatchObject({ status: 403 });

    const logs = await prisma.auditLog.findMany({ where: { organizationId: a.org.id, action: { in: ["pricing_rule.update", "lead.update"] } } });
    expect(logs.map((l) => l.actorId).sort()).toEqual([admin.id, member.id].sort());
  });
});

// ---------------------------------------------------------------------------
// HTTP-level tests: real route handlers + real Better Auth session cookies
// ---------------------------------------------------------------------------

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const call = (h: unknown, url: string, init: RequestInit & { params: Record<string, string> }) =>
  (h as Handler)(new Request(`http://localhost:3000${url}`, init), { params: Promise.resolve(init.params) });

async function signUp(email: string) {
  const res = await auth.api.signUpEmail({ body: { email, password: "correct-horse-battery", name: email }, asResponse: true });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, user };
}

describe("HTTP authorization", () => {
  it("unauthenticated requests to staff APIs get 401", async () => {
    await createAccountingOrg("org-a");
    const res = await call(leadsRoute.GET, "/api/orgs/org-a/leads", { params: { orgSlug: "org-a" } });
    expect(res.status).toBe(401);
    const res2 = await call(configRoute.GET, "/api/orgs/org-a/config", { params: { orgSlug: "org-a" } });
    expect(res2.status).toBe(401);
  });

  it("an authenticated user of org A gets 404 for org B's leads, pricing, quotes and settings", async () => {
    const a = await createAccountingOrg("org-a");
    const b = await createAccountingOrg("org-b");
    const { cookie, user } = await signUp("alice@org-a.test");
    await prisma.membership.create({ data: { organizationId: a.org.id, userId: user.id, role: "OWNER" } });
    const bLead = await makeLead("org-b");
    const bRule = await prisma.pricingRule.findFirstOrThrow({ where: { organizationId: b.org.id } });

    const own = await call(leadsRoute.GET, "/api/orgs/org-a/leads", { headers: { cookie }, params: { orgSlug: "org-a" } });
    expect(own.status).toBe(200);

    const cases: [unknown, string, RequestInit, Record<string, string>][] = [
      [leadsRoute.GET, "/api/orgs/org-b/leads", {}, { orgSlug: "org-b" }],
      [leadRoute.GET, `/api/orgs/org-b/leads/${bLead.leadId}`, {}, { orgSlug: "org-b", leadId: bLead.leadId }],
      // B's lead id through A's own organization path
      [leadRoute.GET, `/api/orgs/org-a/leads/${bLead.leadId}`, {}, { orgSlug: "org-a", leadId: bLead.leadId }],
      [ruleRoute.PATCH, `/api/orgs/org-a/pricing-rules/${bRule.id}`, { method: "PATCH", body: JSON.stringify({ priority: 1 }) }, { orgSlug: "org-a", ruleId: bRule.id }],
      [orgSettingsRoute.PATCH, "/api/orgs/org-b", { method: "PATCH", body: JSON.stringify({ templateKey: "modern" }) }, { orgSlug: "org-b" }],
      [configRoute.GET, "/api/orgs/org-b/config", {}, { orgSlug: "org-b" }],
    ];
    for (const [h, url, init, params] of cases) {
      const res = await call(h, url, { ...init, headers: { cookie, "content-type": "application/json" }, params });
      expect(res.status, url).toBe(404);
    }
    expect((await prisma.pricingRule.findUniqueOrThrow({ where: { id: bRule.id } })).priority).toBe(bRule.priority);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: b.org.id } })).templateKey).toBe("professional");
  });

  it("organization settings responses never include the webhook secret", async () => {
    const a = await createAccountingOrg("org-a");
    const { cookie, user } = await signUp("owner2@org-a.test");
    await prisma.membership.create({ data: { organizationId: a.org.id, userId: user.id, role: "OWNER" } });
    const res = await call(orgSettingsRoute.GET, "/api/orgs/org-a", { headers: { cookie }, params: { orgSlug: "org-a" } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(a.org.webhookSecret);
  });
});

describe("HTTP visitor flow cannot be manipulated", () => {
  it("client-supplied prices are ignored; the stored quote uses server pricing", async () => {
    await createAccountingOrg("org-a");
    const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
    const start = await json(
      await call(sessionsRoute.POST, "/api/public/org-a/sessions", {
        method: "POST",
        body: JSON.stringify({ serviceSlug: "bookkeeping", attribution: { source: "instagram", campaign: "bookkeeping-september" }, priceCents: 1 }),
        params: { orgSlug: "org-a" },
      }),
    );
    const params = { orgSlug: "org-a", sessionId: String(start.sessionId) };
    const headers = { "x-quote-session-token": String(start.token), "content-type": "application/json" };

    const bad = await call(sessionRoute.PATCH, "/x", { method: "PATCH", headers, body: JSON.stringify({ answers: { totalCents: 1 } }), params });
    expect(bad.status).toBe(400);

    const ok = await call(sessionRoute.PATCH, "/x", { method: "PATCH", headers, body: JSON.stringify({ answers: bookkeepingAnswers, estimatedPriceCents: 1 }), params });
    expect(ok.status).toBe(200);

    const quote = await json(await call(completeRoute.POST, "/x", { method: "POST", headers, body: JSON.stringify({ priceCents: 1, total: 1 }), params }));
    expect(quote.priceCents).toBe(51_500);

    const lead = await json(
      await call(leadSubmitRoute.POST, "/x", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "Jo", email: "jo@x.test", estimatedValueCents: 99_999_999, status: "WON", source: "google" }),
        params,
      }),
    );
    const stored = await prisma.lead.findUniqueOrThrow({ where: { id: String(lead.leadId) } });
    expect(stored.estimatedValueCents).toBe(51_500);
    expect(stored.status).toBe("NEW");
    expect(stored.source).toBe("instagram");
    expect(stored.campaign).toBe("bookkeeping-september");

    const wrongToken = await call(sessionRoute.GET, "/x", { headers: { "x-quote-session-token": "nope" }, params });
    expect(wrongToken.status).toBe(404);
  });

  it("rate limits lead submissions and reports malformed JSON cleanly", async () => {
    await createAccountingOrg("org-a");
    const malformed = await call(sessionsRoute.POST, "/x", { method: "POST", body: "{not json", params: { orgSlug: "org-a" } });
    expect(malformed.status).toBe(400);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await call(leadSubmitRoute.POST, "/x", {
        method: "POST",
        headers: { "x-forwarded-for": "10.0.0.9", "x-quote-session-token": "t" },
        body: JSON.stringify({ name: "x", email: "x@y.co" }),
        params: { orgSlug: "org-a", sessionId: "missing" },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it("unknown organizations 404 on public endpoints", async () => {
    const r = await call(publicConfigRoute.GET, "/x", { params: { orgSlug: "ghost" } });
    expect(r.status).toBe(404);
  });

  it("the abandonment cron requires the shared secret", async () => {
    const denied = await call(cronRoute.POST, "/api/cron/abandon", { method: "POST", params: {} });
    expect(denied.status).toBe(401);
    const allowed = await call(cronRoute.POST, "/api/cron/abandon", { method: "POST", headers: { authorization: "Bearer test-cron-secret" }, params: {} });
    expect(allowed.status).toBe(200);
  });
});
