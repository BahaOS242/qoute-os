import { z } from "zod";
import { NextResponse } from "next/server";
import { orgRoute, readJson } from "@/server/api";
import { validateQuoteConfig } from "@/core/config/schema";
import { applyQuoteConfig, exportQuoteConfig } from "@/server/services/config-io";

/** Export the organization's quote configuration as portable JSON. */
export const GET = orgRoute("ADMIN", async (_req, ctx) => {
  const config = await exportQuoteConfig(ctx.organizationId);
  return NextResponse.json(config, {
    headers: { "Content-Disposition": `attachment; filename="${ctx.organization.slug}-quote-config.json"` },
  });
});

const schema = z.object({ mode: z.enum(["merge", "replace"]).default("merge"), dryRun: z.boolean().default(false), config: z.unknown() });

/** Import (or dry-run validate) a configuration document. */
export const POST = orgRoute("ADMIN", async (req, ctx) => {
  const body = await readJson(req, schema);
  if (body.dryRun) {
    const v = validateQuoteConfig(body.config);
    return { ok: v.ok, errors: v.errors, warnings: v.warnings, services: v.config?.services.map((s) => s.slug) ?? [] };
  }
  const result = await applyQuoteConfig(ctx.organizationId, body.config, { mode: body.mode, actorId: ctx.userId });
  return { ok: true, ...result };
});
