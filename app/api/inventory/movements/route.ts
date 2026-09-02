// ═══════════════════════════════════════
// Stock Movement Ledger
// ═══════════════════════════════════════
// The full audit trail of every stock change: opening stock, purchases,
// sales, returns, adjustments, damage, loss, transfers and void reversals.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';

export const GET = withPermission(
  'inventory.read',
  async (request) => {
    const url = new URL(request.url);
    const productId = url.searchParams.get('product_id');
    const type = url.searchParams.get('type');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));

    const supabase = createServiceRoleClient();
    let builder = supabase
      .from('stock_movements')
      .select(
        'id, product_id, movement_type, quantity, before_qty, after_qty, ' +
          'reference_type, reference_id, reason, created_at, ' +
          'products(name, barcode), profiles(name)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    if (productId) builder = builder.eq('product_id', productId);
    if (type) builder = builder.eq('movement_type', type);

    const offset = (page - 1) * limit;
    const { data, error, count } = await builder.range(offset, offset + limit - 1);
    if (error) throw error;

    return ok({
      movements: data ?? [],
      pagination: { page, pageSize: limit, total: count ?? 0 },
    });
  },
  'inventory/movements'
);
