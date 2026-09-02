// ═══════════════════════════════════════
// First-Admin Bootstrap
// ═══════════════════════════════════════
// Creates the very first ADMIN account so a fresh deployment has a way in
// without shipping hardcoded credentials.
//
// Three conditions, all required:
//   1. BOOTSTRAP_TOKEN must be set in the environment and match the request
//   2. There must be ZERO active admin accounts in the database
//   3. The supplied PIN / password must satisfy the normal strength rules
//
// Once one admin exists this route permanently returns 409. Remove
// BOOTSTRAP_TOKEN from the environment after first use.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { ok, fail, handleApiError } from '@/lib/auth/guard';
import { hashSecret } from '@/lib/auth/crypto';
import { isSessionSecretConfigured } from '@/lib/auth/session';
import { logActivity, clientIp } from '@/lib/database/activity';
import { parseOrThrow } from '@/lib/validation/schemas';
import { z } from 'zod';

const bootstrapSchema = z.object({
  token: z.string().min(16),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  staff_code: z.string().trim().min(2).max(16).regex(/^[A-Za-z0-9_-]+$/),
  pin: z.string().regex(/^\d{4,6}$/),
  password: z.string().min(12, 'The first admin password must be at least 12 characters'),
});

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  try {
    const expected = process.env.BOOTSTRAP_TOKEN;
    if (!expected || expected.length < 16) {
      return fail(
        'Bootstrap is not enabled. Set a long BOOTSTRAP_TOKEN in the environment first.',
        403,
        'BOOTSTRAP_DISABLED'
      );
    }

    if (!isSessionSecretConfigured()) {
      return fail(
        'SESSION_SECRET is not configured. Set it before creating any account.',
        503,
        'SESSION_SECRET_MISSING'
      );
    }

    const body = parseOrThrow(bootstrapSchema, await request.json());

    if (!timingSafeStringEqual(body.token, expected)) {
      return fail('Invalid bootstrap token', 403, 'INVALID_TOKEN');
    }

    const supabase = createServiceRoleClient();
    const { count, error: countError } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'ADMIN')
      .eq('is_active', true);

    if (countError) throw countError;

    if ((count ?? 0) > 0) {
      return fail(
        'An admin account already exists. Create further staff from Admin → Staff.',
        409,
        'ALREADY_BOOTSTRAPPED'
      );
    }

    const staffCode = body.staff_code.toUpperCase();
    const { data, error } = await supabase
      .from('profiles')
      .upsert(
        {
          name: body.name,
          email: body.email,
          role: 'ADMIN',
          staff_code: staffCode,
          pin_hash: await hashSecret(body.pin),
          password_hash: await hashSecret(body.password),
          is_active: true,
        },
        { onConflict: 'email' }
      )
      .select('id, name, email, role, staff_code')
      .single();

    if (error) throw error;

    await logActivity({
      userId: data.id,
      userName: data.name,
      action: 'STAFF_CREATED',
      entityType: 'profile',
      entityId: data.id,
      details: `Bootstrap admin account created (${staffCode})`,
      ipAddress: clientIp(request),
    });

    return ok(
      {
        user: data,
        next: 'Remove BOOTSTRAP_TOKEN from the environment, then sign in and create the remaining staff accounts.',
      },
      201
    );
  } catch (error) {
    return handleApiError(error, 'auth/bootstrap');
  }
}
