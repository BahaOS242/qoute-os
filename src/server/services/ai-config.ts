/**
 * AI configuration assistant. The AI only *proposes*; proposals are validated against the
 * canonical config schema and stored as PENDING. Nothing affects pricing until an admin approves.
 */
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { validateQuoteConfig } from "@/core/config/schema";
import { prisma } from "../db";
import { AppError, conflict, notFound } from "../errors";
import { audit } from "../audit";
import { assertRole, type OrgContext } from "../authz";
import { getProviders } from "../providers";
import { applyQuoteConfig } from "./config-io";

export const proposalRequestSchema = z.object({
  prompt: z.string().trim().min(10).max(4000),
  serviceId: z.string().max(40).nullable().optional(),
});

export async function createProposal(ctx: OrgContext, input: z.infer<typeof proposalRequestSchema>) {
  assertRole(ctx, "ADMIN");
  const existing = input.serviceId
    ? await prisma.service.findFirst({
        where: { id: input.serviceId, organizationId: ctx.organizationId },
        include: { questions: { select: { key: true, label: true, type: true } } },
      })
    : null;
  if (input.serviceId && !existing) throw notFound("Service");

  const ai = getProviders().ai;
  const result = await ai.proposeConfig({
    prompt: input.prompt,
    currency: ctx.organization.currency,
    existingService: existing ? { slug: existing.slug, name: existing.name, questions: existing.questions } : null,
  });
  // Force the proposal onto the selected service when editing one; a "new service" proposal must
  // never silently target an existing service, so colliding slugs get a unique suffix.
  if (existing) {
    result.config.services = result.config.services.slice(0, 1).map((s) => ({ ...s, slug: existing.slug, name: existing.name }));
  } else {
    const taken = new Set((await prisma.service.findMany({ where: { organizationId: ctx.organizationId }, select: { slug: true } })).map((s) => s.slug));
    result.config.services = result.config.services.map((s) => {
      let slug = s.slug;
      for (let n = 2; taken.has(slug); n++) slug = `${s.slug.slice(0, 55)}-${n}`;
      taken.add(slug);
      return { ...s, slug };
    });
  }
  // Proposals only carry services; they never change branding, automations or lead rules.
  const doc = { services: result.config.services };
  const validation = validateQuoteConfig(doc);
  if (!validation.ok || !validation.config) {
    throw new AppError(422, "invalid_proposal", "The assistant produced a configuration that failed validation. Try rephrasing.", { errors: validation.errors });
  }
  const proposal = await prisma.configProposal.create({
    data: {
      organizationId: ctx.organizationId,
      serviceId: existing?.id ?? null,
      prompt: input.prompt,
      proposal: validation.config as unknown as Prisma.InputJsonValue,
      explanation: [result.explanation, ...validation.warnings.map((w) => `Warning: ${w}`)].join("\n"),
      provider: ai.name,
      createdById: ctx.userId,
    },
  });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "ai_proposal.create", entityType: "ConfigProposal", entityId: proposal.id });
  return proposal;
}

export async function listProposals(ctx: OrgContext) {
  const proposals = await prisma.configProposal.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take: 20 });
  const slugs = new Set((await prisma.service.findMany({ where: { organizationId: ctx.organizationId }, select: { slug: true } })).map((s) => s.slug));
  return proposals.map((p) => ({
    ...p,
    /** Slugs of services this proposal would update (vs create). */
    updatesExisting: ((p.proposal as { services?: { slug: string }[] }).services ?? []).filter((s) => slugs.has(s.slug)).map((s) => s.slug),
  }));
}

export async function decideProposal(ctx: OrgContext, id: string, approve: boolean) {
  assertRole(ctx, "ADMIN");
  const p = await prisma.configProposal.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!p) throw notFound("Proposal");
  if (p.status !== "PENDING") throw conflict("This proposal has already been decided");
  // Claim the proposal first so concurrent approvals cannot apply it twice.
  const claimed = await prisma.configProposal.updateMany({
    where: { id, status: "PENDING" },
    data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.userId, decidedAt: new Date() },
  });
  if (!claimed.count) throw conflict("This proposal has already been decided");
  let applied = null;
  if (approve) {
    try {
      applied = await applyQuoteConfig(ctx.organizationId, p.proposal, { mode: "merge", actorId: ctx.userId, auditAction: "ai_proposal.approve" });
    } catch (e) {
      await prisma.configProposal.update({ where: { id }, data: { status: "PENDING", decidedById: null, decidedAt: null } });
      throw e;
    }
  } else {
    await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "ai_proposal.reject", entityType: "ConfigProposal", entityId: id });
  }
  return { status: approve ? "APPROVED" : "REJECTED", applied };
}
