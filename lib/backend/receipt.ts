// ═══════════════════════════════════════
// Customer Receipt DTO + Renderer
// ═══════════════════════════════════════
// PRIVACY RULE (mandatory):
// The customer-facing receipt must NEVER expose product identity — no product
// name, description, image, barcode, HSN, per-item price, per-item taxable
// value, per-item GST or per-item total.
//
// It shows transaction-level information only:
//   store header · invoice number · date/time · cashier
//   TOTAL PRODUCTS (aggregate unit count) · TOTAL AMOUNT · payment method
//
// Internal product-level data is NOT removed from the database — it stays in
// `sales` / `sale_items` for inventory, analytics, audit, returns, reporting
// and the formal GST invoice (see lib/backend/invoice.ts).
//
// Every customer-facing print path (thermal ESC/POS, browser fallback, PDF)
// consumes THIS sanitized DTO and nothing else. Never pass a cart or a
// SaleItem[] into a customer-facing generator.

import type { PaymentMethod, CartItem, Sale, SaleItem } from '@/types';
import { STORE_CONFIG } from '@/lib/config/store';
import { toPaise, toRupees } from '@/lib/money';

/**
 * The ONLY data a customer receipt is allowed to carry.
 *
 * Deliberately contains no field that could identify a product. Adding one
 * would violate the business rule — extend the formal invoice instead.
 */
export interface CustomerReceiptData {
  /** Store identity — permitted on the customer receipt. */
  storeName: string;
  storeAddress: string;
  storeCity: string;
  storeGSTIN: string;
  storePhone: string;

  /** Transaction identity. */
  invoiceNumber: string;
  date: string;
  time: string;
  cashierName: string;

  /** Aggregate figures only. */
  totalItems: number;
  grandTotal: number;
  discount: number;

  /** Payment. */
  paymentMethod: PaymentMethod;
  amountTendered?: number;
  changeDue?: number;

  /** Transaction-level tax totals (no per-item breakdown). Optional. */
  totalCgst?: number;
  totalSgst?: number;

  /**
   * Clock time by which a clothing item must be brought back to be exchanged
   * (sale time + CLOTHING_EXCHANGE_WINDOW_MINUTES). A time of day only — it
   * says nothing about what was bought.
   */
  exchangeUntil?: string;

  /** Marks a duplicate print of an earlier receipt. */
  isReprint?: boolean;
}

/** Fields that must never appear on a customer receipt. Used by tests. */
export const FORBIDDEN_RECEIPT_FIELDS = [
  'product_name',
  'productName',
  'barcode',
  'hsn_code',
  'hsnCode',
  'items',
  'sale_items',
  'unit_price',
  'line_total',
] as const;

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Store policy: a clothing item may be exchanged within this many minutes of
 * the sale. Nothing else is exchanged or returned.
 */
export const CLOTHING_EXCHANGE_WINDOW_MINUTES = 60;

/** The clock time by which a clothing exchange has to be made. */
function exchangeDeadline(when: Date): string {
  return formatTime(new Date(when.getTime() + CLOTHING_EXCHANGE_WINDOW_MINUTES * 60_000));
}

function storeHeader() {
  return {
    storeName: STORE_CONFIG.name,
    storeAddress: STORE_CONFIG.address,
    storeCity: STORE_CONFIG.city,
    storeGSTIN: STORE_CONFIG.gstin,
    storePhone: STORE_CONFIG.phone,
  };
}

/**
 * Build the sanitized receipt from a persisted internal sale record.
 * Used for reprints and for receipts regenerated from sales history.
 */
