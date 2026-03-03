/**
 * BlackRoad Gateway — Node.js Rate Limiter
 * Simple in-process sliding-window limiter (no external KV required).
 */

export class RateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly counts = new Map<string, { count: number; windowStart: number }>();

  constructor(opts: { maxRequests: number; windowMs: number }) {
    this.maxRequests = opts.maxRequests;
    this.windowMs    = opts.windowMs;
  }

  allow(clientId: string): boolean {
    const now = Date.now();
    const entry = this.counts.get(clientId);

    if (!entry || now - entry.windowStart > this.windowMs) {
      this.counts.set(clientId, { count: 1, windowStart: now });
      return true;
    }

    entry.count += 1;
    return entry.count <= this.maxRequests;
  }
}
