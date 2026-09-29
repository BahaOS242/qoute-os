import { orgRoute, readJson } from "@/server/api";
import { updateOrganizationSettings, updateSettingsSchema } from "@/server/services/organizations";

export const GET = orgRoute("MEMBER", async (_req, ctx) => {
  const { webhookSecret: _s, ...org } = ctx.organization;
  return { organization: org, role: ctx.role };
});

export const PATCH = orgRoute("ADMIN", async (req, ctx) => updateOrganizationSettings(ctx, await readJson(req, updateSettingsSchema)));
