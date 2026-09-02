// ═══════════════════════════════════════
// Close a Shift
// ═══════════════════════════════════════
// The RPC recomputes expected cash from opening cash + cash sales - refunds
// (never trusting a client-supplied figure), stores the counted amount and
// the discrepancy, and demands a reason when the difference is material.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { closeShiftSchema, parseOrThrow } from '@/lib/validation/schemas';

export const POST = withPermission(
  'shift.close',
  async (request, session) => {
    const body = parseOrThrow(closeShiftSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data: shift } = await supabase
      .from('shifts')
      .select('id, cashier_id, status')
      .eq('id', body.shift_id)
      .maybeSingle();

    if (!shift) return fail('Shift not found', 404, 'SHIFT_NOT_FOUND');

    // A cashier may close only their own shift; a manager may close any.
    if (shift.cashier_id !== session.sub && !hasPermission(session.role, 'shift.read.all')) {
      return fail('You may only close your own shift', 403, 'FORBIDDEN');
    }

    const { data, error } = await supabase.rpc('close_shift', {
      p_shift_id: body.shift_id,
      p_user_id: session.sub,
      p_closing_cash: body.closing_cash,
      p_reason: body.reason ?? null,
    });

    if (error) throw new Error(error.message);
    return ok(data);
  },
  'shifts/close'
);
