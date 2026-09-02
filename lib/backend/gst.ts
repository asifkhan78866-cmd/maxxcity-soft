// ═══════════════════════════════════════
// GST Calculation Engine
// ═══════════════════════════════════════
// Every product at MaxxCity Mall sells for the flat price defined in
// lib/config/pricing.ts (₹99), INCLUSIVE of GST. This module back-calculates
// the taxable base and the tax components from that inclusive price.
//
// Tax rates stay per-product (5% / 12% / 18%) — never assume one rate.
// GST is split equally: CGST (50%) + SGST (50%).
//
// All arithmetic runs in integer paise (lib/money.ts) so POS totals, the
// receipt, the database and the GST reports agree exactly.

import type { GSTRate, GSTBreakdown, InvoiceGSTSummary, CartItem } from '@/types';
import { DEFAULT_GST_RATE } from '@/lib/config/pricing';
import { toPaise, toRupees, splitPaise, roundMoney, formatINR } from '@/lib/money';

export { formatINR };

/**
 * Default GST rate for a product category.
 * Used only when creating a product without an explicit rate — the stored
 * per-product rate always wins at sale time.
 */
export function getGSTRateForCategory(category: string): GSTRate {
  switch (category) {
    case 'Electronics':
      return 18;
    case 'Clothing':
    case 'Fashion':
      return 5;
    case 'Personal Care':
    case 'Care':
      return 18;
    case 'Home & Kitchen':
    case 'Kitchen':
    case 'Accessories':
    case 'Toys':
    case 'Stationery':
    case 'Seasonal':
      return 12;
    default:
      return DEFAULT_GST_RATE;
  }
}

/**
 * Back-calculate the GST breakdown of a single unit sold at an inclusive price.
 *
 *   base  = inclusive / (1 + rate/100)
 *   gst   = inclusive - base
 *   cgst  = sgst = gst / 2   (odd paisa goes to CGST)
 *
 * Computed in paise so base + gst === inclusive exactly.
 */
export function calculateGST(inclusivePrice: number, gstRate: GSTRate): GSTBreakdown {
  const inclusivePaise = toPaise(inclusivePrice);
  const basePaise = Math.round(inclusivePaise / (1 + gstRate / 100));
  const gstPaise = inclusivePaise - basePaise;
  const { first: cgstPaise, second: sgstPaise } = splitPaise(gstPaise);

  return {
    base_price: toRupees(basePaise),
    gst_rate: gstRate,
    gst_amount: toRupees(gstPaise),
    cgst: toRupees(cgstPaise),
    sgst: toRupees(sgstPaise),
    total: toRupees(inclusivePaise),
  };
}

/**
 * GST breakdown for a line of `qty` units.
 *
 * The line total is computed first (qty × inclusive price) and the tax is
 * derived from it, so the components always reconcile to the line total —
 * multiplying a pre-rounded per-unit tax would drift by a paisa on large
 * quantities.
 */
export function calculateLineGST(
  inclusivePrice: number,
  gstRate: GSTRate,
  qty: number
): {
  base_price: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  line_total: number;
} {
  const safeQty = Math.max(0, Math.trunc(qty));
  const lineTotalPaise = toPaise(inclusivePrice) * safeQty;
  const basePaise = Math.round(lineTotalPaise / (1 + gstRate / 100));
  const taxPaise = lineTotalPaise - basePaise;
  const { first: cgstPaise, second: sgstPaise } = splitPaise(taxPaise);

  return {
    base_price: toRupees(basePaise),
    tax_amount: toRupees(taxPaise),
    cgst: toRupees(cgstPaise),
    sgst: toRupees(sgstPaise),
    line_total: toRupees(lineTotalPaise),
  };
}

/** Minimal shape needed to summarise tax — satisfied by CartItem and SaleItem. */
export interface TaxableLine {
  gst_rate: GSTRate;
  base_price: number;
  cgst: number;
  sgst: number;
  tax_amount: number;
}

/**
 * Group lines by GST rate for the tax summary of a formal invoice / GST report.
 * INTERNAL + FORMAL INVOICE ONLY — never shown on a customer retail receipt.
 */
export function generateGSTSummary(items: TaxableLine[]): InvoiceGSTSummary[] {
  const rateMap = new Map<GSTRate, { taxable: number; cgst: number; sgst: number; tax: number }>();

  for (const item of items) {
    const acc = rateMap.get(item.gst_rate) ?? { taxable: 0, cgst: 0, sgst: 0, tax: 0 };
    acc.taxable += toPaise(item.base_price);
    acc.cgst += toPaise(item.cgst);
    acc.sgst += toPaise(item.sgst);
    acc.tax += toPaise(item.tax_amount);
    rateMap.set(item.gst_rate, acc);
  }

  return Array.from(rateMap.entries())
    .map(([rate, v]) => ({
      rate,
      taxable_value: toRupees(v.taxable),
      cgst: toRupees(v.cgst),
      sgst: toRupees(v.sgst),
      total_tax: toRupees(v.tax),
    }))
    .sort((a, b) => a.rate - b.rate);
}

/** Aggregate cart totals in paise, then convert once. */
export function calculateCartTotals(items: CartItem[], discount: number = 0) {
  let subtotalPaise = 0;
  let cgstPaise = 0;
  let sgstPaise = 0;
  let taxPaise = 0;
  let linesPaise = 0;
  let itemCount = 0;

  for (const item of items) {
    subtotalPaise += toPaise(item.base_price);
    cgstPaise += toPaise(item.cgst);
    sgstPaise += toPaise(item.sgst);
    taxPaise += toPaise(item.tax_amount);
    linesPaise += toPaise(item.line_total);
    itemCount += item.qty;
  }

  const discountPaise = Math.min(Math.max(0, toPaise(discount)), linesPaise);
  const grandTotalPaise = linesPaise - discountPaise;

  return {
    subtotal: toRupees(subtotalPaise),
    total_cgst: toRupees(cgstPaise),
    total_sgst: toRupees(sgstPaise),
    total_tax: toRupees(taxPaise),
    discount: toRupees(discountPaise),
    grand_total: toRupees(grandTotalPaise),
    item_count: itemCount,
    line_count: items.length,
  };
}

export { roundMoney };
