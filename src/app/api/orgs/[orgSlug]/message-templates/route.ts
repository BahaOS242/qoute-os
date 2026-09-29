import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { listMessageTemplates, upsertMessageTemplate } from "@/server/services/config-admin";

export const GET = orgRoute("MEMBER", async (_req, ctx) => listMessageTemplates(ctx));
export const POST = orgRoute("ADMIN", async (req, ctx) => upsertMessageTemplate(ctx, null, await readJson(req, z.unknown())));
