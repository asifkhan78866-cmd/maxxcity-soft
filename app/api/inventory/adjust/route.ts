// ═══════════════════════════════════════
// Stock Adjustment
// ═══════════════════════════════════════
// The only way stock changes outside a sale, return or goods receipt.
// Every adjustment writes a stock_movements row with before/after quantities
// and a mandatory reason, plus an activity-log entry.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { stockAdjustmentSchema, parseOrThrow } from '@/lib/validation/schemas';

export const POST = withPermission(
  'inventory.adjust',
  async (request, session) => {
    const body = parseOrThrow(stockAdjustmentSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('adjust_stock', {
      p_product_id: body.product_id,
      p_user_id: session.sub,
      p_delta: body.delta,
      p_movement_type: body.movement_type,
      p_reason: body.reason,
    });

    if (error) throw new Error(error.message);
    return ok(data);
  },
  'inventory/adjust'
);
