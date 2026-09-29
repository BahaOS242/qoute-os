/**
 * Inbound webhooks (booking providers etc.).
 *
 * Security: requests must carry
 *   x-quoteos-timestamp: unix seconds (rejected if more than 5 minutes off)
 *   x-quoteos-signature: sha256=HMAC_SHA256(org.webhookSecret, `${timestamp}.${rawBody}`)
 * Signatures are compared in constant time, and processing is idempotent per externalId.
 */
import { z } from "zod";
import { prisma } from "../db";
import { AppError, badRequest, notFound } from "../errors";
import { hmacSha256, safeEqual } from "../crypto";
import { bookAppointment } from "./leads";

const MAX_SKEW_SECONDS = 300;

export function signWebhook(secret: string, timestamp: number, body: string) {
  return `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

export function verifyWebhookSignature(secret: string, headers: Headers, rawBody: string, now = Date.now()) {
  const ts = Number(headers.get("x-quoteos-timestamp"));
  const sig = headers.get("x-quoteos-signature") ?? "";
  if (!Number.isFinite(ts) || !sig) throw new AppError(401, "invalid_signature", "Missing webhook signature");
  if (Math.abs(now / 1000 - ts) > MAX_SKEW_SECONDS) throw new AppError(401, "invalid_signature", "Webhook timestamp outside tolerance");
  if (!safeEqual(sig, signWebhook(secret, ts, rawBody))) throw new AppError(401, "invalid_signature", "Invalid webhook signature");
}

export const bookingWebhookSchema = z.object({
  event: z.literal("booking.created"),
  provider: z.string().min(1).max(40).default("calendar"),
  externalId: z.string().min(1).max(200),
  startsAt: z.coerce.date(),
  leadId: z.string().max(40).optional().nullable(),
  email: z.string().email().optional().nullable(),
});

export async function handleBookingWebhook(orgSlug: string, headers: Headers, rawBody: string) {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw notFound("Organization");
  verifyWebhookSignature(org.webhookSecret, headers, rawBody);

  let payload: z.infer<typeof bookingWebhookSchema>;
  try {
    payload = bookingWebhookSchema.parse(JSON.parse(rawBody));
  } catch {
    throw badRequest("Invalid webhook payload");
  }
  // Resolve the lead strictly within this organization.
  const lead = payload.leadId
    ? await prisma.lead.findFirst({ where: { id: payload.leadId, organizationId: org.id } })
    : payload.email
      ? await prisma.lead.findFirst({ where: { email: payload.email.toLowerCase(), organizationId: org.id }, orderBy: { createdAt: "desc" } })
      : null;
  const r = await bookAppointment(org.id, { leadId: lead?.id ?? null, startsAt: payload.startsAt, provider: payload.provider, externalId: payload.externalId });
  return { ok: true, appointmentId: r.appointment.id, duplicate: r.duplicate, matchedLead: !!lead };
}
