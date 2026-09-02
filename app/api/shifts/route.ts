// ═══════════════════════════════════════
// Shifts API
// ═══════════════════════════════════════
// GET  — shift list (own shifts for a cashier, all shifts for manager/admin)
// POST — open a shift
//
// A cashier may hold only one open shift at a time; the unique partial index
// on shifts(cashier_id) WHERE status = 'OPEN' enforces that in the database,
// not just here.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { requireAuth, requirePermission, ok, fail, handleApiError } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { openShiftSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 200);

    const supabase = createServiceRoleClient();
    let builder = supabase
      .from('shifts')
      .select('*, profiles!shifts_cashier_id_fkey(name)')
      .order('opened_at', { ascending: false })
      .limit(limit);

    if (!hasPermission(session.role, 'shift.read.all')) {
      builder = builder.eq('cashier_id', session.sub);
    }
    if (status) builder = builder.eq('status', status);

    const { data, error } = await builder;
    if (error) throw error;

    return ok(
      (data ?? []).map((s) => ({
        ...s,
        cashier_name:
          (s as { profiles?: { name?: string } | null }).profiles?.name ?? 'Unknown',
      }))
    );
  } catch (error) {
    return handleApiError(error, 'shifts/GET');
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePermission('shift.open');
    const body = parseOrThrow(openShiftSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data: openShift } = await supabase
      .from('shifts')
      .select('id, opened_at')
      .eq('cashier_id', session.sub)
      .eq('status', 'OPEN')
      .maybeSingle();

    if (openShift) {
      return fail(
        'You already have an open shift. Close it before opening another.',
        409,
        'SHIFT_ALREADY_OPEN',
        { shiftId: openShift.id }
      );
    }

    const { data, error } = await supabase
      .from('shifts')
      .insert({
        cashier_id: session.sub,
        opening_cash: body.opening_cash,
        expected_cash: body.opening_cash,
        terminal_id: body.terminal_id ?? null,
        status: 'OPEN',
      })
      .select('*')
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'SHIFT_OPENED',
      entityType: 'shift',
      entityId: data.id,
      details: `Opening cash ₹${body.opening_cash.toFixed(2)}`,
      metadata: { opening_cash: body.opening_cash, terminal_id: body.terminal_id },
    });

    return ok(data, 201);
  } catch (error) {
    return handleApiError(error, 'shifts/POST');
  }
}
