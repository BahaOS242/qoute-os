import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { decideProposal } from "@/server/services/ai-config";

const schema = z.object({ approve: z.boolean() });
export const POST = orgRoute<{ orgSlug: string; proposalId: string }>("ADMIN", async (req, ctx, { proposalId }) =>
  decideProposal(ctx, proposalId, (await readJson(req, schema)).approve),
);
