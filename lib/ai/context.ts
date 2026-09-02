// ═══════════════════════════════════════
// AI Data Context Builder
// ═══════════════════════════════════════
// Fetches real data from Supabase to inject into AI prompts

import 'server-only';

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { rows } from '@/lib/database/rows';
import type { SaleRowLite, SaleItemLite, ProductRowLite, ShiftRowLite } from './types';

// RLS now denies the anon client every business table (see migration 0002),
// so the AI context is assembled with the service-role client behind an
// authorised route handler.
function getSupabase() {
  return createServiceRoleClient();
}

export interface SalesContext {
  dailySummary30d: Array<{ date: string; revenue: number; items: number; transactions: number }>;
  topProducts20: Array<{ product_name: string; qty_sold: number; revenue: number }>;
  lowStockItems: Array<{ name: string; stock_qty: number; low_stock_threshold: number }>;
  thisWeekVsLast: { this_week: number; last_week: number; change_pct: number };
  todayHourlySales: Array<{ hour: number; revenue: number; transactions: number }>;
  todayStats: { revenue: number; transactions: number; items: number };
}

/**
 * Fetch full sales context for AI from Supabase
 */
export async function fetchSalesContext(): Promise<SalesContext> {
  const supabase = getSupabase();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Daily summary for last 30 days
  const { data: salesRaw } = await supabase
    .from('sales')
    .select('grand_total, created_at, sale_items(qty)')
    .gte('created_at', thirtyDaysAgo)
    .in('status', ['COMPLETED', 'PARTIALLY_RETURNED']);

  const sales = rows<SaleRowLite>(salesRaw);
  const dailyMap: Record<string, { revenue: number; items: number; transactions: number }> = {};
  sales.forEach((sale) => {
    const d = new Date(sale.created_at).toISOString().slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = { revenue: 0, items: 0, transactions: 0 };
    dailyMap[d].revenue += Number(sale.grand_total);
    dailyMap[d].transactions += 1;
    dailyMap[d].items += (sale.sale_items ?? []).reduce((sum, i) => sum + i.qty, 0);
  });
  const dailySummary30d = Object.entries(dailyMap)
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 2. Top 20 products by revenue this month
  const { data: saleItemsRaw } = await supabase
    .from('sale_items')
    .select('product_name, qty, line_total, sale_id, sales!inner(created_at, status)')
    .gte('sales.created_at', thirtyDaysAgo)
    .eq('sales.status', 'COMPLETED');

  const prodMap: Record<string, { product_name: string; qty_sold: number; revenue: number }> = {};
  rows<SaleItemLite>(saleItemsRaw).forEach((item) => {
    const name = item.product_name ?? 'Unknown';
    if (!prodMap[name]) prodMap[name] = { product_name: name, qty_sold: 0, revenue: 0 };
    prodMap[name].qty_sold += item.qty;
    prodMap[name].revenue += Number(item.line_total ?? 0);
  });
  const topProducts20 = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 20);

  // 3. Low stock items
  // PostgREST cannot compare two columns in a filter, so the comparison is
  // done here. (The previous `.filter('stock_qty','lte','low_stock_threshold')`
  // compared the column against the literal string and matched nothing.)
  const { data: lowStockRaw } = await supabase
    .from('products')
    .select('name, stock_qty, low_stock_threshold')
    .eq('is_active', true);
  const lowStockItems = rows<ProductRowLite>(lowStockRaw)
    .filter((p) => p.stock_qty <= p.low_stock_threshold)
    .map((p) => ({
      name: p.name,
      stock_qty: p.stock_qty,
      low_stock_threshold: p.low_stock_threshold,
    }));

  // 4. This week vs last week
  const thisWeekSales = sales.filter((s) => new Date(s.created_at) >= new Date(sevenDaysAgo));
  const thisWeekRevenue = thisWeekSales.reduce((sum, s) => sum + Number(s.grand_total), 0);

  const { data: lastWeekRaw } = await supabase
    .from('sales')
    .select('grand_total')
    .gte('created_at', fourteenDaysAgo)
    .lt('created_at', sevenDaysAgo)
    .in('status', ['COMPLETED', 'PARTIALLY_RETURNED']);
  const lastWeekRevenue = rows<{ grand_total: number | string }>(lastWeekRaw).reduce(
    (sum, s) => sum + Number(s.grand_total),
    0
  );

  const changePct = lastWeekRevenue > 0 ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100 : 0;

  // 5. Today's hourly sales
  const todaySales = sales.filter((s) => new Date(s.created_at) >= new Date(today));
  const hourlyMap: Record<number, { revenue: number; transactions: number }> = {};
  todaySales.forEach((sale) => {
    const h = new Date(sale.created_at).getHours();
    if (!hourlyMap[h]) hourlyMap[h] = { revenue: 0, transactions: 0 };
    hourlyMap[h].revenue += Number(sale.grand_total);
    hourlyMap[h].transactions += 1;
  });
  const todayHourlySales = Object.entries(hourlyMap)
    .map(([hour, v]) => ({ hour: Number(hour), ...v }))
    .sort((a, b) => a.hour - b.hour);

  const todayRevenue = todaySales.reduce((sum, s) => sum + Number(s.grand_total), 0);
  const todayItems = todaySales.reduce(
    (sum, s) => sum + (s.sale_items ?? []).reduce((inner, i) => inner + i.qty, 0),
    0
  );

  return {
    dailySummary30d,
    topProducts20,
    lowStockItems,
    thisWeekVsLast: { this_week: thisWeekRevenue, last_week: lastWeekRevenue, change_pct: Math.round(changePct * 10) / 10 },
    todayHourlySales,
    todayStats: { revenue: todayRevenue, transactions: todaySales.length, items: todayItems },
  };
}

