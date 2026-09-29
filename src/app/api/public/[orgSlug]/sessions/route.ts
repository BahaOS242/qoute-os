import { route, readJson } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { hashIp } from "@/server/crypto";
import { startSession, startSessionSchema } from "@/server/services/quote-flow";

export const POST = route<{ orgSlug: string }>(async (req, { orgSlug }) => {
  const ip = clientIp(req);
  await enforceRateLimit("sessionStart", ip);
  const body = await readJson(req, startSessionSchema);
  return startSession(orgSlug, body, { ipHash: hashIp(ip), userAgent: req.headers.get("user-agent") });
});
