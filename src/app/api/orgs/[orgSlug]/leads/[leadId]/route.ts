import { orgRoute, readJson } from "@/server/api";
import { getLeadDetail, updateLead, updateLeadSchema } from "@/server/services/leads";

type P = { orgSlug: string; leadId: string };
export const GET = orgRoute<P>("MEMBER", async (_req, ctx, { leadId }) => getLeadDetail(ctx, leadId));
export const PATCH = orgRoute<P>("MEMBER", async (req, ctx, { leadId }) => updateLead(ctx, leadId, await readJson(req, updateLeadSchema)));
