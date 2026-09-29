import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";

/** Append-only audit trail for configuration and lead changes made by staff. */
export async function audit(
  entry: {
    organizationId: string;
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: unknown;
    after?: unknown;
  },
  db: Tx = prisma,
) {
  await db.auditLog.create({
    data: {
      organizationId: entry.organizationId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
