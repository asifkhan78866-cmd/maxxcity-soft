// ═══════════════════════════════════════
// Authentication & Authorization
// ═══════════════════════════════════════
// Covers the properties that actually keep the system safe: PINs are never
// recoverable, a session cannot be forged or role-escalated, expiry is
// enforced, and role permissions match the intended matrix.

import { describe, it, expect, beforeAll } from 'vitest';
import { hashSecret, verifySecret, randomToken } from '@/lib/auth/crypto';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth/session';
import {
  hasPermission,
  canAccessRoute,
  landingRouteFor,
  maxDiscountFor,
  ROLE_PERMISSIONS,
} from '@/lib/auth/rbac';
import { authorizeDiscount, mergeLines } from '@/lib/sales/service';
import { ApiError } from '@/lib/auth/guard';

beforeAll(() => {
  process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-1234567890';
});

describe('PIN and password hashing', () => {
  it('never stores the plaintext', async () => {
    const hash = await hashSecret('1234');
    expect(hash).not.toContain('1234');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
  });

  it('verifies the correct secret and rejects a wrong one', async () => {
    const hash = await hashSecret('4821');
    expect(await verifySecret('4821', hash)).toBe(true);
    expect(await verifySecret('4822', hash)).toBe(false);
    expect(await verifySecret('', hash)).toBe(false);
  });

  it('salts, so the same PIN produces different hashes', async () => {
    const a = await hashSecret('1234');
    const b = await hashSecret('1234');
    expect(a).not.toBe(b);
    // …yet both still verify.
    expect(await verifySecret('1234', a)).toBe(true);
    expect(await verifySecret('1234', b)).toBe(true);
  });

  it('rejects a missing or malformed stored hash instead of throwing', async () => {
    expect(await verifySecret('1234', null)).toBe(false);
    expect(await verifySecret('1234', undefined)).toBe(false);
    expect(await verifySecret('1234', 'not-a-hash')).toBe(false);
    expect(await verifySecret('1234', 'md5$1$x$y')).toBe(false);
  });

  it('produces distinct random tokens', () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe('session tokens', () => {
  it('round-trips a valid session', async () => {
    const token = await createSessionToken({ id: 'u1', name: 'Ravi', role: 'CASHIER' });
    const session = await verifySessionToken(token);

    expect(session).not.toBeNull();
    expect(session!.sub).toBe('u1');
    expect(session!.role).toBe('CASHIER');
    expect(session!.exp - session!.iat).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it('rejects a token whose payload was edited to escalate the role', async () => {
    const token = await createSessionToken({ id: 'u1', name: 'Ravi', role: 'CASHIER' });
    const [payload, signature] = token.split('.');

    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );
    decoded.role = 'ADMIN';

    const forgedPayload = Buffer.from(JSON.stringify(decoded))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Same (now stale) signature over a different payload.
    expect(await verifySessionToken(`${forgedPayload}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken({ id: 'u1', name: 'Ravi', role: 'ADMIN' });
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'a-completely-different-secret-value-0987654321';
    expect(await verifySessionToken(token)).toBeNull();
    process.env.SESSION_SECRET = original;
  });

  it('rejects malformed, empty and missing tokens', async () => {
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken(null)).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
    expect(await verifySessionToken('garbage')).toBeNull();
    expect(await verifySessionToken('a.b.c')).toBeNull();
  });

  it('rejects an expired session', async () => {
    const expired = {
      sub: 'u1',
      name: 'Ravi',
      role: 'CASHIER',
      iat: Math.floor(Date.now() / 1000) - 100000,
      exp: Math.floor(Date.now() / 1000) - 10,
    };
    const encoded = Buffer.from(JSON.stringify(expired))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const { signPayload } = await import('@/lib/auth/crypto');
    const signature = await signPayload(encoded, process.env.SESSION_SECRET!);

    // Correctly signed, but past its expiry.
    expect(await verifySessionToken(`${encoded}.${signature}`)).toBeNull();
  });

  it('rejects a session carrying an unknown role', async () => {
    const payload = {
      sub: 'u1',
      name: 'X',
      role: 'SUPERUSER',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const encoded = Buffer.from(JSON.stringify(payload))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const { signPayload } = await import('@/lib/auth/crypto');
    const signature = await signPayload(encoded, process.env.SESSION_SECRET!);

    expect(await verifySessionToken(`${encoded}.${signature}`)).toBeNull();
  });
});

describe('role permissions', () => {
  it('lets a cashier sell but not reach admin capability', () => {
    expect(hasPermission('CASHIER', 'pos.sell')).toBe(true);
    expect(hasPermission('CASHIER', 'shift.open')).toBe(true);
    expect(hasPermission('CASHIER', 'sale.void')).toBe(false);
    expect(hasPermission('CASHIER', 'staff.manage')).toBe(false);
    expect(hasPermission('CASHIER', 'reports.read')).toBe(false);
    expect(hasPermission('CASHIER', 'audit.read')).toBe(false);
    expect(hasPermission('CASHIER', 'database.seed')).toBe(false);
    expect(hasPermission('CASHIER', 'sale.read.all')).toBe(false);
  });

  it('gives a manager operational control but not staff or audit', () => {
    expect(hasPermission('MANAGER', 'sale.void')).toBe(true);
    expect(hasPermission('MANAGER', 'inventory.adjust')).toBe(true);
    expect(hasPermission('MANAGER', 'reports.read')).toBe(true);
    expect(hasPermission('MANAGER', 'staff.manage')).toBe(false);
    expect(hasPermission('MANAGER', 'audit.read')).toBe(false);
    expect(hasPermission('MANAGER', 'settings.write')).toBe(false);
  });

  it('gives an admin everything a manager has, and more', () => {
    for (const permission of ROLE_PERMISSIONS.MANAGER) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
    expect(hasPermission('ADMIN', 'staff.manage')).toBe(true);
    expect(hasPermission('ADMIN', 'audit.read')).toBe(true);
  });

  it('returns false for a missing role rather than defaulting open', () => {
    expect(hasPermission(null, 'pos.sell')).toBe(false);
    expect(hasPermission(undefined, 'pos.sell')).toBe(false);
  });
});

describe('route access', () => {
  it('keeps a cashier out of the admin area', () => {
    expect(canAccessRoute('CASHIER', '/billing')).toBe(true);
    expect(canAccessRoute('CASHIER', '/admin/dashboard')).toBe(false);
    expect(canAccessRoute('CASHIER', '/admin/staff')).toBe(false);
    expect(canAccessRoute('CASHIER', '/admin')).toBe(false);
  });

  it('gives a manager the operational pages but not staff or audit', () => {
    expect(canAccessRoute('MANAGER', '/admin/inventory')).toBe(true);
    expect(canAccessRoute('MANAGER', '/admin/reports')).toBe(true);
    expect(canAccessRoute('MANAGER', '/admin/sales')).toBe(true);
    expect(canAccessRoute('MANAGER', '/admin/staff')).toBe(false);
    expect(canAccessRoute('MANAGER', '/admin/audit')).toBe(false);
  });

  it('lets an admin everywhere', () => {
    for (const path of [
      '/billing',
      '/admin/dashboard',
      '/admin/staff',
      '/admin/audit',
      '/admin/emi',
    ]) {
      expect(canAccessRoute('ADMIN', path)).toBe(true);
    }
  });

  it('matches nested paths, not just exact ones', () => {
    expect(canAccessRoute('CASHIER', '/admin/staff/new')).toBe(false);
    expect(canAccessRoute('MANAGER', '/admin/inventory/123')).toBe(true);
  });

  it('sends each role to a landing page it can actually open', () => {
    expect(landingRouteFor('CASHIER')).toBe('/billing');
    expect(canAccessRoute('CASHIER', landingRouteFor('CASHIER'))).toBe(true);
    expect(canAccessRoute('MANAGER', landingRouteFor('MANAGER'))).toBe(true);
    expect(canAccessRoute('ADMIN', landingRouteFor('ADMIN'))).toBe(true);
  });
});

describe('discount authorisation', () => {
  it('gives a cashier no discount allowance at all', () => {
    expect(maxDiscountFor('CASHIER', 1000)).toBe(0);
    expect(() => authorizeDiscount('CASHIER', 10, 1000, 'goodwill')).toThrow(ApiError);
  });

  it('caps a manager', () => {
    // 10% of ₹1000 = ₹100
    expect(maxDiscountFor('MANAGER', 1000)).toBe(100);
    expect(authorizeDiscount('MANAGER', 50, 1000, 'damaged packaging')).toBe(50);
    expect(() => authorizeDiscount('MANAGER', 200, 1000, 'too much')).toThrow(ApiError);
  });

  it('requires a reason for any non-zero discount', () => {
    expect(() => authorizeDiscount('MANAGER', 50, 1000, '')).toThrow(ApiError);
    expect(() => authorizeDiscount('MANAGER', 50, 1000, null)).toThrow(ApiError);
    expect(() => authorizeDiscount('MANAGER', 50, 1000, 'ab')).toThrow(ApiError);
  });

  it('lets a zero discount through without a reason', () => {
    expect(authorizeDiscount('CASHIER', 0, 1000, null)).toBe(0);
    expect(authorizeDiscount('MANAGER', 0, 1000, null)).toBe(0);
  });

  it('lets an admin override', () => {
    expect(authorizeDiscount('ADMIN', 900, 1000, 'owner approval')).toBe(900);
  });

  it('treats a negative requested discount as zero', () => {
    expect(authorizeDiscount('MANAGER', -100, 1000, null)).toBe(0);
  });
});

describe('sale line normalisation', () => {
  it('merges duplicate scans of the same product into one line', () => {
    const merged = mergeLines([
      { product_id: 'a', qty: 2 },
      { product_id: 'b', qty: 1 },
      { product_id: 'a', qty: 3 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.find((l) => l.product_id === 'a')!.qty).toBe(5);
    expect(merged.find((l) => l.product_id === 'b')!.qty).toBe(1);
  });

  it('leaves already-unique lines untouched', () => {
    const lines = [
      { product_id: 'a', qty: 1 },
      { product_id: 'b', qty: 2 },
    ];
    expect(mergeLines(lines)).toEqual(lines);
  });
});
