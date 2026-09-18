// ═══════════════════════════════════════
// Store policy on the customer receipt
// ═══════════════════════════════════════
// The bill states: no exchange and no return, except a clothing item, which
// may be exchanged within an hour of billing.
//
// Both lines print on EVERY receipt. Printing the clothing line only when the
// basket held clothing would disclose the category of what was bought, which
// the receipt privacy rule forbids.

import { describe, it, expect } from 'vitest';
import {
  renderCustomerReceiptText,
  buildCustomerReceipt,
  RECEIPT_WIDTH,
  BROWSER_RECEIPT_WIDTH,
  POLICY_NO_RETURN,
  POLICY_CLOTHING,
  CLOTHING_EXCHANGE_WINDOW_MINUTES,
  type CustomerReceiptData,
} from '@/lib/backend/receipt';

const SALE_TIME = '2026-09-19T10:00:00+05:30';

const receipt = (): CustomerReceiptData =>
  buildCustomerReceipt({
    invoice_number: 'MCM/2026/000123',
    grand_total: 198,
    discount: 0,
    payment_method: 'CASH',
    total_cgst: 4.71,
    total_sgst: 4.71,
    created_at: SALE_TIME,
    cashier_name: 'Ravi',
    total_items: 2,
  });

/** Line breaks are a layout detail; the sentence is what must be present. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('every receipt states the policy', () => {
  it.each([RECEIPT_WIDTH, BROWSER_RECEIPT_WIDTH])('at %i columns', (width) => {
    const text = flat(renderCustomerReceiptText(receipt(), { width }));
    expect(text).toContain(POLICY_NO_RETURN);
    expect(text).toContain(POLICY_CLOTHING);
  });

  it('states the clothing window as one hour', () => {
    expect(CLOTHING_EXCHANGE_WINDOW_MINUTES).toBe(60);
    expect(POLICY_CLOTHING).toContain('1 hour');
  });

  it('prints the policy on the thermal body too, which omits the store header', () => {
    const body = flat(renderCustomerReceiptText(receipt(), { includeHeader: false }));
    expect(body).toContain(POLICY_NO_RETURN);
    expect(body).toContain(POLICY_CLOTHING);
  });
});

describe('the exchange deadline', () => {
  it('is the sale time plus the policy window', () => {
    const sold = new Date(SALE_TIME);
    const expected = new Date(
      sold.getTime() + CLOTHING_EXCHANGE_WINDOW_MINUTES * 60_000
    ).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    expect(receipt().exchangeUntil).toBe(expected);
  });

  it('is printed next to the clothing line', () => {
    const data = receipt();
    const text = flat(renderCustomerReceiptText(data, { width: RECEIPT_WIDTH }));
    expect(text).toContain(`(by ${data.exchangeUntil})`);
  });

  it('is left out rather than guessed when the time is unknown', () => {
    const text = flat(renderCustomerReceiptText({ ...receipt(), exchangeUntil: undefined }));
    expect(text).toContain(POLICY_CLOTHING);
    expect(text).not.toContain('(by ');
  });
});

describe('the policy lines survive a thermal printer', () => {
  it.each([RECEIPT_WIDTH, BROWSER_RECEIPT_WIDTH])(
    'uses plain ASCII only at %i columns',
    (width) => {
      // ESC/POS code pages render '·', '—' or '₹' as noise, which is why the
      // whole receipt sticks to ASCII and writes "Rs." rather than a symbol.
      expect(renderCustomerReceiptText(receipt(), { width })).toMatch(/^[\x20-\x7E\n]*$/);
    }
  );
});
