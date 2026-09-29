import { route, readJson } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { askAssistant, assistantSchema } from "@/server/services/quote-flow";

export const POST = route<{ orgSlug: string }>(async (req, { orgSlug }) => {
  await enforceRateLimit("assistant", clientIp(req));
  return askAssistant(orgSlug, await readJson(req, assistantSchema));
});
