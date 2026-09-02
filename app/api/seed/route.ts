// ═══════════════════════════════════════
// Development Seed
// ═══════════════════════════════════════
// DEVELOPMENT ONLY. Demo catalogue data must never be mistaken for real
// trading data, so this route:
//   · refuses to run in production unless ALLOW_SEED=true is set deliberately
//   · requires an authenticated ADMIN
//   · marks every product it creates with the DEMO- barcode prefix, so demo
//     rows are trivially identifiable and removable
//   · creates catalogue rows only — it never fabricates sales, shifts or
//     revenue, because invented transactions would corrupt every report
//
// Opening stock is booked through adjust_stock() so even seeded inventory has
// a proper ledger history.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { DEFAULT_PRODUCT_PRICE, DEFAULT_LOW_STOCK_THRESHOLD } from '@/lib/config/pricing';
import { logActivity } from '@/lib/database/activity';
import type { ProductCategory, GSTRate } from '@/types';

interface SeedProduct {
  name: string;
  barcode: string;
  category: ProductCategory;
  hsn_code: string;
  gst_rate: GSTRate;
  stock_qty: number;
  cost_price: number;
}

/**
 * Demo catalogue. Prices are NOT listed here — every product is created at the
 * centralised flat selling price. `cost_price` is an illustrative supplier
 * cost and is a different value from the selling price by design.
 */
const DEMO_PRODUCTS: SeedProduct[] = [
  { name: 'Wireless Earbuds Pro', barcode: 'DEMO-8901234567890', category: 'Electronics', hsn_code: '8518', gst_rate: 18, stock_qty: 45, cost_price: 62 },
  { name: 'Phone Stand Holder', barcode: 'DEMO-8901234567891', category: 'Electronics', hsn_code: '8518', gst_rate: 18, stock_qty: 30, cost_price: 41 },
  { name: 'Kitchen Organizer Box', barcode: 'DEMO-8901234567892', category: 'Home & Kitchen', hsn_code: '3924', gst_rate: 12, stock_qty: 60, cost_price: 55 },
  { name: 'Stainless Steel Bottle', barcode: 'DEMO-8901234567893', category: 'Home & Kitchen', hsn_code: '7323', gst_rate: 12, stock_qty: 80, cost_price: 58 },
  { name: 'Cotton T-Shirt Basic', barcode: 'DEMO-8901234567894', category: 'Clothing', hsn_code: '6109', gst_rate: 5, stock_qty: 100, cost_price: 64 },
  { name: 'Handkerchief Set (3pc)', barcode: 'DEMO-8901234567895', category: 'Clothing', hsn_code: '6213', gst_rate: 5, stock_qty: 50, cost_price: 39 },
  { name: 'LED Desk Lamp Mini', barcode: 'DEMO-8901234567896', category: 'Electronics', hsn_code: '9405', gst_rate: 18, stock_qty: 25, cost_price: 70 },
  { name: 'Kids Toy Car Set', barcode: 'DEMO-8901234567899', category: 'Toys', hsn_code: '9503', gst_rate: 12, stock_qty: 55, cost_price: 48 },
  { name: 'Notebook A5 Pack', barcode: 'DEMO-8901234567900', category: 'Stationery', hsn_code: '4820', gst_rate: 12, stock_qty: 90, cost_price: 44 },
  { name: 'Face Wash Gel 100ml', barcode: 'DEMO-8901234567901', category: 'Personal Care', hsn_code: '3401', gst_rate: 18, stock_qty: 70, cost_price: 52 },
  { name: 'USB Type-C Cable', barcode: 'DEMO-8901234567903', category: 'Electronics', hsn_code: '8544', gst_rate: 18, stock_qty: 12, cost_price: 33 },
  { name: 'Ceramic Mug Set', barcode: 'DEMO-8901234567907', category: 'Home & Kitchen', hsn_code: '6912', gst_rate: 12, stock_qty: 8, cost_price: 60 },
];

export const POST = withPermission(
  'database.seed',
  async (_request, session) => {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
      return fail(
        'Seeding is disabled in production. Set ALLOW_SEED=true only if you genuinely intend to insert demo catalogue data.',
        403,
        'SEED_DISABLED'
      );
    }

    const supabase = createServiceRoleClient();
    const created: string[] = [];
    const skipped: string[] = [];

    for (const product of DEMO_PRODUCTS) {
      const { data: existing } = await supabase
        .from('products')
        .select('id')
        .eq('barcode', product.barcode)
        .maybeSingle();

      if (existing) {
        skipped.push(product.barcode);
        continue;
      }

      const { data, error } = await supabase
        .from('products')
        .insert({
          name: product.name,
          barcode: product.barcode,
          category: product.category,
          hsn_code: product.hsn_code,
          gst_rate: product.gst_rate,
          price: DEFAULT_PRODUCT_PRICE,
          cost_price: product.cost_price,
          stock_qty: 0,
          low_stock_threshold: DEFAULT_LOW_STOCK_THRESHOLD,
          is_active: true,
        })
        .select('id')
        .single();

      if (error) throw error;

      const { error: stockError } = await supabase.rpc('adjust_stock', {
        p_product_id: data.id,
        p_user_id: session.sub,
        p_delta: product.stock_qty,
        p_movement_type: 'OPENING_STOCK',
        p_reason: 'Demo seed opening stock',
      });
      if (stockError) throw new Error(stockError.message);

      created.push(product.barcode);
    }

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'DATABASE_SEEDED',
      details: `Seeded ${created.length} demo product(s), skipped ${skipped.length} existing`,
      metadata: { created, skipped, environment: process.env.NODE_ENV },
    });

    return ok({
      message: `Seeded ${created.length} demo product(s) at ₹${DEFAULT_PRODUCT_PRICE}. ${skipped.length} already existed.`,
      created,
      skipped,
      warning:
        'These rows carry the DEMO- barcode prefix. Delete or deactivate them before going live.',
    });
  },
  'seed'
);
