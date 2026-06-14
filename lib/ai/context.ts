// ═══════════════════════════════════════
// AI Data Context Builder
// ═══════════════════════════════════════
// Fetches real data from Supabase to inject into AI prompts

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );
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
  const supabase = await getSupabase();
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
    .eq('status', 'COMPLETED');

  const dailyMap: Record<string, { revenue: number; items: number; transactions: number }> = {};
  (salesRaw || []).forEach((s: any) => {
    const d = new Date(s.created_at).toISOString().slice(0, 10);
    if (!dailyMap[d]) dailyMap[d] = { revenue: 0, items: 0, transactions: 0 };
    dailyMap[d].revenue += Number(s.grand_total);
    dailyMap[d].transactions += 1;
    dailyMap[d].items += (s.sale_items || []).reduce((sum: number, i: any) => sum + i.qty, 0);
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
  (saleItemsRaw || []).forEach((i: any) => {
    if (!prodMap[i.product_name]) prodMap[i.product_name] = { product_name: i.product_name, qty_sold: 0, revenue: 0 };
    prodMap[i.product_name].qty_sold += i.qty;
    prodMap[i.product_name].revenue += Number(i.line_total);
  });
  const topProducts20 = Object.values(prodMap).sort((a, b) => b.revenue - a.revenue).slice(0, 20);

  // 3. Low stock items
  const { data: lowStockRaw } = await supabase
    .from('products')
    .select('name, stock_qty, low_stock_threshold')
    .eq('is_active', true)
    .filter('stock_qty', 'lte', 'low_stock_threshold');
  const lowStockItems = (lowStockRaw || []).map((p: any) => ({
    name: p.name,
    stock_qty: p.stock_qty,
    low_stock_threshold: p.low_stock_threshold,
  }));

  // 4. This week vs last week
  const thisWeekSales = (salesRaw || []).filter((s: any) => new Date(s.created_at) >= new Date(sevenDaysAgo));
  const thisWeekRevenue = thisWeekSales.reduce((sum: number, s: any) => sum + Number(s.grand_total), 0);

  const { data: lastWeekRaw } = await supabase
    .from('sales')
    .select('grand_total')
    .gte('created_at', fourteenDaysAgo)
    .lt('created_at', sevenDaysAgo)
    .eq('status', 'COMPLETED');
  const lastWeekRevenue = (lastWeekRaw || []).reduce((sum: number, s: any) => sum + Number(s.grand_total), 0);

  const changePct = lastWeekRevenue > 0 ? ((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100 : 0;

  // 5. Today's hourly sales
  const todaySales = (salesRaw || []).filter((s: any) => new Date(s.created_at) >= new Date(today));
  const hourlyMap: Record<number, { revenue: number; transactions: number }> = {};
  todaySales.forEach((s: any) => {
    const h = new Date(s.created_at).getHours();
    if (!hourlyMap[h]) hourlyMap[h] = { revenue: 0, transactions: 0 };
    hourlyMap[h].revenue += Number(s.grand_total);
    hourlyMap[h].transactions += 1;
  });
  const todayHourlySales = Object.entries(hourlyMap)
    .map(([hour, v]) => ({ hour: Number(hour), ...v }))
    .sort((a, b) => a.hour - b.hour);

  const todayRevenue = todaySales.reduce((sum: number, s: any) => sum + Number(s.grand_total), 0);
  const todayItems = todaySales.reduce((sum: number, s: any) =>
    sum + (s.sale_items || []).reduce((is: number, i: any) => is + i.qty, 0), 0);

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
  const supabase = await getSupabase();
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
  (saleItems || []).forEach((i: any) => {
    salesByProduct[i.product_id] = (salesByProduct[i.product_id] || 0) + i.qty;
  });

  return { products: products || [], salesByProduct };
}

/**
 * Fetch shift data for anomaly detection
 */
export async function fetchShiftAnomalyData(shiftId?: string) {
  const supabase = await getSupabase();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Recent shifts
  const shiftQuery = supabase.from('shifts').select('*').gte('created_at', sevenDaysAgo).order('created_at', { ascending: false });
  if (shiftId) shiftQuery.eq('id', shiftId);
  const { data: shifts } = await shiftQuery.limit(10);

  // Sales for those shifts
  const shiftIds = (shifts || []).map((s: any) => s.id);
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
    .eq('status', 'COMPLETED');

  return { shifts: shifts || [], sales: sales || [], historicalSales: historicalSales || [] };
}
