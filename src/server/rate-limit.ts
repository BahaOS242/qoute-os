/**
 * Fixed-window rate limiter behind an interface so a shared store (Redis/Upstash) can replace
 * the in-memory default in multi-instance deployments.
 */
import { tooManyRequests } from "./errors";

export interface RateLimiter {
  hit(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number }>;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
      if (this.buckets.size > 50_000) this.sweep(now);
    }
    b.count++;
    return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count) };
  }

  private sweep(now: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
  }

  reset() {
    this.buckets.clear();
  }
}

const g = globalThis as unknown as { __quoteosLimiter?: RateLimiter };
export let rateLimiter: RateLimiter = g.__quoteosLimiter ?? (g.__quoteosLimiter = new MemoryRateLimiter());

export function setRateLimiter(l: RateLimiter) {
  rateLimiter = l;
}

export const LIMITS = {
  publicRead: { limit: 120, windowMs: 60_000 },
  sessionStart: { limit: 20, windowMs: 60_000 },
  sessionWrite: { limit: 120, windowMs: 60_000 },
  leadSubmit: { limit: 5, windowMs: 60_000 },
  assistant: { limit: 15, windowMs: 60_000 },
  adminAi: { limit: 20, windowMs: 60_000 },
  webhook: { limit: 60, windowMs: 60_000 },
} as const;

export async function enforceRateLimit(bucket: keyof typeof LIMITS, key: string) {
  const { limit, windowMs } = LIMITS[bucket];
  const r = await rateLimiter.hit(`${bucket}:${key}`, limit, windowMs);
  if (!r.allowed) throw tooManyRequests();
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
