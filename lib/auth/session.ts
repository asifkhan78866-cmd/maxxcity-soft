// ═══════════════════════════════════════
// Session Management
// ═══════════════════════════════════════
// Sessions are stateless, HMAC-signed cookies. The payload carries only the
// user id, display name and role plus issue/expiry timestamps — never a PIN,
// a password or a hash.
//
// Because the cookie is signed with a server-only secret, a client cannot
// escalate its own role by editing the cookie: verification fails and the
// request is treated as unauthenticated.

import { signPayload, verifyPayload, toBase64Url, fromBase64Url } from './crypto';
import type { UserRole } from '@/types';

export const SESSION_COOKIE = 'maxxcity_session';

/** Session lifetime — a retail shift plus headroom. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

export interface SessionPayload {
  /** Staff profile id. */
  sub: string;
  name: string;
  role: UserRole;
  /** Issued at (epoch seconds). */
  iat: number;
  /** Expires at (epoch seconds). */
  exp: number;
}

class MissingSessionSecretError extends Error {
  constructor() {
    super(
      'SESSION_SECRET is not configured. Set a long random value in the environment before running the POS.'
    );
    this.name = 'MissingSessionSecretError';
  }
}

/**
 * Resolve the signing secret.
 *
 * In production a missing secret is fatal — silently falling back to a default
 * would make every session forgeable. In development we allow an explicit,
 * clearly-labelled dev secret so `next dev` works out of the box.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new MissingSessionSecretError();
  }
  if (secret) {
    throw new Error('SESSION_SECRET must be at least 32 characters long.');
  }
  return 'dev-only-insecure-session-secret-do-not-use-in-production';
}

export function isSessionSecretConfigured(): boolean {
  const secret = process.env.SESSION_SECRET;
  return Boolean(secret && secret.length >= 32);
}

/** Create a signed session token for a staff member. */
export async function createSessionToken(user: {
  id: string;
  name: string;
  role: UserRole;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };

  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signPayload(encoded, getSessionSecret());
  return `${encoded}.${signature}`;
}

/**
 * Verify a session token.
 * Returns null for a missing, malformed, tampered or expired token.
 */
export async function verifySessionToken(
  token: string | undefined | null
): Promise<SessionPayload | null> {
  if (!token) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  let secret: string;
  try {
    secret = getSessionSecret();
  } catch {
    // No secret configured — refuse every session rather than trusting one.
    return null;
  }

  if (!(await verifyPayload(encoded, signature, secret))) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as SessionPayload;
    if (!payload?.sub || !payload?.role) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!['CASHIER', 'MANAGER', 'ADMIN'].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Cookie attributes for the session cookie. */
export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}
