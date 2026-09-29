import { orgRoute } from "@/server/api";
import { markQuoteAccepted } from "@/server/services/leads";

export const POST = orgRoute<{ orgSlug: string; leadId: string }>("MEMBER", async (_req, ctx, { leadId }) => markQuoteAccepted(ctx, leadId));
