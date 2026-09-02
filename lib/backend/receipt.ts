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
    isReprint: false,
  };
}

// ─── Thermal text rendering (48 columns, 80mm paper) ───

export const RECEIPT_WIDTH = 48;

function centerText(text: string, width = RECEIPT_WIDTH): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text + '\n';
}

function twoColumn(left: string, right: string, width = RECEIPT_WIDTH): string {
  const space = width - left.length - right.length;
  if (space <= 0) {
    return `${left.substring(0, Math.max(0, width - right.length - 1))} ${right}\n`;
  }
  return left + ' '.repeat(space) + right + '\n';
}

function rule(char = '-', width = RECEIPT_WIDTH): string {
  return char.repeat(width) + '\n';
}

/**
 * Render the customer receipt as plain monospace text.
 *
 * This single renderer feeds BOTH the ESC/POS thermal path and the browser
 * print fallback, so the two can never diverge in what they disclose.
 */
export function renderCustomerReceiptText(data: CustomerReceiptData): string {
  let r = '';

  r += '\n';
  r += centerText(data.storeName.toUpperCase());
  if (data.storeAddress) r += centerText(data.storeAddress);
  if (data.storeCity) r += centerText(data.storeCity);
  if (data.storePhone) r += centerText(`Ph: ${data.storePhone}`);
  if (data.storeGSTIN) r += centerText(`GSTIN: ${data.storeGSTIN}`);
  r += '\n';

  if (data.isReprint) {
    r += centerText('*** DUPLICATE RECEIPT ***');
    r += '\n';
  }

  r += rule();
  r += `Invoice: ${data.invoiceNumber}\n`;
  r += `Date: ${data.date}${' '.repeat(6)}Time: ${data.time}\n`;
  r += `Cashier: ${data.cashierName}\n`;
  r += rule();

  // Aggregate only — no product identity of any kind.
  r += twoColumn('TOTAL PRODUCTS', String(data.totalItems));
  if (data.discount > 0) {
    r += twoColumn('DISCOUNT', `-Rs.${data.discount.toFixed(2)}`);
  }
  r += twoColumn('TOTAL AMOUNT', `Rs.${data.grandTotal.toFixed(2)}`);
  r += rule();

  r += `Payment: ${data.paymentMethod}\n`;
  if (data.paymentMethod === 'CASH' && typeof data.amountTendered === 'number') {
    r += twoColumn('Cash Received', `Rs.${data.amountTendered.toFixed(2)}`);
    r += twoColumn('Change', `Rs.${(data.changeDue ?? 0).toFixed(2)}`);
  }

  if (typeof data.totalCgst === 'number' && typeof data.totalSgst === 'number') {
    r += rule();
    r += twoColumn('CGST (incl.)', `Rs.${data.totalCgst.toFixed(2)}`);
    r += twoColumn('SGST (incl.)', `Rs.${data.totalSgst.toFixed(2)}`);
    r += centerText('Price inclusive of GST');
  }

  r += rule();
  r += centerText('THANK YOU!');
  r += centerText('VISIT AGAIN');
  r += '\n\n';

  return r;
}
