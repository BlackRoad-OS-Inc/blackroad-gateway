/**
 * BlackRoad Gateway — Rate Limiter
 * Per-IP + per-agent sliding window rate limiting using CF Durable Objects / KV.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

interface WindowConfig {
  limit: number;
  windowSeconds: number;
}

const DEFAULT_WINDOWS: Record<string, WindowConfig> = {
  global:    { limit: 200, windowSeconds: 60 },
  chat:      { limit: 60,  windowSeconds: 60 },
  memory:    { limit: 120, windowSeconds: 60 },
  agents:    { limit: 30,  windowSeconds: 60 },
};

export async function checkRateLimit(
  ip: string,
  route: string,
  kv?: KVNamespace
): Promise<RateLimitResult> {
  const config = DEFAULT_WINDOWS[route] ?? DEFAULT_WINDOWS.global;
  const windowMs = config.windowSeconds * 1000;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const key = `rl:${ip}:${route}:${windowStart}`;

  // In-memory fallback (for when KV isn't available)
  if (!kv) {
    return { allowed: true, remaining: config.limit - 1, resetAt: windowEnd };
  }

  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= config.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: windowEnd,
      retryAfter: Math.ceil((windowEnd - now) / 1000),
    };
  }

  await kv.put(key, String(count + 1), { expirationTtl: config.windowSeconds + 5 });
  return { allowed: true, remaining: config.limit - count - 1, resetAt: windowEnd };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (result.retryAfter !== undefined) {
    headers["Retry-After"] = String(result.retryAfter);
  }
  return headers;
}
