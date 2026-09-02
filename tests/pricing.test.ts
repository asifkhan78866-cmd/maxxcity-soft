// ═══════════════════════════════════════
// Pricing & GST
// ═══════════════════════════════════════
// Guards the two rules that matter most: every product sells at ₹99, and the
// tax split always reconciles exactly to the amount charged.

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRODUCT_PRICE,
  resolveSellingPrice,
  isValidSellingPrice,
  isValidGSTRate,
  EMI_BOOKING_FEE,
} from '@/lib/config/pricing';
import {
  calculateGST,
  calculateLineGST,
  calculateCartTotals,
  generateGSTSummary,
  getGSTRateForCategory,
} from '@/lib/backend/gst';
import { toPaise, roundMoney, sumMoney, splitPaise } from '@/lib/money';
import type { CartItem, GSTRate } from '@/types';

const RETIRED_PRICE = 149;

function cartItem(overrides: Partial<CartItem> & { gst_rate: GSTRate; qty: number }): CartItem {
  const line = calculateLineGST(DEFAULT_PRODUCT_PRICE, overrides.gst_rate, overrides.qty);
  return {
    id: 'line-1',
    product_id: 'p1',
    product_name: 'Test Product',
    barcode: '999',
    hsn_code: '1234',
    category: 'Others',
    unit_price: DEFAULT_PRODUCT_PRICE,
    stock_qty: 100,
    ...line,
    ...overrides,
  } as CartItem;
}

describe('flat selling price', () => {
  it('is ₹99', () => {
    expect(DEFAULT_PRODUCT_PRICE).toBe(99);
  });

  it('is never the retired ₹149 price', () => {
    expect(DEFAULT_PRODUCT_PRICE).not.toBe(RETIRED_PRICE);
    expect(isValidSellingPrice(RETIRED_PRICE)).toBe(false);
  });

  it('overrides any price a product row happens to carry', () => {
    // Even if a stale ₹149 row survived migration, the resolved price is ₹99.
    expect(resolveSellingPrice(RETIRED_PRICE)).toBe(99);
    expect(resolveSellingPrice(1)).toBe(99);
    expect(resolveSellingPrice(null)).toBe(99);
    expect(resolveSellingPrice(undefined)).toBe(99);
  });

  it('keeps the EMI booking fee independent of the product price', () => {
    expect(EMI_BOOKING_FEE).not.toBe(DEFAULT_PRODUCT_PRICE);
  });

  it('accepts only the three supported GST rates', () => {
    expect(isValidGSTRate(5)).toBe(true);
    expect(isValidGSTRate(12)).toBe(true);
    expect(isValidGSTRate(18)).toBe(true);
    expect(isValidGSTRate(0)).toBe(false);
    expect(isValidGSTRate(28)).toBe(false);
    expect(isValidGSTRate('12')).toBe(false);
  });
});

describe('GST back-calculation from the inclusive ₹99 price', () => {
  it.each([5, 12, 18] as const)('reconciles exactly at %i%%', (rate) => {
    const gst = calculateGST(DEFAULT_PRODUCT_PRICE, rate);

    // base + tax must equal the price charged, to the paisa.
    expect(toPaise(gst.base_price) + toPaise(gst.gst_amount)).toBe(
      toPaise(DEFAULT_PRODUCT_PRICE)
    );
    // CGST + SGST must equal the total tax.
    expect(toPaise(gst.cgst) + toPaise(gst.sgst)).toBe(toPaise(gst.gst_amount));
    expect(gst.total).toBe(DEFAULT_PRODUCT_PRICE);
  });

  it('computes the expected base at 12%', () => {
    const gst = calculateGST(99, 12);
    // 99 / 1.12 = 88.392857… → 88.39
    expect(gst.base_price).toBe(88.39);
    expect(gst.gst_amount).toBe(10.61);
  });

  it('computes the expected base at 18%', () => {
    const gst = calculateGST(99, 18);
    // 99 / 1.18 = 83.898305… → 83.90
    expect(gst.base_price).toBe(83.9);
    expect(gst.gst_amount).toBe(15.1);
  });

  it('computes the expected base at 5%', () => {
    const gst = calculateGST(99, 5);
    // 99 / 1.05 = 94.285714… → 94.29
    expect(gst.base_price).toBe(94.29);
    expect(gst.gst_amount).toBe(4.71);
  });

  it('gives the odd paisa to CGST so the halves always sum to the whole', () => {
    const { first, second } = splitPaise(1061); // ₹10.61 of tax
    expect(first + second).toBe(1061);
    expect(first).toBe(531);
    expect(second).toBe(530);
  });
});

