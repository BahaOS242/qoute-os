import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { deleteService, getServiceDetail, updateService } from "@/server/services/config-admin";

type P = { orgSlug: string; serviceId: string };
export const GET = orgRoute<P>("MEMBER", async (_req, ctx, { serviceId }) => getServiceDetail(ctx, serviceId));
export const PATCH = orgRoute<P>("ADMIN", async (req, ctx, { serviceId }) => updateService(ctx, serviceId, await readJson(req, z.unknown())));
export const DELETE = orgRoute<P>("ADMIN", async (_req, ctx, { serviceId }) => deleteService(ctx, serviceId));
