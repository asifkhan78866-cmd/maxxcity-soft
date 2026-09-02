// ═══════════════════════════════════════
// Thermal Printer — Web Serial API (ESC/POS)
// ═══════════════════════════════════════
// 80mm thermal printers, 48 character width.
// Falls back to the browser print dialog when Web Serial is unavailable.
//
// PRIVACY RULE: this module only ever accepts CustomerReceiptData — the
// sanitized DTO from lib/backend/receipt.ts. It has no access to product
// names, barcodes, HSN codes or per-item amounts, so a customer receipt
// cannot leak product identity through either print path.

'use client';

import {
  type CustomerReceiptData,
  renderCustomerReceiptText,
} from './receipt';

export type { CustomerReceiptData };

// ESC/POS Commands
const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  INIT: new Uint8Array([ESC, 0x40]),
  BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]),
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]),
  CENTER: new Uint8Array([ESC, 0x61, 0x01]),
  LEFT: new Uint8Array([ESC, 0x61, 0x00]),
  RIGHT: new Uint8Array([ESC, 0x61, 0x02]),
  DOUBLE_HEIGHT: new Uint8Array([ESC, 0x21, 0x10]),
  NORMAL: new Uint8Array([ESC, 0x21, 0x00]),
  FEED: new Uint8Array([ESC, 0x64, 0x04]),
  CUT: new Uint8Array([GS, 0x56, 0x00]),
  PARTIAL_CUT: new Uint8Array([GS, 0x56, 0x01]),
};

interface PrinterConnection {
  port: SerialPort;
  writer: WritableStreamDefaultWriter<Uint8Array>;
}

let connection: PrinterConnection | null = null;

export type PrintOutcome =
  | { ok: true; via: 'thermal' | 'browser' }
  | { ok: false; via: 'thermal' | 'browser'; error: string };

export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export async function connectPrinter(): Promise<boolean> {
  if (!isWebSerialSupported()) {
    console.warn('Web Serial API not supported — browser print fallback will be used');
    return false;
  }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    const writer = port.writable!.getWriter();
    connection = { port, writer };
    await writer.write(COMMANDS.INIT);
    return true;
  } catch (error) {
    console.error('Failed to connect to printer:', error);
    connection = null;
    return false;
  }
}

export async function disconnectPrinter(): Promise<void> {
  if (!connection) return;
  try {
    connection.writer.releaseLock();
    await connection.port.close();
  } catch (e) {
    console.error('Error disconnecting printer:', e);
  }
  connection = null;
}

export function isPrinterConnected(): boolean {
  return connection !== null;
}

async function sendBytes(data: Uint8Array): Promise<void> {
  if (!connection) throw new Error('Printer not connected');
  await connection.writer.write(data);
}

async function sendText(text: string): Promise<void> {
  await sendBytes(new TextEncoder().encode(text));
}

/**
 * Text of the customer receipt. Kept as a thin re-export so callers cannot
 * accidentally reach for a product-level renderer.
 */
export function generateReceiptText(data: CustomerReceiptData): string {
  return renderCustomerReceiptText(data);
}

/**
 * Print the sanitized customer receipt.
 *
 * Never throws: a printer failure must not create financial uncertainty about
 * a sale that is already committed. The caller inspects the outcome and can
 * offer a reprint.
 */
export async function printCustomerReceipt(
  data: CustomerReceiptData
): Promise<PrintOutcome> {
  if (!connection) {
    return printReceiptBrowser(data);
  }

  try {
    await sendBytes(COMMANDS.INIT);

    await sendBytes(COMMANDS.CENTER);
    await sendBytes(COMMANDS.DOUBLE_HEIGHT);
    await sendBytes(COMMANDS.BOLD_ON);
    await sendText(data.storeName.toUpperCase() + '\n');
    await sendBytes(COMMANDS.BOLD_OFF);
    await sendBytes(COMMANDS.NORMAL);
    if (data.storeAddress) await sendText(data.storeAddress + '\n');
    if (data.storeCity) await sendText(data.storeCity + '\n');
    if (data.storePhone) await sendText(`Ph: ${data.storePhone}\n`);
    if (data.storeGSTIN) await sendText(`GSTIN: ${data.storeGSTIN}\n`);

    await sendBytes(COMMANDS.LEFT);

    // Skip the header block already printed above (leading blank + store lines).
    const body = renderCustomerReceiptText(data)
      .split('\n')
      .slice(headerLineCount(data))
      .join('\n');
    await sendText(body);

    await sendBytes(COMMANDS.FEED);
    await sendBytes(COMMANDS.PARTIAL_CUT);

    return { ok: true, via: 'thermal' };
  } catch (error) {
    console.error('Thermal print error:', error);
    // Try the browser path so the customer still gets a receipt.
    const fallback = printReceiptBrowser(data);
    if (fallback.ok) return { ok: true, via: 'browser' };
    return {
      ok: false,
      via: 'thermal',
      error: error instanceof Error ? error.message : 'Print failed',
    };
  }
}

/** Number of leading lines of the rendered text taken up by the store header. */
function headerLineCount(data: CustomerReceiptData): number {
  // leading blank + store name + optional address/city/phone/gstin + trailing blank
  let n = 2;
  if (data.storeAddress) n++;
  if (data.storeCity) n++;
  if (data.storePhone) n++;
  if (data.storeGSTIN) n++;
  return n + 1;
}

/**
 * Browser print fallback.
 *
 * Consumes the exact same sanitized DTO as the thermal path, so the two can
 * never disagree about what the customer sees.
 */
export function printReceiptBrowser(data: CustomerReceiptData): PrintOutcome {
  const receiptText = renderCustomerReceiptText(data);
  const printWindow = window.open('', '_blank', 'width=400,height=640');

  if (!printWindow) {
    return {
      ok: false,
      via: 'browser',
      error: 'Print window blocked by the browser. Allow pop-ups to print receipts.',
    };
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${escapeHtml(data.invoiceNumber)}</title>
  <style>
    @page { margin: 0; size: 80mm auto; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: 12px;
      line-height: 1.4;
      margin: 8px;
      white-space: pre;
    }
  </style>
</head>
<body>${escapeHtml(receiptText)}</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();

  return { ok: true, via: 'browser' };
}

/**
 * @deprecated Use printCustomerReceipt. Kept so older call sites keep
 * compiling — it forwards to the sanitized path.
 */
export const printReceipt = printCustomerReceipt;
