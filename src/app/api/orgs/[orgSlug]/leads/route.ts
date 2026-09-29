import { orgRoute } from "@/server/api";
import { leadFiltersSchema, listLeads } from "@/server/services/leads";

export const GET = orgRoute("MEMBER", async (req, ctx) => {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  return listLeads(ctx, leadFiltersSchema.parse(params));
});
