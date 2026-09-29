import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { previewQuote } from "@/server/services/config-admin";

const schema = z.object({ answers: z.record(z.string(), z.unknown()).default({}) });
export const POST = orgRoute<{ orgSlug: string; serviceId: string }>("MEMBER", async (req, ctx, { serviceId }) =>
  previewQuote(ctx, serviceId, (await readJson(req, schema)).answers),
);
