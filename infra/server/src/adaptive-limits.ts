import { RateLimiterMemory } from 'rate-limiter-flexible';
import { LibSqlStore } from './libsql-store.js';

/**
 * Adaptive, admin-configurable rate limiting (R10).
 *
 * Why not static express-rate-limit on app surfaces: it keys by IP and its
 * budgets are hardcoded at boot. On a demo behind NAT every user shares one
 * bucket, a chatty assistant (multi-turn tool loops) exhausts 30/min fast,
 * and nobody — including the admin — can change anything without redeploying.
 *
 * Design:
 * - Per-IDENTITY keys: authenticated users get their own bucket by user id;
 *   anonymous traffic falls back to IP. No more collective lockout.
 * - All knobs live in libSQL config (`limits.<surface>.*`), editable at
 *   runtime via set_config / Settings UI; values are cached briefly so the
 *   DB is not hit per request.
 * - Admins are exempt on chat surfaces by default (`limits.bypassAdmin`).
 * - Block durations are SHORT: over-limit costs a short cool-down
 *   (`blockDurationMs`, default 15s), never the whole window — a bursty
 *   client stalls briefly instead of being locked out for a minute.
 * - Responses carry RateLimit-* headers + Retry-After so clients can adapt.
 */

interface SurfaceDefaults {
  pointsPerWindow: number;
  windowMs: number;
  blockDurationMs: number;
}

const SURFACES = ['chat', 'connections', 'mcpProxy'] as const;
export type Surface = typeof SURFACES[number];

const DEFAULTS: Record<Surface, SurfaceDefaults> = {
  chat: { pointsPerWindow: 60, windowMs: 60_000, blockDurationMs: 15_000 },
  connections: { pointsPerWindow: 240, windowMs: 60_000, blockDurationMs: 15_000 },
  mcpProxy: { pointsPerWindow: 600, windowMs: 60_000, blockDurationMs: 15_000 },
};

export interface LimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
  limit: number;
}

type Limiters = Map<string, RateLimiterMemory>;

interface CachedSettings extends SurfaceDefaults {
  cachedAt: number;
}

export class AdaptiveLimits {
  private store: LibSqlStore;
  private limiters: Limiters = new Map();
  private cache = new Map<string, CachedSettings>();
  private readonly settingsTtlMs = 5_000;
  private bypassAdmin = true;

  constructor(store: LibSqlStore) {
    this.store = store;
    void this.loadBypassFlag();
    // Refresh policy knobs periodically instead of per-request to keep the
    // hot path synchronous after cache hit.
    setInterval(() => void this.refreshAll(), this.settingsTtlMs).unref?.();
  }

  private async loadBypassFlag(): Promise<void> {
    try {
      const raw = await this.store.getConfig('limits.bypassAdmin');
      const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).value : raw;
      this.bypassAdmin = value !== false;
    } catch { /* default stays true */ }
  }

  private async surfaceDefaults(surface: Surface): Promise<SurfaceDefaults> {
    const key = `limits.${surface}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.cachedAt < this.settingsTtlMs) return hit;

    let resolved: SurfaceDefaults = DEFAULTS[surface];
    try {
      const row = await this.store.getConfig(key);
      const override =
        row && typeof row === 'object' ? ((row as Record<string, unknown>).value ?? row) : row;
      if (override && typeof override === 'object') {
        const o = override as Record<string, unknown>;
        resolved = {
          pointsPerWindow: Math.max(1, Number(o.pointsPerWindow ?? DEFAULTS[surface].pointsPerWindow)),
          windowMs: Math.max(1_000, Number(o.windowMs ?? DEFAULTS[surface].windowMs)),
          blockDurationMs: Math.max(0, Number(o.blockDurationMs ?? DEFAULTS[surface].blockDurationMs)),
        };
      }
      if (override && typeof override === 'object') {
        const flag = (override as Record<string, unknown>)['bypassAdmin'];
        if (flag !== undefined) this.bypassAdmin = flag !== false;
      }
    } catch { /* defaults on db hiccup */ }

    const entry: CachedSettings = { ...resolved, cachedAt: now };
    this.cache.set(key, entry);
    return entry;
  }

  async refreshAll(): Promise<void> {
    await Promise.all(SURFACES.map((s) => this.surfaceDefaults(s)));
    await this.loadBypassFlag();
  }

  async consume(
    surface: Surface,
    identity: { userId?: string | null; role?: string | null; ip?: string | null },
    cost = 1,
  ): Promise<LimitDecision> {
    if (this.bypassAdmin && identity.role === 'admin') {
      return { allowed: true, retryAfterMs: 0, remaining: Infinity, limit: Infinity };
    }
    const d = await this.surfaceDefaults(surface);
    const limiterKey = `${surface}:${d.windowMs}:${d.pointsPerWindow}`;
    let rl = this.limiters.get(limiterKey);
    if (!rl) {
      rl = new RateLimiterMemory({
        points: d.pointsPerWindow,
        duration: Math.ceil(d.windowMs / 1000),
        blockDuration: Math.ceil(d.blockDurationMs / 1000),
      });
      this.limiters.set(limiterKey, rl);
    }
    // Sweeping old-shape limiter instances when knobs change.
    for (const k of [...this.limiters.keys()]) {
      if (k.startsWith(`${surface}:`) && k !== limiterKey) this.limiters.delete(k);
    }

    const idKey = identity.userId ? `u:${identity.userId}` : `ip:${identity.ip ?? 'unknown'}`;
    try {
      const res = await rl.consume(idKey, cost);
      return { allowed: true, retryAfterMs: 0, remaining: res.remainingPoints, limit: res.consumedPoints + res.remainingPoints };
    } catch (err) {
      const info = err as { msBeforeNext?: number };
      return { allowed: false, retryAfterMs: info.msBeforeNext ?? d.blockDurationMs, remaining: 0, limit: d.pointsPerWindow };
    }
  }
}
