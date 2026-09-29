import { route, readJson } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { z } from "zod";
import { attributionSchema, recordView } from "@/server/services/quote-flow";

const schema = z.object({
  type: z.literal("QUOTE_VIEWED"),
  visitorId: z.string().max(100).optional().nullable(),
  serviceSlug: z.string().max(60).optional().nullable(),
  attribution: attributionSchema.prefault({}),
});

export const POST = route<{ orgSlug: string }>(async (req, { orgSlug }) => {
  await enforceRateLimit("publicRead", clientIp(req));
  const body = await readJson(req, schema);
  return recordView(orgSlug, body);
});
