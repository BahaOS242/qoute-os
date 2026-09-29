import { z } from "zod";
import { orgRoute, readJson } from "@/server/api";
import { deleteQuestion, updateQuestion } from "@/server/services/config-admin";

type P = { orgSlug: string; questionId: string };
export const PATCH = orgRoute<P>("ADMIN", async (req, ctx, { questionId }) => updateQuestion(ctx, questionId, await readJson(req, z.unknown())));
export const DELETE = orgRoute<P>("ADMIN", async (_req, ctx, { questionId }) => deleteQuestion(ctx, questionId));
