import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { reorderQuestions } from "@/server/services/config-admin";

const schema = z.object({ order: z.array(z.string().max(40)).max(200) });
export const POST = orgRoute<{ orgSlug: string; serviceId: string }>("ADMIN", async (req, ctx, { serviceId }) =>
  reorderQuestions(ctx, serviceId, (await readJson(req, schema)).order),
);
