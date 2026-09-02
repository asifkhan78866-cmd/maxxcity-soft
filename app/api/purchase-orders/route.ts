// ═══════════════════════════════════════
// Purchase Orders
// ═══════════════════════════════════════
// Procurement uses SUPPLIER COST, which is an entirely separate value from
// the ₹99 customer selling price. Receiving stock raises inventory through
// the stock ledger (see /api/purchase-orders/[id]/receive).

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { createPurchaseOrderSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';
import { sumMoney, roundMoney } from '@/lib/money';

export const GET = withPermission(
  'purchase.read',
  async (request) => {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const supabase = createServiceRoleClient();
    let builder = supabase
      .from('purchase_orders')
      .select('*, purchase_order_items(*), suppliers(name, phone)')
      .order('created_at', { ascending: false })
      .limit(200);

    if (status) builder = builder.eq('status', status);

    const { data, error } = await builder;
    if (error) throw error;
    return ok(data ?? []);
  },
  'purchase-orders/GET'
);

export const POST = withPermission(
  'purchase.manage',
  async (request, session) => {
    const body = parseOrThrow(createPurchaseOrderSchema, await request.json());
    const supabase = createServiceRoleClient();

    const productIds = body.items.map((i) => i.product_id);
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, name, barcode')
      .in('id', productIds);

    if (productError) throw productError;

    const byId = new Map((products ?? []).map((p) => [p.id, p]));
    const missing = productIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return fail(`Unknown product(s) on the order: ${missing.join(', ')}`, 422, 'PRODUCT_NOT_FOUND');
    }

    const totalCost = sumMoney(body.items.map((i) => i.unit_cost * i.qty_ordered));
    const poNumber = `PO/${new Date().getFullYear()}/${Date.now().toString(36).toUpperCase()}`;

    const { data: po, error } = await supabase
      .from('purchase_orders')
      .insert({
        po_number: poNumber,
        supplier_id: body.supplier_id,
        status: 'ORDERED',
        items: [], // legacy JSONB column, superseded by purchase_order_items
        notes: body.notes ?? null,
        expected_at: body.expected_at ?? null,
        total_cost: totalCost,
        created_by: session.sub,
      })
      .select('*')
      .single();

    if (error) throw error;

    const { error: itemsError } = await supabase.from('purchase_order_items').insert(
      body.items.map((item) => {
        const product = byId.get(item.product_id)!;
        return {
          purchase_order_id: po.id,
          product_id: item.product_id,
          product_name: product.name,
          barcode: product.barcode,
          qty_ordered: item.qty_ordered,
          qty_received: 0,
          unit_cost: item.unit_cost,
          line_cost: roundMoney(item.unit_cost * item.qty_ordered),
        };
      })
    );

    if (itemsError) {
      // Without the lines the header is meaningless — roll it back rather than
      // leaving an empty order behind.
      await supabase.from('purchase_orders').delete().eq('id', po.id);
      throw itemsError;
    }

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'PURCHASE_ORDER_CREATED',
      entityType: 'purchase_order',
      entityId: po.id,
      details: `${poNumber} — ${body.items.length} line(s), ₹${totalCost.toFixed(2)} at cost`,
      metadata: { po_number: poNumber, total_cost: totalCost },
    });

    return ok({ ...po, purchase_order_items: body.items }, 201);
  },
  'purchase-orders/POST'
);
