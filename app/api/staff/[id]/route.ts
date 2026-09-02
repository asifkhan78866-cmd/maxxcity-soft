// ═══════════════════════════════════════
// Single Staff Member — update / deactivate
// ═══════════════════════════════════════
// Accounts are deactivated, never deleted: sales, shifts and audit rows
// reference them.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { hashSecret } from '@/lib/auth/crypto';
import { updateStaffSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';

const SAFE_FIELDS =
  'id, name, email, phone, role, staff_code, is_active, last_login_at, locked_until, created_at, updated_at';

export const PATCH = withPermission(
  'staff.manage',
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = parseOrThrow(updateStaffSchema, { ...(await request.json()), id });
    const supabase = createServiceRoleClient();

    const { data: existing } = await supabase
      .from('profiles')
      .select('id, name, role, is_active')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return fail('Staff member not found', 404, 'STAFF_NOT_FOUND');

    // Guard against locking everyone out of the system.
    if ((body.is_active === false || (body.role && body.role !== 'ADMIN')) && existing.role === 'ADMIN') {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'ADMIN')
        .eq('is_active', true);

      if ((count ?? 0) <= 1) {
        return fail(
          'This is the last active admin account — it cannot be deactivated or demoted.',
          409,
          'LAST_ADMIN'
        );
      }
    }

    const updates: Record<string, unknown> = {};
    for (const field of ['name', 'email', 'phone', 'role', 'is_active'] as const) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    if (body.staff_code) updates.staff_code = body.staff_code.toUpperCase();

    // Credentials are re-hashed; the plaintext never lands in the database,
    // the log or the response.
    if (body.pin) updates.pin_hash = await hashSecret(body.pin);
    if (body.password) updates.password_hash = await hashSecret(body.password);

    // Any credential change or reactivation clears an existing lockout.
    if (body.pin || body.password || body.is_active === true) {
      updates.failed_login_attempts = 0;
      updates.locked_until = null;
    }

    if (Object.keys(updates).length === 0) {
      return fail('No changes supplied', 422, 'NO_CHANGES');
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select(SAFE_FIELDS)
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: body.is_active === false ? 'STAFF_DEACTIVATED' : 'STAFF_UPDATED',
      entityType: 'profile',
      entityId: id,
      details: `${existing.name}: ${Object.keys(updates)
        .filter((k) => !k.includes('hash') && k !== 'updated_at')
        .join(', ')} changed${body.pin ? ' (PIN reset)' : ''}${body.password ? ' (password reset)' : ''}`,
      metadata: { role: data.role, is_active: data.is_active },
    });

    return ok(data);
  },
  'staff/PATCH'
);
