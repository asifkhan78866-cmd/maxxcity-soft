// ═══════════════════════════════════════
// Current Open Shift
// ═══════════════════════════════════════
// The POS calls this on load: no open shift means no billing.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withAuth, ok } from '@/lib/auth/guard';

export const GET = withAuth(async (_request, session) => {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('cashier_id', session.sub)
    .eq('status', 'OPEN')
    .maybeSingle();

  if (error) throw error;

  if (!data) return ok({ shift: null });

  // Report the expected cash from the stored running totals rather than a
  // separate aggregate query, so the cashier sees the same number the close
  // will reconcile against.
  const expectedCash =
    Number(data.opening_cash) + Number(data.cash_sales_total) - Number(data.total_refunds ?? 0);

  return ok({ shift: { ...data, expected_cash: expectedCash } });
});
