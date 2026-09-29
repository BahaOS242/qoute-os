import { route, readJson } from "@/server/api";
import { requireUser } from "@/server/authz";
import { createOrganization, createOrganizationSchema, listUserOrganizations } from "@/server/services/organizations";

export const GET = route(async (req) => {
  const user = await requireUser(req.headers);
  return listUserOrganizations(user.id);
});

export const POST = route(async (req) => {
  const user = await requireUser(req.headers);
  const org = await createOrganization(user.id, await readJson(req, createOrganizationSchema));
  return { id: org.id, slug: org.slug, name: org.name };
});
