// ═══════════════════════════════════════
// Customer Receipt Privacy
// ═══════════════════════════════════════
// The mandatory business rule: a customer-facing receipt shows the total
// product count and the total amount, and NEVER product identity.
//
// These tests are the guard rail. If someone later adds a product name to the
// receipt DTO or the renderer, these fail.

import { describe, it, expect } from 'vitest';
import {
  buildCustomerReceipt,
  buildCustomerReceiptFromCart,
  renderCustomerReceiptText,
  FORBIDDEN_RECEIPT_FIELDS,
  type CustomerReceiptData,
} from '@/lib/backend/receipt';
import { calculateLineGST } from '@/lib/backend/gst';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import type { CartItem, GSTRate } from '@/types';

/** Distinctive strings that must never surface on a customer receipt. */
const SECRET_PRODUCT_NAME = 'Wireless Earbuds Pro';
const SECRET_BARCODE = '8901234567890';
const SECRET_HSN = '8518';

function line(name: string, barcode: string, hsn: string, rate: GSTRate, qty: number): CartItem {
  return {
    id: `line-${barcode}`,
    product_id: `p-${barcode}`,
    product_name: name,
    barcode,
    hsn_code: hsn,
    category: 'Electronics',
    gst_rate: rate,
    qty,
    unit_price: DEFAULT_PRODUCT_PRICE,
    stock_qty: 50,
    ...calculateLineGST(DEFAULT_PRODUCT_PRICE, rate, qty),
  };
}

const cart: CartItem[] = [
  line(SECRET_PRODUCT_NAME, SECRET_BARCODE, SECRET_HSN, 18, 4),
  line('Kitchen Organizer Box', '8901234567892', '3924', 12, 3),
];

const receipt = buildCustomerReceiptFromCart({
  invoiceNumber: 'MCM/2026/000001',
  cart,
  cashierName: 'Ravi',
  paymentMethod: 'UPI',
  grandTotal: 693,
  totalCgst: 40,
  totalSgst: 40,
});

describe('the receipt DTO carries no product identity', () => {
  it('has no product-level fields at all', () => {
    const keys = Object.keys(receipt);
    // Driven by the exported list so the guard and the DTO cannot drift apart.
    for (const forbidden of [...FORBIDDEN_RECEIPT_FIELDS, 'products', 'lines']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('does not contain a product name anywhere in its serialised form', () => {
    const serialised = JSON.stringify(receipt);
    expect(serialised).not.toContain(SECRET_PRODUCT_NAME);
    expect(serialised).not.toContain(SECRET_BARCODE);
    expect(serialised).not.toContain('Kitchen Organizer Box');
  });

  it('carries the aggregate figures the customer does need', () => {
    expect(receipt.totalItems).toBe(7);
    expect(receipt.grandTotal).toBe(693);
    expect(receipt.invoiceNumber).toBe('MCM/2026/000001');
    expect(receipt.paymentMethod).toBe('UPI');
    expect(receipt.cashierName).toBe('Ravi');
  });
});

describe('the rendered receipt text', () => {
  const text = renderCustomerReceiptText(receipt);

  it('shows TOTAL PRODUCTS and TOTAL AMOUNT', () => {
    expect(text).toContain('TOTAL PRODUCTS');
    expect(text).toContain('7');
    expect(text).toContain('TOTAL AMOUNT');
    expect(text).toContain('693.00');
  });

  it('shows the store header and invoice details', () => {
    expect(text).toContain('MAXXCITY MALL');
    expect(text).toContain('MCM/2026/000001');
    expect(text).toContain('Payment: UPI');
  });

  it('contains NO product name, barcode or HSN', () => {
    expect(text).not.toContain(SECRET_PRODUCT_NAME);
    expect(text).not.toContain('Kitchen Organizer Box');
    expect(text).not.toContain(SECRET_BARCODE);
    expect(text).not.toContain(SECRET_HSN);
  });

  it('contains no itemised lines — no per-item price or quantity column', () => {
    expect(text).not.toContain('Item Name');
    expect(text).not.toMatch(/\bQty\b/i);
    // The only "99" that could legitimately appear would be a per-item price;
    // there is no such column.
    expect(text).not.toMatch(/^\s*\d+\s+x\s+/m);
  });

  it('never exposes a per-item GST breakdown', () => {
    // Transaction-level CGST/SGST totals are allowed; rate-wise item lines are not.
    expect(text).not.toMatch(/CGST @\d/);
    expect(text).not.toMatch(/SGST @\d/);
  });
});

describe('receipt built from a persisted sale (reprint path)', () => {
  const reprint = buildCustomerReceipt(
    {
      invoice_number: 'MCM/2026/000042',
      grand_total: 693,
      discount: 0,
      payment_method: 'CASH',
      total_cgst: 40,
      total_sgst: 40,
      created_at: '2026-09-02T10:30:00.000Z',
      total_items: 7,
    },
    { isReprint: true, cashierName: 'Priya' }
  );

  it('still shows only the aggregate figures', () => {
    expect(reprint.totalItems).toBe(7);
    expect(reprint.grandTotal).toBe(693);
    expect(JSON.stringify(reprint)).not.toContain('product');
  });

  it('is marked as a duplicate so it cannot pass as the original', () => {
    expect(reprint.isReprint).toBe(true);
    expect(renderCustomerReceiptText(reprint)).toContain('DUPLICATE RECEIPT');
  });

  it('derives the item count from sale items when total_items is absent', () => {
    const derived = buildCustomerReceipt({
      invoice_number: 'MCM/2026/000043',
      grand_total: 297,
      discount: 0,
      payment_method: 'CARD',
      total_cgst: 17,
      total_sgst: 17,
      created_at: '2026-09-02T10:30:00.000Z',
      items: [{ qty: 2 }, { qty: 1 }],
    });
    expect(derived.totalItems).toBe(3);
  });
});

describe('cash tendered and change', () => {
  it('computes change and prints it', () => {
    const cashReceipt = buildCustomerReceiptFromCart({
      invoiceNumber: 'MCM/2026/000002',
      cart: [line('Anything', '111', '1111', 12, 1)],
      cashierName: 'Ravi',
      paymentMethod: 'CASH',
      grandTotal: 99,
      amountTendered: 500,
    });

    expect(cashReceipt.changeDue).toBe(401);
    const text = renderCustomerReceiptText(cashReceipt);
    expect(text).toContain('Cash Received');
    expect(text).toContain('401.00');
    expect(text).not.toContain('Anything');
  });
});

describe('a discount appears as a total, not per item', () => {
  it('prints one DISCOUNT line', () => {
    const discounted: CustomerReceiptData = {
      ...receipt,
      discount: 50,
      grandTotal: 643,
    };
    const text = renderCustomerReceiptText(discounted);
    expect(text).toContain('DISCOUNT');
    expect(text).toContain('643.00');
    expect(text).not.toContain(SECRET_PRODUCT_NAME);
  });
});
