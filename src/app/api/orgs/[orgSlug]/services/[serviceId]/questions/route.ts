import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { createQuestion } from "@/server/services/config-admin";

export const POST = orgRoute<{ orgSlug: string; serviceId: string }>("ADMIN", async (req, ctx, { serviceId }) =>
  createQuestion(ctx, serviceId, await readJson(req, z.unknown())),
);
