import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { createService, listServices } from "@/server/services/config-admin";

export const GET = orgRoute("MEMBER", async (_req, ctx) => listServices(ctx));
export const POST = orgRoute("ADMIN", async (req, ctx) => createService(ctx, await readJson(req, z.unknown())));
