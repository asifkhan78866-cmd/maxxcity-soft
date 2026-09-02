// ═══════════════════════════════════════
// Single Product — update / deactivate
// ═══════════════════════════════════════
// Products are deactivated, never deleted: sale_items reference them and
// history must stay readable.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { updateProductSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';

export const PATCH = withPermission(
  'product.update',
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body = parseOrThrow(updateProductSchema, { ...(await request.json()), id });
    const supabase = createServiceRoleClient();

    const { data: existing } = await supabase
      .from('products')
      .select('id, name, barcode')
      .eq('id', id)
      .maybeSingle();

    if (!existing) return fail('Product not found', 404, 'PRODUCT_NOT_FOUND');

    if (body.barcode && body.barcode !== existing.barcode) {
      const { data: clash } = await supabase
        .from('products')
        .select('id, name')
        .eq('barcode', body.barcode)
        .neq('id', id)
        .maybeSingle();
      if (clash) {
        return fail(
          `Barcode ${body.barcode} already belongs to "${clash.name}".`,
          409,
          'DUPLICATE_BARCODE'
        );
      }
    }

    // Whitelist: `price` and `stock_qty` are deliberately absent. The price is
    // centrally controlled and stock only moves through adjust_stock() so
    // every change leaves a ledger entry.
    const updates: Record<string, unknown> = {};
    for (const field of [
      'name',
      'barcode',
      'category',
      'hsn_code',
      'gst_rate',
      'cost_price',
      'supplier_id',
      'low_stock_threshold',
    ] as const) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (body.is_active !== undefined) {
      // Deactivating pulls a product off the shop floor — a stricter action.
      const { hasPermission } = await import('@/lib/auth/rbac');
      if (!body.is_active && !hasPermission(session.role, 'product.deactivate')) {
        return fail('Only an admin may deactivate a product', 403, 'FORBIDDEN');
      }
      updates.is_active = body.is_active;
    }

    if (Object.keys(updates).length === 0) {
      return fail('No changes supplied', 422, 'NO_CHANGES');
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: body.is_active === false ? 'PRODUCT_DEACTIVATED' : 'PRODUCT_UPDATED',
      entityType: 'product',
      entityId: id,
      details: `${existing.name}: ${Object.keys(updates).filter((k) => k !== 'updated_at').join(', ')} changed`,
      metadata: { changes: updates },
    });

    return ok(data);
  },
  'products/PATCH'
);
