/**
 * Simple in-memory rate limiter for gateway requests.
 */

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(
    private opts: { maxRequests: number; windowMs: number } = {
      maxRequests: 100,
      windowMs: 60_000,
    }
  ) {}

  allow(clientId: string): boolean {
    const now = Date.now();
    const win = this.windows.get(clientId);

    if (!win || now >= win.resetAt) {
      this.windows.set(clientId, {
        count: 1,
        resetAt: now + this.opts.windowMs,
      });
      return true;
    }

    if (win.count >= this.opts.maxRequests) return false;

    win.count++;
    return true;
  }

  remaining(clientId: string): number {
    const win = this.windows.get(clientId);
    if (!win || Date.now() >= win.resetAt) return this.opts.maxRequests;
    return Math.max(0, this.opts.maxRequests - win.count);
  }

  /** Clean up expired windows (call periodically) */
  prune(): void {
    const now = Date.now();
    for (const [id, win] of this.windows) {
      if (now >= win.resetAt) this.windows.delete(id);
    }
  }
}
