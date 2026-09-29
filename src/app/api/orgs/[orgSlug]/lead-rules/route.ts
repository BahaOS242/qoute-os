import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { listLeadRules, upsertLeadRule } from "@/server/services/config-admin";

export const GET = orgRoute("MEMBER", async (_req, ctx) => listLeadRules(ctx));
export const POST = orgRoute("ADMIN", async (req, ctx) => upsertLeadRule(ctx, null, await readJson(req, z.unknown())));
