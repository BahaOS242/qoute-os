import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { listAutomations, upsertAutomation } from "@/server/services/config-admin";

export const GET = orgRoute("MEMBER", async (_req, ctx) => listAutomations(ctx));
export const POST = orgRoute("ADMIN", async (req, ctx) => upsertAutomation(ctx, null, await readJson(req, z.unknown())));
