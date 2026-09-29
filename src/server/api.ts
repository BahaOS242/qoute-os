/** Thin helpers so route handlers stay declarative and errors are rendered consistently. */
import { NextResponse } from "next/server";
import type { MemberRole } from "@prisma/client";
import type { z } from "zod";
import { badRequest, toErrorBody } from "./errors";
import { requireOrg, type OrgContext } from "./authz";

type Params = Record<string, string>;
type RouteCtx<P extends Params> = { params: Promise<P> };

export function route<P extends Params = Params>(fn: (req: Request, params: P) => Promise<unknown>) {
  return async (req: Request, ctx: RouteCtx<P>) => {
    try {
      const result = await fn(req, await ctx.params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      const { status, body } = toErrorBody(e);
      return NextResponse.json(body, { status });
    }
  };
}

/** Route that requires an authenticated member of params.orgSlug with at least `minRole`. */
export function orgRoute<P extends Params & { orgSlug: string }>(
  minRole: MemberRole,
  fn: (req: Request, ctx: OrgContext, params: P) => Promise<unknown>,
) {
  return route<P>(async (req, params) => {
    const ctx = await requireOrg(req.headers, params.orgSlug, minRole);
    return fn(req, ctx, params);
  });
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 512_000) throw badRequest("Request body too large");
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof SyntaxError) throw badRequest("Invalid JSON body");
    throw e;
  }
  return schema.parse(body);
}
