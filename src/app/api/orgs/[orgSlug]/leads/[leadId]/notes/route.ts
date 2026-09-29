import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { addNote } from "@/server/services/leads";

const schema = z.object({ body: z.string().max(5000) });
export const POST = orgRoute<{ orgSlug: string; leadId: string }>("MEMBER", async (req, ctx, { leadId }) =>
  addNote(ctx, leadId, (await readJson(req, schema)).body),
);
