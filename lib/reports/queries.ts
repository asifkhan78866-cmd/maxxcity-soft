// ═══════════════════════════════════════
// Reporting Queries
// ═══════════════════════════════════════
// Every figure the dashboard and the reports page display is derived here
// from real `sales`, `sale_items`, `shifts`, `returns` and `products` rows.
// There are no seeded percentages, no invented baselines and no demo data.
//
// Where a number cannot be computed from real data (for example gross margin
// when supplier costs have not been captured yet), the report says so rather
// than substituting an estimate.

import 'server-only';

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { toPaise, toRupees } from '@/lib/money';
import { type DateRange, previousPeriod, percentChange } from './period';

interface SaleRow {
  id: string;
  grand_total: number;
  subtotal: number;
  total_cgst: number;
  total_sgst: number;
  total_items: number;
  payment_method: string;
  status: string;
  cashier_id: string;
  created_at: string;
}

const COMPLETED_STATUSES = ['COMPLETED', 'PARTIALLY_RETURNED'];

async function fetchSales(range: DateRange): Promise<SaleRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('sales')
    .select(
      'id, grand_total, subtotal, total_cgst, total_sgst, total_items, payment_method, status, cashier_id, created_at'
    )
    .gte('created_at', range.from.toISOString())
    .lte('created_at', range.to.toISOString())
    .in('status', COMPLETED_STATUSES);

  if (error) throw error;
  return (data ?? []) as SaleRow[];
}

function totalRevenue(sales: SaleRow[]): number {
  return toRupees(sales.reduce((sum, s) => sum + toPaise(Number(s.grand_total)), 0));
}

// ─── Headline KPIs ───

export interface KPIs {
  revenue: number;
  transactions: number;
  itemsSold: number;
  avgBasket: number;
  revenueChange: number;
  transactionsChange: number;
  itemsChange: number;
  basketChange: number;
}

export async function getKPIs(range: DateRange): Promise<KPIs> {
  const [current, previous] = await Promise.all([
    fetchSales(range),
    fetchSales(previousPeriod(range)),
  ]);

  const revenue = totalRevenue(current);
  const prevRevenue = totalRevenue(previous);
  const items = current.reduce((sum, s) => sum + s.total_items, 0);
  const prevItems = previous.reduce((sum, s) => sum + s.total_items, 0);
  const avgBasket = current.length > 0 ? toRupees(toPaise(revenue) / current.length) : 0;
  const prevBasket = previous.length > 0 ? toRupees(toPaise(prevRevenue) / previous.length) : 0;

  return {
    revenue,
    transactions: current.length,
    itemsSold: items,
    avgBasket,
    revenueChange: percentChange(revenue, prevRevenue),
    transactionsChange: percentChange(current.length, previous.length),
    itemsChange: percentChange(items, prevItems),
    basketChange: percentChange(avgBasket, prevBasket),
  };
}

// ─── Time series ───

export async function getHourlySales(range: DateRange) {
  const sales = await fetchSales(range);
  const buckets = new Map<number, { revenue: number; transactions: number }>();

  for (let h = 0; h < 24; h++) buckets.set(h, { revenue: 0, transactions: 0 });

  for (const sale of sales) {
    const hour = new Date(sale.created_at).getHours();
    const bucket = buckets.get(hour)!;
    bucket.revenue = toRupees(toPaise(bucket.revenue) + toPaise(Number(sale.grand_total)));
    bucket.transactions += 1;
  }

  // Trim to hours the store actually traded in, plus the standard 9–21 window,
  // so an empty morning does not stretch the axis pointlessly.
  const active = Array.from(buckets.entries()).filter(
    ([hour, v]) => v.transactions > 0 || (hour >= 9 && hour <= 21)
  );

  return active.map(([hour, v]) => ({
    hour,
    label: `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'AM' : 'PM'}`,
    revenue: v.revenue,
    transactions: v.transactions,
  }));
}

