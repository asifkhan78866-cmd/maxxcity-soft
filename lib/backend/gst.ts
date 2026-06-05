// ═══════════════════════════════════════
// GST Calculation Engine
// ═══════════════════════════════════════
// All prices at MaxxCity Mall are ₹149 inclusive of GST.
// This module back-calculates the base price and tax components.
//
// Tax rates by category:
//   Electronics      → 18% GST
//   Home & Kitchen   → 12% GST
//   Clothing         →  5% GST
//   Others           → 12% GST
//
// GST is split equally: CGST (50%) + SGST (50%)

import type { GSTRate, GSTBreakdown, InvoiceGSTSummary, CartItem } from '@/types';

/**
 * Get GST rate for a product category
 */
export function getGSTRateForCategory(category: string): GSTRate {
  switch (category) {
    case 'Electronics':
      return 18;
    case 'Clothing':
      return 5;
    case 'Home & Kitchen':
      return 12;
    case 'Accessories':
      return 12;
    case 'Toys':
      return 12;
    case 'Stationery':
      return 12;
    case 'Personal Care':
      return 18;
    default:
      return 12;
  }
}

/**
 * Calculate GST breakdown from an inclusive price
 * 
 * Formula: base_price = inclusive_price / (1 + rate/100)
 *          gst_amount = inclusive_price - base_price
 *          cgst = sgst = gst_amount / 2
 */
export function calculateGST(inclusivePrice: number, gstRate: GSTRate): GSTBreakdown {
  const divisor = 1 + gstRate / 100;
  const basePrice = roundToTwo(inclusivePrice / divisor);
  const gstAmount = roundToTwo(inclusivePrice - basePrice);
  const cgst = roundToTwo(gstAmount / 2);
  const sgst = roundToTwo(gstAmount - cgst); // Handle rounding

  return {
    base_price: basePrice,
    gst_rate: gstRate,
    gst_amount: gstAmount,
    cgst,
    sgst,
    total: inclusivePrice,
  };
}

/**
 * Calculate GST for a line item (with quantity)
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
  const single = calculateGST(inclusivePrice, gstRate);
  return {
    base_price: roundToTwo(single.base_price * qty),
    tax_amount: roundToTwo(single.gst_amount * qty),
    cgst: roundToTwo(single.cgst * qty),
    sgst: roundToTwo(single.sgst * qty),
    line_total: roundToTwo(inclusivePrice * qty),
  };
}

/**
 * Generate GST summary grouped by tax rate for invoice
 */
export function generateGSTSummary(items: CartItem[]): InvoiceGSTSummary[] {
  const rateMap = new Map<GSTRate, InvoiceGSTSummary>();

  for (const item of items) {
    const existing = rateMap.get(item.gst_rate);
    if (existing) {
      existing.taxable_value = roundToTwo(existing.taxable_value + item.base_price);
      existing.cgst = roundToTwo(existing.cgst + item.cgst);
      existing.sgst = roundToTwo(existing.sgst + item.sgst);
      existing.total_tax = roundToTwo(existing.total_tax + item.tax_amount);
    } else {
      rateMap.set(item.gst_rate, {
        rate: item.gst_rate,
        taxable_value: item.base_price,
        cgst: item.cgst,
        sgst: item.sgst,
        total_tax: item.tax_amount,
      });
    }
  }

  return Array.from(rateMap.values()).sort((a, b) => a.rate - b.rate);
}

/**
 * Calculate cart totals
 */
export function calculateCartTotals(items: CartItem[]) {
  let subtotal = 0;
  let totalCGST = 0;
  let totalSGST = 0;
  let totalTax = 0;
  let grandTotal = 0;

  for (const item of items) {
    subtotal = roundToTwo(subtotal + item.base_price);
    totalCGST = roundToTwo(totalCGST + item.cgst);
    totalSGST = roundToTwo(totalSGST + item.sgst);
    totalTax = roundToTwo(totalTax + item.tax_amount);
    grandTotal = roundToTwo(grandTotal + item.line_total);
  }

  return {
    subtotal,
    total_cgst: totalCGST,
    total_sgst: totalSGST,
    total_tax: totalTax,
    grand_total: grandTotal,
    item_count: items.reduce((sum, item) => sum + item.qty, 0),
  };
}

/**
 * Format currency in Indian Rupees
 */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Round to 2 decimal places
 */
function roundToTwo(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}
