// ═══════════════════════════════════════
// Auth Cryptography
// ═══════════════════════════════════════
// Built on Web Crypto (globalThis.crypto.subtle) so the same code runs in the
// Node.js runtime, in Proxy, and on edge deployments.
//
// - PINs and passwords are stored as PBKDF2-SHA256 hashes with a random salt.
//   Plaintext PINs are never stored, logged or returned by any API.
// - Session cookies are HMAC-SHA256 signed so a client cannot forge a role.

const encoder = new TextEncoder();

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023 guidance for PBKDF2-SHA256
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Constant-time comparison — avoids leaking match position via timing. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS
  );
  return new Uint8Array(bits);
}

/**
 * Hash a PIN or password.
 * Returns a self-describing string: `pbkdf2$<iterations>$<salt>$<hash>`.
 */
export async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(secret, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

/** Verify a PIN or password against a stored hash. Never throws. */
export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  try {
    const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isInteger(iterations) || iterations < 1000) return false;

    const salt = fromBase64Url(saltRaw);
    const expected = fromBase64Url(hashRaw);
    const actual = await pbkdf2(secret, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ─── HMAC signing (session cookies) ───

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(sig));
}

export async function verifyPayload(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const expected = await signPayload(payload, secret);
    return timingSafeEqual(fromBase64Url(expected), fromBase64Url(signature));
  } catch {
    return false;
  }
}

export { toBase64Url, fromBase64Url };

/** Generate a random opaque token (idempotency keys, reset tokens, …). */
export function randomToken(bytes = 24): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}
