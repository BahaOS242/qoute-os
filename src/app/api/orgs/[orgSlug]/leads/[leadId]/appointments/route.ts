import { orgRoute, readJson } from "@/server/api";
import { manualAppointmentSchema, recordManualAppointment } from "@/server/services/leads";

export const POST = orgRoute<{ orgSlug: string; leadId: string }>("MEMBER", async (req, ctx, { leadId }) =>
  recordManualAppointment(ctx, leadId, await readJson(req, manualAppointmentSchema)),
);
