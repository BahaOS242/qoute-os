import { randomUUID } from "node:crypto";
import type { MemberRole } from "@prisma/client";
import { prisma } from "@/server/db";
import { ConsoleEmailProvider, LogChatProvider, setProvidersForTesting } from "@/server/providers";
import { resolveOrgContext } from "@/server/authz";
import { createOrganization } from "@/server/services/organizations";
import { MemoryRateLimiter, setRateLimiter } from "@/server/rate-limit";

const TABLES = [
  "ConfigProposal", "OutboundMessage", "AutomationRun", "Automation", "MessageTemplate", "AuditLog", "Event",
  "Appointment", "Task", "LeadNote", "Lead", "Quote", "QuoteSession", "LeadRule", "PricingRule", "QuestionOption",
  "Question", "Service", "Membership", "Organization", "session", "account", "verification", "user",
];

export async function resetDb() {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) throw new Error("resetDb only runs against a *_test database");
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

/** Fresh capturing providers + rate limiter for each test. */
export function testProviders() {
  const email = new ConsoleEmailProvider();
  const whatsapp = new LogChatProvider("whatsapp:test");
  const sms = new LogChatProvider("sms:test");
  setProvidersForTesting({ email, whatsapp, sms });
  setRateLimiter(new MemoryRateLimiter());
  return { email, whatsapp, sms };
}

export async function createUser(email = `user-${randomUUID()}@test.local`, name = "Test User") {
  return prisma.user.create({ data: { id: randomUUID(), email, name, emailVerified: true } });
}

/** Create an organization cloned from the accounting recipe, owned by a new user. */
export async function createAccountingOrg(slug: string, opts: { ownerEmail?: string; pricing?: Parameters<typeof createOrganization>[1]["pricing"] } = {}) {
  const owner = await createUser(opts.ownerEmail ?? `owner@${slug}.test`, `${slug} owner`);
  const org = await createOrganization(owner.id, { name: `${slug} Accounting`, slug, recipeKey: "accounting", pricing: opts.pricing });
  await prisma.organization.update({ where: { id: org.id }, data: { notificationEmail: `staff@${slug}.test` } });
  const ctx = await resolveOrgContext(owner.id, slug, "OWNER");
  return { org, owner, ctx };
}

export async function addMember(orgId: string, role: MemberRole, email?: string) {
  const user = await createUser(email);
  await prisma.membership.create({ data: { organizationId: orgId, userId: user.id, role } });
  return user;
}

export const bookkeepingAnswers = {
  monthlyTransactions: 340,
  bankAccounts: 3,
  payroll: true,
  employees: 8,
  accountingSoftware: "quickbooks",
  reportingFrequency: "quarterly",
  industry: "construction",
  timeline: "within_30_days",
};
