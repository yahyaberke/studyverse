import { rateLimit, type Options } from 'express-rate-limit';
import { config } from '../config';

/**
 * In-process HTTP rate limiting. For multiple server instances, plug a shared store
 * (e.g. rate-limit-redis) into `store` — see docs/DEPLOYMENT.md.
 */
export function limiter(opts: Partial<Options> & { windowMs: number; limit: number }) {
  return rateLimit({
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => config.RATE_LIMIT_DISABLED,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.' } }),
    ...opts,
  });
}

/** Sliding-window counter for socket events and per-account limits. */
export class EventLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
    private respectGlobalDisable = true,
  ) {}

  allow(key: string): boolean {
    if (this.respectGlobalDisable && config.RATE_LIMIT_DISABLED) return true;
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}
