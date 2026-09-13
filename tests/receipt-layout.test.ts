// ═══════════════════════════════════════
// Customer Receipt Layout
// ═══════════════════════════════════════
// A line wider than the paper is not just untidy: the browser shrinks the
// WHOLE receipt to fit it, which is how the printed text became unreadably
// small. These tests pin that no line can overflow, whatever the data.

import { describe, it, expect } from 'vitest';
import {
  renderCustomerReceiptText,
  RECEIPT_WIDTH,
  BROWSER_RECEIPT_WIDTH,
  type CustomerReceiptData,
} from '@/lib/backend/receipt';
import { buildReceiptPrintHtml, BROWSER_PRINT_FONT_PX } from '@/lib/backend/printer';

/** Worst case: the real 52-character store address, an offline invoice
 *  number, a long cashier name and six-figure amounts. */
const worstCase: CustomerReceiptData = {
  storeName: 'MaxxCity Mart',
  storeAddress: 'Ramnagar opp bajaj electronics beside Ather Showroom',
  storeCity: 'Adilabad, Telangana 504001',
  storeGSTIN: '36ABCDE1234F1Z5',
  storePhone: '9100770398',
  invoiceNumber: 'MCM/2026/OFF-T3F9K2A-00123',
  date: '11/09/2026',
  time: '10:21 am',
  cashierName: 'Venkata Subramanyam Reddy',
  totalItems: 1234,
  grandTotal: 122166,
  discount: 1500,
  paymentMethod: 'CASH',
  amountTendered: 200000,
  changeDue: 77834,
  totalCgst: 5817.43,
  totalSgst: 5817.43,
  isReprint: true,
};

const widest = (text: string) => Math.max(...text.split('\n').map((l) => l.length));

describe('receipt text never overflows the paper', () => {
  it.each([RECEIPT_WIDTH, BROWSER_RECEIPT_WIDTH])('every line fits in %i columns', (width) => {
    expect(widest(renderCustomerReceiptText(worstCase, { width }))).toBeLessThanOrEqual(width);
  });

  it('keeps every figure intact when it has to wrap', () => {
    const text = renderCustomerReceiptText(worstCase, { width: BROWSER_RECEIPT_WIDTH });
    for (const expected of [
      'MCM/2026/OFF-T3F9K2A-00123',
      'Venkata Subramanyam Reddy',
      'Rs.122166.00',
      '-Rs.1500.00',
      'Rs.200000.00',
      'Rs.77834.00',
      'Rs.5817.43',
      'DUPLICATE RECEIPT',
      'Payment: CASH',
      'TOTAL PRODUCTS',
      '1234',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('wraps a long address at word boundaries', () => {
    const text = renderCustomerReceiptText(worstCase, { width: BROWSER_RECEIPT_WIDTH });
    const lines = text.split('\n').map((l) => l.trim());
    expect(lines).toContain('Ramnagar opp bajaj');
    expect(lines).toContain('electronics beside Ather');
    expect(lines).toContain('Showroom');
  });

  it('leaves the 48-column thermal layout as it was for ordinary receipts', () => {
    const text = renderCustomerReceiptText({
      ...worstCase,
      invoiceNumber: 'MCM/2026/000002',
      cashierName: 'Ravi',
    });
    expect(text).toContain('Invoice: MCM/2026/000002\n');
    expect(text).toContain('Date: 11/09/2026      Time: 10:21 am\n');
    expect(text).toContain('Cashier: Ravi\n');
  });

  it('omits the store header on request — the thermal path prints its own', () => {
    const body = renderCustomerReceiptText(worstCase, { includeHeader: false });
    expect(body).not.toContain('MAXXCITY MART');
    expect(body).not.toContain('Ramnagar');
    expect(body).toContain('TOTAL AMOUNT');
  });
});

describe('browser-printed receipt', () => {
  const html = buildReceiptPrintHtml(worstCase);
  const content = html.split('<div class="content">')[1].split('</div>')[0];

  it('is sized to fit 72mm of printable paper, so the browser never shrinks it', () => {
    // 0.602em is the widest advance in the font stack (Menlo).
    const lineWidthMm = (BROWSER_RECEIPT_WIDTH * 0.602 * BROWSER_PRINT_FONT_PX * 25.4) / 96;
    expect(lineWidthMm).toBeLessThanOrEqual(72);
    expect(html).toContain(`font-size: ${BROWSER_PRINT_FONT_PX}px`);
  });

  it('uses the narrow layout for every line', () => {
    expect(widest(content)).toBeLessThanOrEqual(BROWSER_RECEIPT_WIDTH);
  });

  it('starts right under the logo, with no leading blank line', () => {
    expect(content.startsWith('\n')).toBe(false);
    expect(content.startsWith(' ') || /^[A-Z]/.test(content)).toBe(true);
  });

  it('prints in bold, pure black', () => {
    expect(html).toContain('font-weight: 900');
    expect(html).toContain('color: #000');
  });
});
