/**
 * Organization-level authorization. Every staff-facing operation resolves an OrgContext from
 * the authenticated user's membership; services then scope every query by ctx.organizationId.
 *
 * Non-members get 404 (not 403) so organization existence is not leaked across tenants.
 */
import type { MemberRole, Organization } from "@prisma/client";
import { auth } from "./auth";
import { prisma } from "./db";
import { forbidden, notFound, unauthorized } from "./errors";

export interface OrgContext {
  organizationId: string;
  organization: Organization;
  userId: string;
  role: MemberRole;
}

const RANK: Record<MemberRole, number> = { MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function hasRole(role: MemberRole, min: MemberRole) {
  return RANK[role] >= RANK[min];
}

export async function getSessionUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}

export async function requireUser(headers: Headers) {
  const user = await getSessionUser(headers);
  if (!user) throw unauthorized();
  return user;
}

/** Resolve membership of `userId` in the organization `orgSlug`, enforcing a minimum role. */
export async function resolveOrgContext(userId: string, orgSlug: string, minRole: MemberRole = "MEMBER"): Promise<OrgContext> {
  const membership = await prisma.membership.findFirst({
    where: { userId, organization: { slug: orgSlug } },
    include: { organization: true },
  });
  if (!membership) throw notFound("Organization");
  if (!hasRole(membership.role, minRole)) throw forbidden();
  return {
    organizationId: membership.organizationId,
    organization: membership.organization,
    userId,
    role: membership.role,
  };
}

export async function requireOrg(headers: Headers, orgSlug: string, minRole: MemberRole = "MEMBER") {
  const user = await requireUser(headers);
  return resolveOrgContext(user.id, orgSlug, minRole);
}

export function assertRole(ctx: OrgContext, min: MemberRole) {
  if (!hasRole(ctx.role, min)) throw forbidden();
}
