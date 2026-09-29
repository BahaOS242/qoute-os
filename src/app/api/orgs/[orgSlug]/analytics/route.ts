import { orgRoute } from "@/server/api";
import { getAnalytics } from "@/server/services/analytics";

export const GET = orgRoute("MEMBER", async (req, ctx) => {
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return getAnalytics(ctx, { days: Number.isFinite(days) ? days : 30 });
});
