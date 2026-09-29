import { route } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { completeSession } from "@/server/services/quote-flow";

export const POST = route<{ orgSlug: string; sessionId: string }>(async (req, { orgSlug, sessionId }) => {
  await enforceRateLimit("sessionWrite", clientIp(req));
  return completeSession(orgSlug, sessionId, req.headers.get("x-quote-session-token"));
});
