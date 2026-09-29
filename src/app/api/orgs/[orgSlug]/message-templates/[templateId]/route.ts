import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { deleteMessageTemplate, upsertMessageTemplate } from "@/server/services/config-admin";

type P = { orgSlug: string; templateId: string };
export const PATCH = orgRoute<P>("ADMIN", async (req, ctx, { templateId }) => upsertMessageTemplate(ctx, templateId, await readJson(req, z.unknown())));
export const DELETE = orgRoute<P>("ADMIN", async (_req, ctx, { templateId }) => deleteMessageTemplate(ctx, templateId));
