import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { deletePricingRule, updatePricingRule } from "@/server/services/config-admin";

type P = { orgSlug: string; ruleId: string };
export const PATCH = orgRoute<P>("ADMIN", async (req, ctx, { ruleId }) => updatePricingRule(ctx, ruleId, await readJson(req, z.unknown())));
export const DELETE = orgRoute<P>("ADMIN", async (_req, ctx, { ruleId }) => deletePricingRule(ctx, ruleId));
