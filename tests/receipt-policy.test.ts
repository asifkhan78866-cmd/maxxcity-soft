// ═══════════════════════════════════════
// Store policy on the customer receipt
// ═══════════════════════════════════════
// The bill states one policy: no exchange and no return. There is no
// clothing exception and no time window on the receipt.

import { describe, it, expect } from 'vitest';
import {
  renderCustomerReceiptText,
  buildCustomerReceipt,
  RECEIPT_WIDTH,
  BROWSER_RECEIPT_WIDTH,
  POLICY_NO_RETURN,
  type CustomerReceiptData,
} from '@/lib/backend/receipt';

const receipt = (): CustomerReceiptData =>
  buildCustomerReceipt({
    invoice_number: 'MCM/2026/000123',
    grand_total: 198,
    discount: 0,
    payment_method: 'CASH',
    total_cgst: 4.71,
    total_sgst: 4.71,
    created_at: '2026-09-19T10:00:00+05:30',
    cashier_name: 'Ravi',
    total_items: 2,
  });

/** Line breaks are a layout detail; the sentence is what must be present. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('every receipt states the policy', () => {
  it.each([RECEIPT_WIDTH, BROWSER_RECEIPT_WIDTH])('at %i columns', (width) => {
    expect(flat(renderCustomerReceiptText(receipt(), { width }))).toContain(POLICY_NO_RETURN);
  });

  it('prints it on the thermal body too, which omits the store header', () => {
    const body = flat(renderCustomerReceiptText(receipt(), { includeHeader: false }));
    expect(body).toContain(POLICY_NO_RETURN);
  });
});

describe('the receipt promises no exception', () => {
  it.each([RECEIPT_WIDTH, BROWSER_RECEIPT_WIDTH])(
    'mentions no clothing exchange or time window at %i columns',
    (width) => {
      const text = renderCustomerReceiptText(receipt(), { width });
      expect(text).not.toMatch(/clothing/i);
      expect(text).not.toMatch(/\bhour\b/i);
      expect(text).not.toContain('(by ');
    }
  );
});

describe('the policy line survives a thermal printer', () => {
  it.each([RECEIPT_WIDTH, BROWSER_RECEIPT_WIDTH])(
    'uses plain ASCII only at %i columns',
    (width) => {
      // ESC/POS code pages render '·', '—' or '₹' as noise, which is why the
      // whole receipt sticks to ASCII and writes "Rs." rather than a symbol.
      expect(renderCustomerReceiptText(receipt(), { width })).toMatch(/^[\x20-\x7E\n]*$/);
    }
  );
});