export function buildCustomerReceipt(
  sale: Pick<
    Sale,
    | 'invoice_number'
    | 'grand_total'
    | 'discount'
    | 'payment_method'
    | 'total_cgst'
    | 'total_sgst'
    | 'created_at'
  > & { cashier_name?: string | null; items?: Array<Pick<SaleItem, 'qty'>> | null; total_items?: number },
  options: { isReprint?: boolean; cashierName?: string } = {}
): CustomerReceiptData {
  const when = new Date(sale.created_at);
  const totalItems =
    typeof sale.total_items === 'number'
      ? sale.total_items
      : (sale.items ?? []).reduce((sum, i) => sum + i.qty, 0);

  return {
    ...storeHeader(),
    invoiceNumber: sale.invoice_number,
    date: formatDate(when),
    time: formatTime(when),
    cashierName: options.cashierName || sale.cashier_name || 'Cashier',
    totalItems,
    grandTotal: sale.grand_total,
    discount: sale.discount ?? 0,
    paymentMethod: sale.payment_method,
    totalCgst: sale.total_cgst,
    totalSgst: sale.total_sgst,
    exchangeUntil: exchangeDeadline(when),
    isReprint: options.isReprint ?? false,
  };
}

/**
 * Build the sanitized receipt straight from the cashier's cart.
 *
 * Only the aggregate unit count and the money totals cross the boundary —
 * the CartItem objects themselves stay on the internal side.
 */
export function buildCustomerReceiptFromCart(input: {
  invoiceNumber: string;
  cart: CartItem[];
  cashierName: string;
  paymentMethod: PaymentMethod;
  grandTotal: number;
  discount?: number;
  totalCgst?: number;
  totalSgst?: number;
  amountTendered?: number;
  createdAt?: Date;
}): CustomerReceiptData {
  const when = input.createdAt ?? new Date();
  const totalItems = input.cart.reduce((sum, i) => sum + i.qty, 0);
  const changeDue =
    typeof input.amountTendered === 'number'
      ? Math.max(0, toRupees(toPaise(input.amountTendered) - toPaise(input.grandTotal)))
      : undefined;

  return {
    ...storeHeader(),
    invoiceNumber: input.invoiceNumber,
    date: formatDate(when),
    time: formatTime(when),
    cashierName: input.cashierName || 'Cashier',
    totalItems,
    grandTotal: input.grandTotal,
    discount: input.discount ?? 0,
    paymentMethod: input.paymentMethod,
    totalCgst: input.totalCgst,
    totalSgst: input.totalSgst,
    amountTendered: input.amountTendered,
    changeDue,
    exchangeUntil: exchangeDeadline(when),
    isReprint: false,
  };
}

// ─── Text rendering ───
// 48 columns is the native width of an 80mm thermal printer (Font A). The
// browser-printed receipt uses a narrower layout so it can be printed in
// large type: a 48-column line in readable type is wider than the paper, and
// the browser then shrinks the whole receipt to fit — tiny, faint text.

export const RECEIPT_WIDTH = 48;

/** Columns of the browser-printed receipt (see printReceiptBrowser). */
export const BROWSER_RECEIPT_WIDTH = 26;

// ─── Store policy, printed on EVERY receipt ───
// Printed on every bill, never only when the basket holds clothing: a line
// that showed up only for clothing would disclose the category of what was
// bought, which the privacy rule at the top of this file forbids.
//
// ASCII only, like every other line here — a thermal printer renders
// characters such as '·' or '₹' as noise.
const EXCHANGE_WINDOW_TEXT =
  CLOTHING_EXCHANGE_WINDOW_MINUTES === 60
    ? '1 hour'
    : `${CLOTHING_EXCHANGE_WINDOW_MINUTES} minutes`;

export const POLICY_NO_RETURN = 'NO EXCHANGE - NO RETURN';
export const POLICY_CLOTHING = `Clothing only: exchange within ${EXCHANGE_WINDOW_TEXT} of billing`;

export interface ReceiptTextOptions {
  /** Characters per line. Defaults to RECEIPT_WIDTH. */
  width?: number;
  /** Include the store header. The thermal path prints its own, styled. */
  includeHeader?: boolean;
}

/**
 * Break text into lines of at most `width` characters, at spaces. A single
 * word longer than a line is split — overflowing the paper is never better.
 */
