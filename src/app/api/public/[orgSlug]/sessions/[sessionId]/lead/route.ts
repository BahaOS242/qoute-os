import { route, readJson } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { leadInputSchema, submitLead } from "@/server/services/quote-flow";

export const POST = route<{ orgSlug: string; sessionId: string }>(async (req, { orgSlug, sessionId }) => {
  await enforceRateLimit("leadSubmit", clientIp(req));
  const body = await readJson(req, leadInputSchema);
  return submitLead(orgSlug, sessionId, req.headers.get("x-quote-session-token"), body);
});
