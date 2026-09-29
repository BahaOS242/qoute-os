import { route, readJson } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { authorizeSession, toPublicSession, updateSession, updateSessionSchema } from "@/server/services/quote-flow";

type P = { orgSlug: string; sessionId: string };
const token = (req: Request) => req.headers.get("x-quote-session-token");

export const GET = route<P>(async (req, { orgSlug, sessionId }) => {
  await enforceRateLimit("publicRead", clientIp(req));
  return toPublicSession(await authorizeSession(orgSlug, sessionId, token(req)));
});

export const PATCH = route<P>(async (req, { orgSlug, sessionId }) => {
  await enforceRateLimit("sessionWrite", clientIp(req));
  const body = await readJson(req, updateSessionSchema);
  return updateSession(orgSlug, sessionId, token(req), body);
});
