import { orgRoute, readJson } from "@/server/api";
import { enforceRateLimit } from "@/server/rate-limit";
import { createProposal, listProposals, proposalRequestSchema } from "@/server/services/ai-config";

export const GET = orgRoute("ADMIN", async (_req, ctx) => listProposals(ctx));
export const POST = orgRoute("ADMIN", async (req, ctx) => {
  await enforceRateLimit("adminAi", ctx.userId);
  return createProposal(ctx, await readJson(req, proposalRequestSchema));
});
