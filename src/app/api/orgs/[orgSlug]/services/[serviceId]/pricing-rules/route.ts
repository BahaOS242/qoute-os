import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { createPricingRule } from "@/server/services/config-admin";

export const POST = orgRoute<{ orgSlug: string; serviceId: string }>("ADMIN", async (req, ctx, { serviceId }) =>
  createPricingRule(ctx, serviceId, await readJson(req, z.unknown())),
);
