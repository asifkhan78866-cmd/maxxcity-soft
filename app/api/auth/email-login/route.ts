// ═══════════════════════════════════════
// Email + Password Login
// ═══════════════════════════════════════
// Verifies against the PBKDF2 hash stored in `profiles.password_hash`.
// There are no hardcoded credentials — an account must be created through
// the staff API (or the bootstrap script) before anyone can sign in.

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
import { emailLoginSchema, parseOrThrow } from '@/lib/validation/schemas';
import { fail, handleApiError } from '@/lib/auth/guard';
import type { UserRole } from '@/types';

const GENERIC_FAILURE = 'Invalid email or password.';

export async function POST(request: Request) {
  const ip = clientIp(request) ?? 'unknown';

  try {
    const limit = checkRateLimit(`email:${ip}`);
    if (!limit.allowed) {
      return fail(
        `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
        429,
        'RATE_LIMITED'
      );
    }

    const body = parseOrThrow(emailLoginSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, name, role, email, password_hash, is_active, failed_login_attempts, locked_until')
      .eq('email', body.email)
      .maybeSingle();

    if (error) throw error;

    if (!profile || !profile.is_active || !profile.password_hash) {
      recordFailure(`email:${ip}`);
      await logActivity({
        userId: null,
        action: 'LOGIN_FAILED',
        details: `Email login failed for ${body.email}`,
        ipAddress: ip,
      });
      return fail(GENERIC_FAILURE, 401, 'INVALID_CREDENTIALS');
    }

    if (profile.locked_until && new Date(profile.locked_until) > new Date()) {
      return fail(
        'This account is temporarily locked after repeated failed attempts.',
        423,
        'ACCOUNT_LOCKED'
      );
    }

    if (!(await verifySecret(body.password, profile.password_hash))) {
      recordFailure(`email:${ip}`);
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
        details: `Incorrect password (attempt ${attempts})`,
        ipAddress: ip,
      });

      return fail(GENERIC_FAILURE, 401, 'INVALID_CREDENTIALS');
    }

    clearAttempts(`email:${ip}`);
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
      details: `Email login as ${role}`,
      ipAddress: ip,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        user: { id: profile.id, name: profile.name, role, email: profile.email },
        redirectTo: landingRouteFor(role),
      },
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return handleApiError(error, 'auth/email-login');
  }
}