describe('line totals', () => {
  it.each([1, 2, 7, 13, 100])('reconciles for a quantity of %i', (qty) => {
    for (const rate of [5, 12, 18] as const) {
      const line = calculateLineGST(DEFAULT_PRODUCT_PRICE, rate, qty);

      expect(line.line_total).toBe(roundMoney(DEFAULT_PRODUCT_PRICE * qty));
      expect(toPaise(line.base_price) + toPaise(line.tax_amount)).toBe(toPaise(line.line_total));
      expect(toPaise(line.cgst) + toPaise(line.sgst)).toBe(toPaise(line.tax_amount));
    }
  });

  it('does not drift on large quantities', () => {
    // Multiplying a pre-rounded per-unit tax would drift here; deriving the
    // tax from the line total does not.
    const line = calculateLineGST(99, 18, 999);
    expect(line.line_total).toBe(98901);
    expect(toPaise(line.base_price) + toPaise(line.tax_amount)).toBe(toPaise(98901));
  });

  it('treats a zero or negative quantity as zero', () => {
    expect(calculateLineGST(99, 12, 0).line_total).toBe(0);
    expect(calculateLineGST(99, 12, -3).line_total).toBe(0);
  });
});

describe('cart totals', () => {
  it('gives ₹99 for a single product — the acceptance criterion', () => {
    const totals = calculateCartTotals([cartItem({ gst_rate: 12, qty: 1 })]);
    expect(totals.item_count).toBe(1);
    expect(totals.grand_total).toBe(99);
  });

  it('gives ₹693 for seven products — the acceptance criterion', () => {
    const totals = calculateCartTotals([cartItem({ gst_rate: 12, qty: 7 })]);
    expect(totals.item_count).toBe(7);
    expect(totals.grand_total).toBe(693);
  });

  it('gives ₹693 for seven products spread across mixed GST rates', () => {
    const totals = calculateCartTotals([
      cartItem({ id: 'a', product_id: 'a', gst_rate: 5, qty: 2 }),
      cartItem({ id: 'b', product_id: 'b', gst_rate: 12, qty: 3 }),
      cartItem({ id: 'c', product_id: 'c', gst_rate: 18, qty: 2 }),
    ]);
    expect(totals.item_count).toBe(7);
    expect(totals.grand_total).toBe(693);
    expect(toPaise(totals.subtotal) + toPaise(totals.total_tax)).toBe(toPaise(693));
  });

  it('applies a discount without letting the total go negative', () => {
    const totals = calculateCartTotals([cartItem({ gst_rate: 12, qty: 1 })], 500);
    expect(totals.grand_total).toBe(0);
    expect(totals.discount).toBe(99);
  });

  it('is empty for an empty cart', () => {
    const totals = calculateCartTotals([]);
    expect(totals.grand_total).toBe(0);
    expect(totals.item_count).toBe(0);
  });
});

describe('GST summary grouping', () => {
  it('groups by rate and totals correctly', () => {
    const summary = generateGSTSummary([
      cartItem({ id: 'a', gst_rate: 12, qty: 2 }),
      cartItem({ id: 'b', gst_rate: 12, qty: 3 }),
      cartItem({ id: 'c', gst_rate: 18, qty: 1 }),
    ]);

    expect(summary).toHaveLength(2);
    expect(summary[0].rate).toBe(12);
    expect(summary[1].rate).toBe(18);

    for (const group of summary) {
      expect(toPaise(group.cgst) + toPaise(group.sgst)).toBe(toPaise(group.total_tax));
    }
  });
});

describe('category → GST rate defaults', () => {
  it('maps the store categories to sensible rates', () => {
    expect(getGSTRateForCategory('Electronics')).toBe(18);
    expect(getGSTRateForCategory('Clothing')).toBe(5);
    expect(getGSTRateForCategory('Fashion')).toBe(5);
    expect(getGSTRateForCategory('Kitchen')).toBe(12);
    expect(getGSTRateForCategory('Anything Else')).toBe(12);
  });
});

describe('decimal-safe money', () => {
  it('avoids the classic floating point drift', () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(toPaise(19.99)).toBe(1999);
  });

  it('sums a hundred ₹99 lines exactly', () => {
    expect(sumMoney(Array(100).fill(99))).toBe(9900);
  });
});
