// ═══════════════════════════════════════
// PIN Login
// ═══════════════════════════════════════
// Real authentication against the `profiles` table.
//
// - PINs are verified against a PBKDF2 hash; plaintext PINs are never stored,
//   logged or returned.
// - The staff code identifies the account, so two people may share a PIN value
//   without either being able to sign in as the other.
// - Failures are rate limited per IP and lock the account after repeated
//   attempts.
// - On success a signed, httpOnly session cookie is issued. The client cannot
//   read or forge it.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { logActivity, clientIp } from '@/lib/database/activity';
import { verifySecret } from '@/lib/auth/crypto';
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/auth/session';
import { landingRouteFor } from '@/lib/auth/rbac';
import {
  checkRateLimit,
  recordFailure,
  clearAttempts,
  ACCOUNT_LOCK_THRESHOLD,
  ACCOUNT_LOCK_MINUTES,
} from '@/lib/auth/rate-limit';
import { pinLoginSchema, parseOrThrow } from '@/lib/validation/schemas';
import { fail, handleApiError } from '@/lib/auth/guard';
import type { UserRole } from '@/types';

/** Deliberately vague: never reveal whether the code or the PIN was wrong. */
const GENERIC_FAILURE = 'Invalid staff code or PIN.';

export async function POST(request: Request) {
  const ip = clientIp(request) ?? 'unknown';

  try {
    const limit = checkRateLimit(`pin:${ip}`);
    if (!limit.allowed) {
      return fail(
        `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
        429,
        'RATE_LIMITED'
      );
    }

    const body = parseOrThrow(pinLoginSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, name, role, pin_hash, is_active, failed_login_attempts, locked_until')
      .eq('staff_code', body.staffCode.toUpperCase())
      .maybeSingle();

    if (error) throw error;

    if (!profile || !profile.is_active || !profile.pin_hash) {
      recordFailure(`pin:${ip}`);
      await logActivity({
        userId: null,
        action: 'LOGIN_FAILED',
        details: `PIN login failed for staff code ${body.staffCode}`,
        ipAddress: ip,
      });
      return fail(GENERIC_FAILURE, 401, 'INVALID_CREDENTIALS');
    }

    if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
      return fail(
        'This account is temporarily locked after repeated failed attempts. Ask a manager to unlock it, or wait a few minutes.',
        423,
        'ACCOUNT_LOCKED'
      );
    }

    const valid = await verifySecret(body.pin, profile.pin_hash);

    if (!valid) {
      recordFailure(`pin:${ip}`);
      const attempts = (profile.failed_login_attempts ?? 0) + 1;
      await supabase
        .from('profiles')
        .update({
          failed_login_attempts: attempts,
          locked_until:
            attempts >= ACCOUNT_LOCK_THRESHOLD
              ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000).toISOString()
              : null,
        })
        .eq('id', profile.id);

      await logActivity({
        userId: profile.id,
        userName: profile.name,
        action: 'LOGIN_FAILED',
        details: `Incorrect PIN (attempt ${attempts})`,
        ipAddress: ip,
      });

      return fail(GENERIC_FAILURE, 401, 'INVALID_CREDENTIALS');
    }

    // ── Success ──
    clearAttempts(`pin:${ip}`);
    await supabase
      .from('profiles')
      .update({
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
      })
      .eq('id', profile.id);

    const role = profile.role as UserRole;
    const token = await createSessionToken({ id: profile.id, name: profile.name, role });

    await logActivity({
      userId: profile.id,
      userName: profile.name,
      action: 'LOGIN_SUCCESS',
      details: `PIN login as ${role}`,
      ipAddress: ip,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        user: { id: profile.id, name: profile.name, role },
        redirectTo: landingRouteFor(role),
      },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return handleApiError(error, 'auth/pin-login');
  }
}
