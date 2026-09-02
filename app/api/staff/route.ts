// ═══════════════════════════════════════
// Staff API
// ═══════════════════════════════════════
// GET  — staff list. PIN and password hashes are NEVER selected or returned;
//        there is no endpoint anywhere that can reveal a PIN.
// POST — create a staff member with a hashed PIN and/or password.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { hashSecret } from '@/lib/auth/crypto';
import { createStaffSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';

/** Explicit whitelist — pin_hash and password_hash are deliberately absent. */
const SAFE_FIELDS =
  'id, name, email, phone, role, staff_code, is_active, last_login_at, locked_until, created_at, updated_at';

export const GET = withPermission(
  'staff.read',
  async () => {
    const supabase = createServiceRoleClient();
    // The hashes are read here purely to derive "has a PIN set" booleans; they
    // are dropped before the response is built and never leave the server.
    const { data, error } = await supabase
      .from('profiles')
      .select(`${SAFE_FIELDS}, pin_hash, password_hash`)
      .order('name');

    if (error) throw error;

    return ok(
      (data ?? []).map(({ pin_hash, password_hash, ...staff }) => ({
        ...staff,
        hasPin: Boolean(pin_hash),
        hasPassword: Boolean(password_hash),
        isLocked: Boolean(staff.locked_until && new Date(staff.locked_until) > new Date()),
      }))
    );
  },
  'staff/GET'
);

export const POST = withPermission(
  'staff.manage',
  async (request, session) => {
    const body = parseOrThrow(createStaffSchema, await request.json());

    if (!body.pin && !body.password) {
      return fail(
        'Set a PIN, a password, or both — the account needs at least one way to sign in.',
        422,
        'NO_CREDENTIALS'
      );
    }

    const supabase = createServiceRoleClient();
    const staffCode = body.staff_code.toUpperCase();

    const { data: clash } = await supabase
      .from('profiles')
      .select('id')
      .or(`staff_code.eq.${staffCode}${body.email ? `,email.eq.${body.email}` : ''}`)
      .maybeSingle();

    if (clash) {
      return fail('That staff code or email is already in use.', 409, 'DUPLICATE_STAFF');
    }

    const { data, error } = await supabase
      .from('profiles')
      .insert({
        name: body.name,
        email: body.email ?? null,
        phone: body.phone ?? null,
        role: body.role,
        staff_code: staffCode,
        pin_hash: body.pin ? await hashSecret(body.pin) : null,
        password_hash: body.password ? await hashSecret(body.password) : null,
        is_active: body.is_active,
      })
      .select(SAFE_FIELDS)
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'STAFF_CREATED',
      entityType: 'profile',
      entityId: data.id,
      // The PIN itself is never written to the log.
      details: `Created ${body.role} account "${body.name}" (${staffCode})`,
      metadata: { role: body.role, staff_code: staffCode },
    });

    return ok(data, 201);
  },
  'staff/POST'
);
