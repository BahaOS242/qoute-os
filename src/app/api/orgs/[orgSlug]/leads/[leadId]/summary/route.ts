import { orgRoute } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { regenerateSummary } from "@/server/services/leads";

export const POST = orgRoute<{ orgSlug: string; leadId: string }>("MEMBER", async (_req, ctx, { leadId }) => {
  await enforceRateLimit("adminAi", ctx.userId);
  return regenerateSummary(ctx, leadId);
});
