/** Auth helpers for server components (pages/layouts). */
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { MemberRole } from "@prisma/client";
import { getSessionUser, resolveOrgContext, type OrgContext } from "./authz";
import { AppError } from "./errors";

export async function requirePageUser(next = "/dashboard") {
  const user = await getSessionUser(await headers());
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export async function requireOrgPage(orgSlug: string, minRole: MemberRole = "MEMBER"): Promise<OrgContext> {
  const user = await requirePageUser(`/dashboard/${orgSlug}`);
  try {
    return await resolveOrgContext(user.id, orgSlug, minRole);
  } catch (e) {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
}
