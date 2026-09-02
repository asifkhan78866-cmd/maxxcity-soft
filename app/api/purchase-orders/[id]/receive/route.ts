// ═══════════════════════════════════════
// Receive Goods against a Purchase Order
// ═══════════════════════════════════════
// Raises stock through the ledger and records the supplier cost on the
// product so margin reporting has real cost data to work with.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { receivePurchaseOrderSchema, parseOrThrow } from '@/lib/validation/schemas';

export const POST = withPermission(
  'purchase.receive',
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = parseOrThrow(receivePurchaseOrderSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('receive_purchase_order', {
      p_po_id: id,
      p_user_id: session.sub,
      p_items: body.items,
    });

    if (error) throw new Error(error.message);
    return ok(data);
  },
  'purchase-orders/receive'
);
