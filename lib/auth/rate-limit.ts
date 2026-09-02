// ═══════════════════════════════════════
// Login Rate Limiting
// ═══════════════════════════════════════
// In-memory sliding window. This is per server instance — good enough for a
// single-store deployment behind one Node process, and it complements the
// per-account lockout stored in `profiles.locked_until`, which IS shared
// across instances. If the POS is ever scaled horizontally, move this to a
// shared store (Redis / Postgres).

interface Attempt {
  count: number;
  firstAt: number;
  blockedUntil: number;
}

const attempts = new Map<string, Attempt>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;
const BLOCK_MS = 15 * 60 * 1000;

/** Account-level lockout thresholds, enforced against the profiles table. */
export const ACCOUNT_LOCK_THRESHOLD = 5;
export const ACCOUNT_LOCK_MINUTES = 15;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry) return { allowed: true, retryAfterSeconds: 0, remaining: MAX_ATTEMPTS };

  if (entry.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
      remaining: 0,
    };
  }

  if (now - entry.firstAt > WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true, retryAfterSeconds: 0, remaining: MAX_ATTEMPTS };
  }

  return {
    allowed: entry.count < MAX_ATTEMPTS,
    retryAfterSeconds: 0,
    remaining: Math.max(0, MAX_ATTEMPTS - entry.count),
  };
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
    return;
  }

  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
  }
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}

// Opportunistic cleanup so the map cannot grow without bound.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS - BLOCK_MS;
  for (const [key, entry] of attempts) {
    if (entry.firstAt < cutoff && entry.blockedUntil < Date.now()) attempts.delete(key);
  }
}, 5 * 60 * 1000).unref?.();