function wrapWords(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function centerText(text: string, width: number): string {
  return wrapWords(text, width)
    .map((line) => ' '.repeat(Math.floor((width - line.length) / 2)) + line + '\n')
    .join('');
}

function rightAlign(text: string, width: number): string {
  return wrapWords(text, width)
    .map((line) => ' '.repeat(width - line.length) + line + '\n')
    .join('');
}

/** `left   right` on one line; when they cannot share one, `right` drops below. */
function twoColumn(left: string, right: string, width: number): string {
  if (left.length + 1 + right.length <= width) {
    return left + ' '.repeat(width - left.length - right.length) + right + '\n';
  }
  return wrapWords(left, width).join('\n') + '\n' + rightAlign(right, width);
}

/** `Label: value`, with the value moved to its own line when it does not fit. */
function labelled(label: string, value: string, width: number): string {
  const line = `${label}: ${value}`;
  if (line.length <= width) return line + '\n';
  return `${label}:\n` + rightAlign(value, width);
}

function rule(width: number, char = '-'): string {
  return char.repeat(width) + '\n';
}

/**
 * Render the customer receipt as plain monospace text.
 *
 * This single renderer feeds BOTH the ESC/POS thermal path and the browser
 * print fallback, so the two can never diverge in what they disclose — only
 * the line width differs. No line is ever wider than `width`.
 */
export function renderCustomerReceiptText(
  data: CustomerReceiptData,
  { width = RECEIPT_WIDTH, includeHeader = true }: ReceiptTextOptions = {}
): string {
  let r = '';

  if (includeHeader) {
    r += '\n';
    r += centerText(data.storeName.toUpperCase(), width);
    if (data.storeAddress) r += centerText(data.storeAddress, width);
    if (data.storeCity) r += centerText(data.storeCity, width);
    if (data.storePhone) r += centerText(`Ph: ${data.storePhone}`, width);
    if (data.storeGSTIN) r += centerText(`GSTIN: ${data.storeGSTIN}`, width);
    r += '\n';
  }

  if (data.isReprint) {
    r += centerText('*** DUPLICATE RECEIPT ***', width);
    r += '\n';
  }

  r += rule(width);
  r += labelled('Invoice', data.invoiceNumber, width);
  const dateTime = `Date: ${data.date}${' '.repeat(6)}Time: ${data.time}`;
  r +=
    dateTime.length <= width
      ? dateTime + '\n'
      : labelled('Date', data.date, width) + labelled('Time', data.time, width);
  r += labelled('Cashier', data.cashierName, width);
  r += rule(width);

  // Aggregate only — no product identity of any kind.
  r += twoColumn('TOTAL PRODUCTS', String(data.totalItems), width);
  if (data.discount > 0) {
    r += twoColumn('DISCOUNT', `-Rs.${data.discount.toFixed(2)}`, width);
  }
  r += twoColumn('TOTAL AMOUNT', `Rs.${data.grandTotal.toFixed(2)}`, width);
  r += rule(width);

  r += labelled('Payment', data.paymentMethod, width);
  if (data.paymentMethod === 'CASH' && typeof data.amountTendered === 'number') {
    r += twoColumn('Cash Received', `Rs.${data.amountTendered.toFixed(2)}`, width);
    r += twoColumn('Change', `Rs.${(data.changeDue ?? 0).toFixed(2)}`, width);
  }

  if (typeof data.totalCgst === 'number' && typeof data.totalSgst === 'number') {
    r += rule(width);
    r += twoColumn('CGST (incl.)', `Rs.${data.totalCgst.toFixed(2)}`, width);
    r += twoColumn('SGST (incl.)', `Rs.${data.totalSgst.toFixed(2)}`, width);
    r += centerText('Price inclusive of GST', width);
  }

  r += rule(width);
  r += centerText(POLICY_NO_RETURN, width);
  r += centerText(
    data.exchangeUntil ? `${POLICY_CLOTHING} (by ${data.exchangeUntil})` : POLICY_CLOTHING,
    width
  );

  r += rule(width);
  r += centerText('THANK YOU!', width);
  r += centerText('VISIT AGAIN', width);
  r += '\n\n';

  return r;
}
