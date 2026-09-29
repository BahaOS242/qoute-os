import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function hmacSha256(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Constant-time comparison of two hex/utf8 strings. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Hash an IP with the app secret so we can rate-limit/dedupe without storing raw IPs. */
export const hashIp = (ip: string | null) => (ip ? sha256(`${process.env.BETTER_AUTH_SECRET ?? ""}:${ip}`).slice(0, 32) : null);
