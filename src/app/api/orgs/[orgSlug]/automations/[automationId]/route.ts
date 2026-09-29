import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { deleteAutomation, upsertAutomation } from "@/server/services/config-admin";

type P = { orgSlug: string; automationId: string };
export const PATCH = orgRoute<P>("ADMIN", async (req, ctx, { automationId }) => upsertAutomation(ctx, automationId, await readJson(req, z.unknown())));
export const DELETE = orgRoute<P>("ADMIN", async (_req, ctx, { automationId }) => deleteAutomation(ctx, automationId));
