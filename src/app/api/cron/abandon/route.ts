import { route } from "@/server/api";
import { AppError } from "@/server/errors";
import { safeEqual } from "@/server/crypto";
import { markAbandonedSessions } from "@/server/services/quote-flow";

/** Scheduled job: POST with `Authorization: Bearer $CRON_SECRET` (e.g. every 10 minutes). */
export const POST = route(async (req) => {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(given, secret)) throw new AppError(401, "unauthorized", "Invalid cron secret");
  const idle = Number(new URL(req.url).searchParams.get("idleMinutes") ?? 30);
  return markAbandonedSessions({ idleMinutes: Number.isFinite(idle) && idle >= 5 ? idle : 30 });
});
