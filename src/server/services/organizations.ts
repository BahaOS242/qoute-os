/** Organization lifecycle: clone from a recipe, settings, membership. */
import type { MemberRole, Prisma } from "@prisma/client";
import { z } from "zod";
import { quoteConfigSchema } from "@/core/config/schema";
import { customizePricing, type PricingCustomization } from "@/core/config/transform";
import { getRecipe } from "@/recipes";
import { isTemplateKey } from "@/templates/registry";
import { prisma } from "../db";
import { badRequest, conflict, notFound } from "../errors";
import { randomToken } from "../crypto";
import { audit } from "../audit";
import { assertRole, type OrgContext } from "../authz";
import { applyQuoteConfig } from "./config-io";

const RESERVED_SLUGS = new Set(["api", "dashboard", "login", "signup", "q", "admin", "new", "settings", "_next"]);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
  .refine((s) => !RESERVED_SLUGS.has(s), "This name is reserved");

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slugSchema,
  recipeKey: z.string().max(40).nullable().optional(),
  templateKey: z.string().max(40).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  timezone: z.string().max(60).optional(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  logoUrl: z.string().url().max(500).optional().nullable(),
  brand: z
    .object({ primaryColor: hex.optional(), accentColor: hex.optional(), headline: z.string().max(160).optional(), subheadline: z.string().max(400).optional() })
    .optional(),
  pricing: z
    .object({
      scalePercent: z.number().min(10).max(1000).optional(),
      services: z
        .record(
          z.string(),
          z.object({ basePriceCents: z.number().int().min(0).optional(), minimumPriceCents: z.number().int().min(0).nullable().optional(), active: z.boolean().optional() }),
        )
        .optional(),
    })
    .optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/**
 * Create a new client organization: Recipe + client branding + client pricing = new client.
 * The creator becomes OWNER.
 */
export async function createOrganization(ownerUserId: string, input: CreateOrganizationInput) {
  if (await prisma.organization.findUnique({ where: { slug: input.slug } })) throw conflict("That URL is already taken");
  const recipe = input.recipeKey ? getRecipe(input.recipeKey) : null;
  if (input.recipeKey && (!recipe || recipe.status !== "available" || !recipe.config)) throw badRequest("Recipe is not available");
  if (input.templateKey && !isTemplateKey(input.templateKey)) throw badRequest("Unknown template");

  const org = await prisma.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      logoUrl: input.logoUrl ?? null,
      currency: input.currency ?? "USD",
      timezone: input.timezone ?? "UTC",
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      recipeKey: recipe?.key ?? null,
      webhookSecret: randomToken(24),
      memberships: { create: { userId: ownerUserId, role: "OWNER" } },
    },
  });

  if (recipe?.config) {
    const base = quoteConfigSchema.parse(recipe.config);
    const config = customizePricing(base, input.pricing as PricingCustomization | undefined);
    config.organization = {
      ...config.organization,
      brand: { ...config.organization?.brand, ...input.brand },
      ...(input.templateKey ? { templateKey: input.templateKey } : {}),
    };
    await applyQuoteConfig(org.id, config, { mode: "replace", actorId: ownerUserId, auditAction: `recipe.apply:${recipe.key}` });
  } else {
    await prisma.organization.update({
      where: { id: org.id },
      data: { brand: (input.brand ?? {}) as Prisma.InputJsonValue, templateKey: input.templateKey ?? "professional" },
    });
  }
  await audit({ organizationId: org.id, actorId: ownerUserId, action: "organization.create", entityType: "Organization", entityId: org.id, after: { name: org.name, slug: org.slug, recipe: recipe?.key ?? null } });
  return prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
}

export async function listUserOrganizations(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { organization: { select: { id: true, name: true, slug: true, templateKey: true, recipeKey: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({ ...m.organization, role: m.role }));
}

export const updateSettingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  logoUrl: z.string().url().max(500).nullable().optional(),
  templateKey: z.string().max(40).optional(),
  timezone: z.string().max(60).optional(),
  currency: z.string().length(3).toUpperCase().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  website: z.string().url().max(300).nullable().optional(),
  notificationEmail: z.string().email().nullable().optional(),
  bookingUrl: z.string().url().max(500).nullable().optional(),
  highValueThresholdCents: z.number().int().min(0).nullable().optional(),
  quoteValidityDays: z.number().int().min(1).max(365).optional(),
  brand: z
    .object({
      primaryColor: hex.optional(),
      accentColor: hex.optional(),
      headline: z.string().max(160).optional(),
      subheadline: z.string().max(400).optional(),
      trustPoints: z.array(z.string().max(120)).max(6).optional(),
    })
    .optional(),
  glossary: z.array(z.object({ term: z.string().min(1).max(80), definition: z.string().min(1).max(600) })).max(100).optional(),
});

/** Update branding/settings. Switching template never touches quote logic. */
export async function updateOrganizationSettings(ctx: OrgContext, input: z.infer<typeof updateSettingsSchema>) {
  assertRole(ctx, "ADMIN");
  if (input.templateKey && !isTemplateKey(input.templateKey)) throw badRequest("Unknown template");
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const { brand, glossary, ...rest } = input;
  const updated = await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: {
      ...rest,
      ...(brand ? { brand: { ...(before.brand as object), ...brand } as Prisma.InputJsonValue } : {}),
      ...(glossary ? { glossary: glossary as Prisma.InputJsonValue } : {}),
    },
  });
  const { webhookSecret: _a, ...safeBefore } = before;
  const { webhookSecret: _b, ...safeAfter } = updated;
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "organization.update", entityType: "Organization", entityId: ctx.organizationId, before: safeBefore, after: safeAfter });
  return safeAfter;
}

export async function rotateWebhookSecret(ctx: OrgContext) {
  assertRole(ctx, "OWNER");
  const secret = randomToken(24);
  await prisma.organization.update({ where: { id: ctx.organizationId }, data: { webhookSecret: secret } });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "organization.webhook_secret_rotated", entityType: "Organization", entityId: ctx.organizationId });
  return { webhookSecret: secret };
}

export async function listMembers(ctx: OrgContext) {
  const members = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((m) => ({ id: m.id, role: m.role, userId: m.userId, name: m.user.name, email: m.user.email }));
}

export const addMemberSchema = z.object({ email: z.string().email().toLowerCase(), role: z.enum(["ADMIN", "MEMBER"]) });

/** Add an existing QuoteOS user to the organization. (Invitations are a later milestone.) */
export async function addMember(ctx: OrgContext, input: z.infer<typeof addMemberSchema>) {
  assertRole(ctx, "OWNER");
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) throw notFound("User (they need to sign up first)");
  const m = await prisma.membership.upsert({
    where: { organizationId_userId: { organizationId: ctx.organizationId, userId: user.id } },
    create: { organizationId: ctx.organizationId, userId: user.id, role: input.role as MemberRole },
    update: { role: input.role as MemberRole },
  });
  await audit({ organizationId: ctx.organizationId, actorId: ctx.userId, action: "member.upsert", entityType: "Membership", entityId: m.id, after: { email: input.email, role: input.role } });
  return m;
}
