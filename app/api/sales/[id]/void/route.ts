// ═══════════════════════════════════════
// Void a Sale
// ═══════════════════════════════════════
// Status-based reversal — the original financial record is never deleted.
// The RPC records who voided it, when, why, reverses the stock through the
// ledger and backs the amounts out of the shift roll-up, all in one
// transaction.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { voidSaleSchema, parseOrThrow } from '@/lib/validation/schemas';

export const POST = withPermission(
  'sale.void',
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = parseOrThrow(voidSaleSchema, await request.json());

    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc('void_sale', {
      p_sale_id: id,
      p_user_id: session.sub,
      p_reason: body.reason,
      p_restock: body.restock,
    });

    if (error) throw new Error(error.message);
    return ok(data);
  },
  'sales/void'
);
