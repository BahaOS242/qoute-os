import { route } from "@/server/api";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";
import { handleBookingWebhook } from "@/server/services/webhooks";

/** Booking-provider webhook. HMAC-signed with the organization's webhook secret. */
export const POST = route<{ orgSlug: string }>(async (req, { orgSlug }) => {
  await enforceRateLimit("webhook", `${orgSlug}:${clientIp(req)}`);
  const raw = await req.text();
  if (raw.length > 64_000) return new Response("Payload too large", { status: 413 });
  return handleBookingWebhook(orgSlug, req.headers, raw);
});
