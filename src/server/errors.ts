import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const unauthorized = () => new AppError(401, "unauthorized", "Authentication required");
export const forbidden = (msg = "You do not have permission to do this") => new AppError(403, "forbidden", msg);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);
export const tooManyRequests = () => new AppError(429, "rate_limited", "Too many requests, please slow down");

export function toErrorBody(e: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (e instanceof AppError) {
    return { status: e.status, body: { error: { code: e.code, message: e.message, details: e.details } } };
  }
  if (e instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: "validation_error",
          message: e.issues[0] ? `${e.issues[0].path.join(".") || "input"}: ${e.issues[0].message}` : "Invalid input",
          details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      },
    };
  }
  // Prisma unique constraint
  if (typeof e === "object" && e && (e as { code?: string }).code === "P2002") {
    return { status: 409, body: { error: { code: "conflict", message: "A record with this key already exists" } } };
  }
  console.error("[quoteos] unhandled error", e);
  return { status: 500, body: { error: { code: "internal", message: "Something went wrong" } } };
}
