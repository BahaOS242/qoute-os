import { route, readJson } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { getPublicConfig } from "@/server/services/quote-flow";

export const GET = route<{ orgSlug: string }>(async (req, { orgSlug }) => {
  await enforceRateLimit("publicRead", clientIp(req));
  return getPublicConfig(orgSlug);
});