/**
 * Fetch inventory data for the optimizer
 */
export async function fetchInventoryData() {
  const supabase = getSupabase();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // All active products
  const { data: products } = await supabase
    .from('products')
    .select('id, name, barcode, category, stock_qty, low_stock_threshold, price')
    .eq('is_active', true);

  // Sales per product in last 30 days
  const { data: saleItems } = await supabase
    .from('sale_items')
    .select('product_id, qty, sales!inner(created_at, status)')
    .gte('sales.created_at', thirtyDaysAgo)
    .eq('sales.status', 'COMPLETED');

  // Aggregate sales by product
  const salesByProduct: Record<string, number> = {};
  rows<SaleItemLite>(saleItems).forEach((item) => {
    if (!item.product_id) return;
    salesByProduct[item.product_id] = (salesByProduct[item.product_id] ?? 0) + item.qty;
  });

  return { products: rows<ProductRowLite>(products), salesByProduct };
}

/**
 * Fetch shift data for anomaly detection
 */
export async function fetchShiftAnomalyData(shiftId?: string) {
  const supabase = getSupabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Recent shifts
  const shiftQuery = supabase.from('shifts').select('*').gte('created_at', sevenDaysAgo).order('created_at', { ascending: false });
  if (shiftId) shiftQuery.eq('id', shiftId);
  const { data: shifts } = await shiftQuery.limit(10);

  // Sales for those shifts
  const shiftRows = rows<ShiftRowLite>(shifts);
  const shiftIds = shiftRows.map((s) => s.id);
  const { data: sales } = await supabase
    .from('sales')
    .select('*, sale_items(*)')
    .in('shift_id', shiftIds.length > 0 ? shiftIds : ['none']);

  // Historical hourly averages (last 4 weeks)
  const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString();
  const { data: historicalSales } = await supabase
    .from('sales')
    .select('grand_total, created_at')
    .gte('created_at', fourWeeksAgo)
    .in('status', ['COMPLETED', 'PARTIALLY_RETURNED']);

  return {
    shifts: shiftRows,
    sales: rows<SaleRowLite>(sales),
    historicalSales: rows<{ grand_total: number | string }>(historicalSales),
  };
}