export async function getDailySales(range: DateRange) {
  const sales = await fetchSales(range);
  const byDay = new Map<string, { revenue: number; transactions: number; items: number }>();

  for (const sale of sales) {
    const day = new Date(sale.created_at).toISOString().slice(0, 10);
    const entry = byDay.get(day) ?? { revenue: 0, transactions: 0, items: 0 };
    entry.revenue = toRupees(toPaise(entry.revenue) + toPaise(Number(sale.grand_total)));
    entry.transactions += 1;
    entry.items += sale.total_items;
    byDay.set(day, entry);
  }

  return Array.from(byDay.entries())
    .map(([date, v]) => ({
      date,
      dayName: new Date(date).toLocaleDateString('en-IN', { weekday: 'short' }),
      ...v,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Real day-of-week pattern — the average actually observed, not a multiplier. */
export async function getWeekdayPattern(range: DateRange) {
  const daily = await getDailySales(range);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDow = new Map<number, number[]>();

  for (const day of daily) {
    const dow = new Date(day.date).getDay();
    byDow.set(dow, [...(byDow.get(dow) ?? []), day.revenue]);
  }

  return [1, 2, 3, 4, 5, 6, 0].map((dow) => {
    const values = byDow.get(dow) ?? [];
    const avg =
      values.length > 0
        ? toRupees(values.reduce((s, v) => s + toPaise(v), 0) / values.length)
        : 0;
    return {
      day: names[dow],
      dayOfWeek: dow,
      averageRevenue: avg,
      sampleDays: values.length,
      isShandy: dow === 4, // Thursday — Adilabad shandy market day
      isPeak: dow === 0, // Sunday
    };
  });
}

// ─── Products & categories ───

export async function getTopProducts(range: DateRange, limit = 10) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('sale_items')
    .select(
      'product_id, product_name, qty, qty_returned, line_total, line_discount, sales!inner(created_at, status)'
    )
    .gte('sales.created_at', range.from.toISOString())
    .lte('sales.created_at', range.to.toISOString())
    .in('sales.status', COMPLETED_STATUSES);

  if (error) throw error;

  const byProduct = new Map<string, { product_id: string; product_name: string; qty: number; revenue: number }>();

  for (const row of data ?? []) {
    const item = row as unknown as {
      product_id: string;
      product_name: string;
      qty: number;
      qty_returned: number;
      line_total: number;
      line_discount: number;
    };
    // Net of anything the customer brought back.
    const netQty = item.qty - (item.qty_returned ?? 0);
    if (netQty <= 0) continue;

    const lineNet = toPaise(Number(item.line_total) - Number(item.line_discount ?? 0));
    const netRevenue = Math.round((lineNet * netQty) / item.qty);

    const entry = byProduct.get(item.product_id) ?? {
      product_id: item.product_id,
      product_name: item.product_name,
      qty: 0,
      revenue: 0,
    };
    entry.qty += netQty;
    entry.revenue = toRupees(toPaise(entry.revenue) + netRevenue);
    byProduct.set(item.product_id, entry);
  }

  return Array.from(byProduct.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export async function getCategoryBreakdown(range: DateRange) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('sale_items')
    .select(
      'qty, qty_returned, line_total, line_discount, products!inner(category), sales!inner(created_at, status)'
    )
    .gte('sales.created_at', range.from.toISOString())
    .lte('sales.created_at', range.to.toISOString())
    .in('sales.status', COMPLETED_STATUSES);

  if (error) throw error;

  const byCategory = new Map<string, { revenue: number; qty: number }>();

  for (const row of data ?? []) {
    const item = row as unknown as {
      qty: number;
      qty_returned: number;
      line_total: number;
      line_discount: number;
      products: { category: string } | null;
    };
    const category = item.products?.category ?? 'Others';
    const netQty = item.qty - (item.qty_returned ?? 0);
    if (netQty <= 0) continue;

    const lineNet = toPaise(Number(item.line_total) - Number(item.line_discount ?? 0));
    const entry = byCategory.get(category) ?? { revenue: 0, qty: 0 };
    entry.revenue = toRupees(toPaise(entry.revenue) + Math.round((lineNet * netQty) / item.qty));
    entry.qty += netQty;
    byCategory.set(category, entry);
  }

  return Array.from(byCategory.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ─── Payments & tax ───

export async function getPaymentBreakdown(range: DateRange) {
  const sales = await fetchSales(range);
  const total = toPaise(totalRevenue(sales));
  const byMethod = new Map<string, { amount: number; count: number }>([
    ['CASH', { amount: 0, count: 0 }],
    ['UPI', { amount: 0, count: 0 }],
    ['CARD', { amount: 0, count: 0 }],
  ]);

  for (const sale of sales) {
    const entry = byMethod.get(sale.payment_method) ?? { amount: 0, count: 0 };
    entry.amount = toRupees(toPaise(entry.amount) + toPaise(Number(sale.grand_total)));
    entry.count += 1;
    byMethod.set(sale.payment_method, entry);
  }

  return Array.from(byMethod.entries()).map(([method, v]) => ({
    method,
    amount: v.amount,
    count: v.count,
    percentage: total > 0 ? Math.round((toPaise(v.amount) / total) * 1000) / 10 : 0,
  }));
}

export async function getGSTSummary(range: DateRange) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('sale_items')
    .select('gst_rate, base_price, cgst, sgst, tax_amount, sales!inner(created_at, status)')
    .gte('sales.created_at', range.from.toISOString())
    .lte('sales.created_at', range.to.toISOString())
    .in('sales.status', COMPLETED_STATUSES);

  if (error) throw error;

  const byRate = new Map<number, { taxable: number; cgst: number; sgst: number; tax: number }>();

  for (const row of data ?? []) {
    const item = row as unknown as {
      gst_rate: number;
      base_price: number;
      cgst: number;
      sgst: number;
      tax_amount: number;
    };
    const entry = byRate.get(item.gst_rate) ?? { taxable: 0, cgst: 0, sgst: 0, tax: 0 };
    entry.taxable += toPaise(Number(item.base_price));
    entry.cgst += toPaise(Number(item.cgst));
    entry.sgst += toPaise(Number(item.sgst));
    entry.tax += toPaise(Number(item.tax_amount));
    byRate.set(item.gst_rate, entry);
  }

  return Array.from(byRate.entries())
    .map(([rate, v]) => ({
      rate,
      taxableValue: toRupees(v.taxable),
      cgst: toRupees(v.cgst),
      sgst: toRupees(v.sgst),
      totalTax: toRupees(v.tax),
    }))
    .sort((a, b) => a.rate - b.rate);
}

// ─── Cashier performance ───

export interface CashierPerformance {
  cashierId: string;
  cashierName: string;
  transactions: number;
  itemsSold: number;
  revenue: number;
  avgBasket: number;
  cashSales: number;
  upiSales: number;
  cardSales: number;
  voids: number;
  returns: number;
  shiftVariance: number;
  shiftsWorked: number;
}

export async function getCashierPerformance(range: DateRange): Promise<CashierPerformance[]> {
  const supabase = createServiceRoleClient();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [salesRes, staffRes, shiftsRes, returnsRes] = await Promise.all([
    supabase
      .from('sales')
      .select('cashier_id, grand_total, total_items, payment_method, status')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase.from('profiles').select('id, name'),
    supabase
      .from('shifts')
      .select('cashier_id, discrepancy, status')
      .gte('opened_at', fromIso)
      .lte('opened_at', toIso),
    supabase
      .from('returns')
      .select('processed_by, refund_amount')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
  ]);

  if (salesRes.error) throw salesRes.error;

  const names = new Map((staffRes.data ?? []).map((p) => [p.id, p.name]));
  const stats = new Map<string, CashierPerformance>();

  const ensure = (id: string): CashierPerformance => {
    if (!stats.has(id)) {
      stats.set(id, {
        cashierId: id,
        cashierName: names.get(id) ?? 'Unknown',
        transactions: 0,
        itemsSold: 0,
        revenue: 0,
        avgBasket: 0,
        cashSales: 0,
        upiSales: 0,
        cardSales: 0,
        voids: 0,
        returns: 0,
        shiftVariance: 0,
        shiftsWorked: 0,
      });
    }
    return stats.get(id)!;
  };

  for (const sale of salesRes.data ?? []) {
    const entry = ensure(sale.cashier_id);
    if (sale.status === 'VOID') {
      entry.voids += 1;
      continue;
    }
    const amount = toPaise(Number(sale.grand_total));
    entry.transactions += 1;
    entry.itemsSold += sale.total_items ?? 0;
    entry.revenue = toRupees(toPaise(entry.revenue) + amount);
    if (sale.payment_method === 'CASH') entry.cashSales = toRupees(toPaise(entry.cashSales) + amount);
    if (sale.payment_method === 'UPI') entry.upiSales = toRupees(toPaise(entry.upiSales) + amount);
    if (sale.payment_method === 'CARD') entry.cardSales = toRupees(toPaise(entry.cardSales) + amount);
  }

  for (const shift of shiftsRes.data ?? []) {
    const entry = ensure(shift.cashier_id);
    entry.shiftsWorked += 1;
    if (shift.status === 'CLOSED' && shift.discrepancy != null) {
      entry.shiftVariance = toRupees(toPaise(entry.shiftVariance) + toPaise(Number(shift.discrepancy)));
    }
  }

  for (const ret of returnsRes.data ?? []) {
    if (!ret.processed_by) continue;
    ensure(ret.processed_by).returns += 1;
  }

  return Array.from(stats.values())
    .map((s) => ({
      ...s,
      avgBasket: s.transactions > 0 ? toRupees(toPaise(s.revenue) / s.transactions) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ─── Inventory & margin ───

export async function getInventorySummary() {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('products')
    .select('id, name, barcode, category, stock_qty, low_stock_threshold, price, cost_price, is_active');

  if (error) throw error;

  const products = data ?? [];
  const active = products.filter((p) => p.is_active);
  const totalUnits = active.reduce((sum, p) => sum + p.stock_qty, 0);

  // Retail value uses the actual selling price on each row (which the pricing
  // rule keeps at the flat price); cost value only counts rows where a real
  // supplier cost has been captured.
  const retailValue = toRupees(
    active.reduce((sum, p) => sum + toPaise(Number(p.price)) * p.stock_qty, 0)
  );
  const withCost = active.filter((p) => p.cost_price != null);
  const costValue = toRupees(
    withCost.reduce((sum, p) => sum + toPaise(Number(p.cost_price)) * p.stock_qty, 0)
  );

  const lowStock = active
    .filter((p) => p.stock_qty <= p.low_stock_threshold)
    .sort((a, b) => a.stock_qty - b.stock_qty);

  return {
    totalSkus: active.length,
    inactiveSkus: products.length - active.length,
    totalUnits,
    retailValue,
    costValue,
    costCoverage: active.length > 0 ? Math.round((withCost.length / active.length) * 100) : 0,
    lowStockCount: lowStock.length,
    outOfStockCount: active.filter((p) => p.stock_qty <= 0).length,
    lowStockItems: lowStock.slice(0, 25),
  };
}

/**
 * Gross margin.
 *
 * Only lines whose product had a recorded cost at the time of sale are
 * included. `coveragePct` says how much of the revenue that represents, so
 * the number is never presented as if it covered the whole business when it
 * does not.
 */
export async function getMarginReport(range: DateRange) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('sale_items')
    .select('qty, qty_returned, line_total, line_discount, cost_price, sales!inner(created_at, status)')
    .gte('sales.created_at', range.from.toISOString())
    .lte('sales.created_at', range.to.toISOString())
    .in('sales.status', COMPLETED_STATUSES);

  if (error) throw error;

  let revenueWithCost = 0;
  let revenueTotal = 0;
  let cost = 0;
  let linesWithCost = 0;
  let linesTotal = 0;

  for (const row of data ?? []) {
    const item = row as unknown as {
      qty: number;
      qty_returned: number;
      line_total: number;
      line_discount: number;
      cost_price: number | null;
    };
    const netQty = item.qty - (item.qty_returned ?? 0);
    if (netQty <= 0) continue;

    const lineNet = toPaise(Number(item.line_total) - Number(item.line_discount ?? 0));
    const netRevenue = Math.round((lineNet * netQty) / item.qty);

    linesTotal += 1;
    revenueTotal += netRevenue;

    if (item.cost_price != null) {
      linesWithCost += 1;
      revenueWithCost += netRevenue;
      cost += toPaise(Number(item.cost_price)) * netQty;
    }
  }

  const grossMargin = revenueWithCost - cost;

  return {
    revenueTotal: toRupees(revenueTotal),
    revenueWithCost: toRupees(revenueWithCost),
    costOfGoods: toRupees(cost),
    grossMargin: toRupees(grossMargin),
    grossMarginPct:
      revenueWithCost > 0 ? Math.round((grossMargin / revenueWithCost) * 1000) / 10 : null,
    coveragePct: revenueTotal > 0 ? Math.round((revenueWithCost / revenueTotal) * 100) : 0,
    linesWithCost,
    linesTotal,
    // Made explicit so the UI never presents a partial figure as complete.
    isComplete: linesTotal > 0 && linesWithCost === linesTotal,
  };
}

export async function getVoidsAndReturns(range: DateRange) {
  const supabase = createServiceRoleClient();
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const [voidsRes, returnsRes] = await Promise.all([
    supabase
      .from('sales')
      .select('id, invoice_number, grand_total, void_reason, voided_at, profiles!sales_voided_by_fkey(name)')
      .eq('status', 'VOID')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
    supabase
      .from('returns')
      .select('id, return_number, refund_amount, reason, created_at, total_items')
      .gte('created_at', fromIso)
      .lte('created_at', toIso),
  ]);

  if (voidsRes.error) throw voidsRes.error;
  if (returnsRes.error) throw returnsRes.error;

  return {
    voids: voidsRes.data ?? [],
    voidCount: (voidsRes.data ?? []).length,
    voidValue: toRupees(
      (voidsRes.data ?? []).reduce((s, v) => s + toPaise(Number(v.grand_total)), 0)
    ),
    returns: returnsRes.data ?? [],
    returnCount: (returnsRes.data ?? []).length,
    refundValue: toRupees(
      (returnsRes.data ?? []).reduce((s, r) => s + toPaise(Number(r.refund_amount)), 0)
    ),
  };
}
