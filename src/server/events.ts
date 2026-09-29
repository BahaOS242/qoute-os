import type { EventType, Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { getProviders } from "./providers";

export interface EventInput {
  organizationId: string;
  type: EventType;
  visitorId?: string | null;
  quoteSessionId?: string | null;
  quoteId?: string | null;
  leadId?: string | null;
  userId?: string | null;
  serviceId?: string | null;
  payload?: Record<string, unknown>;
}

/** Append an event to the funnel/timeline store and forward it to the analytics provider. */
export async function recordEvent(e: EventInput, db: Tx = prisma) {
  const event = await db.event.create({
    data: { ...e, payload: (e.payload ?? {}) as Prisma.InputJsonValue },
  });
  // Forwarding is best-effort and must never break the request.
  getProviders()
    .analytics.track({ type: e.type, organizationId: e.organizationId, properties: e.payload ?? {}, at: event.createdAt })
    .catch(() => undefined);
  return event;
}
