import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { completeTask } from "@/server/services/leads";

const schema = z.object({ completed: z.boolean() });
export const PATCH = orgRoute<{ orgSlug: string; taskId: string }>("MEMBER", async (req, ctx, { taskId }) =>
  completeTask(ctx, taskId, (await readJson(req, schema)).completed),
);
