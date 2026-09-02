// ═══════════════════════════════════════
// Products API
// ═══════════════════════════════════════
// GET  — catalogue for the POS and the inventory screen
// POST — create a product (MANAGER / ADMIN)
//
// The selling price is never accepted from the client: it is always the
// centralised flat price. `cost_price` is a separate supplier cost and IS
// accepted, because it is real business data with no bearing on what the
// customer pays.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { requireAuth, withPermission, ok, fail, handleApiError } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import { createProductSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';
import { rows, row } from '@/lib/database/rows';
import type { Product } from '@/types';

const POS_FIELDS =
  'id, name, barcode, category, hsn_code, gst_rate, price, stock_qty, low_stock_threshold, is_active, created_at, updated_at';

const ADMIN_FIELDS = `${POS_FIELDS}, cost_price, supplier_id, allow_negative_stock`;

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const url = new URL(request.url);

    const search = url.searchParams.get('search')?.trim() ?? '';
    const category = url.searchParams.get('category') ?? '';
    const lowStockOnly = url.searchParams.get('low_stock') === 'true';
    const includeInactive = url.searchParams.get('include_inactive') === 'true';
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 5000);

    const supabase = createServiceRoleClient();
    // Cost price is commercially sensitive — only roles that manage inventory
    // receive it.
    const fields = hasPermission(session.role, 'inventory.adjust') ? ADMIN_FIELDS : POS_FIELDS;

    let builder = supabase.from('products').select(fields).order('name');

    if (!includeInactive || !hasPermission(session.role, 'inventory.adjust')) {
      builder = builder.eq('is_active', true);
    }
    if (category && category !== 'All') builder = builder.eq('category', category);
    if (search) {
      // Escape the PostgREST `or` delimiters so a search term cannot alter
      // the filter expression.
      const safe = search.replace(/[,()]/g, ' ');
      builder = builder.or(`name.ilike.%${safe}%,barcode.ilike.%${safe}%`);
    }

    const { data, error } = await builder.limit(limit);
    if (error) throw error;

    const products = rows<Product>(data);
    // Compared here rather than in the query: PostgREST cannot filter one
    // column against another.
    const filtered = lowStockOnly
      ? products.filter((p) => p.stock_qty <= p.low_stock_threshold)
      : products;

    return ok(filtered);
  } catch (error) {
    return handleApiError(error, 'products/GET');
  }
}

export const POST = withPermission(
  'product.create',
  async (request, session) => {
    const body = parseOrThrow(createProductSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data: clash } = await supabase
      .from('products')
      .select('id, name')
      .eq('barcode', body.barcode)
      .maybeSingle();

    if (clash) {
      return fail(
        `Barcode ${body.barcode} already belongs to "${clash.name}".`,
        409,
        'DUPLICATE_BARCODE'
      );
    }

    const { data: inserted, error } = await supabase
      .from('products')
      .insert({
        name: body.name,
        barcode: body.barcode,
        category: body.category,
        hsn_code: body.hsn_code ?? '',
        gst_rate: body.gst_rate,
        // Authoritative — the client cannot set it.
        price: DEFAULT_PRODUCT_PRICE,
        cost_price: body.cost_price ?? null,
        supplier_id: body.supplier_id ?? null,
        stock_qty: 0,
        low_stock_threshold: body.low_stock_threshold,
        is_active: body.is_active,
      })
      .select(ADMIN_FIELDS)
      .single();

    if (error) throw error;

    const data = row<Product>(inserted)!;

    // Opening stock goes in through the ledger so the product's history starts
    // with a movement rather than an unexplained balance.
    if (body.stock_qty > 0) {
      const { error: stockError } = await supabase.rpc('adjust_stock', {
        p_product_id: data.id,
        p_user_id: session.sub,
        p_delta: body.stock_qty,
        p_movement_type: 'OPENING_STOCK',
        p_reason: 'Opening stock on product creation',
      });
      if (stockError) throw new Error(stockError.message);
      data.stock_qty = body.stock_qty;
    }

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'PRODUCT_CREATED',
      entityType: 'product',
      entityId: data.id,
      details: `${body.name} (${body.barcode}) at ₹${DEFAULT_PRODUCT_PRICE}, GST ${body.gst_rate}%`,
      metadata: { barcode: body.barcode, gst_rate: body.gst_rate, opening_stock: body.stock_qty },
    });

    return ok(data, 201);
  },
  'products/POST'
);
