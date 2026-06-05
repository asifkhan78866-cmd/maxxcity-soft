// ═══════════════════════════════════════
// Thermal Printer - Web Serial API
// ═══════════════════════════════════════
// Supports 80mm thermal printers using ESC/POS protocol.
// 48 character width for 80mm paper.
// Falls back to browser print dialog if Web Serial unavailable.

'use client';

const CHAR_WIDTH = 48;

// ESC/POS Commands
const ESC = 0x1b;
const GS = 0x1d;

const COMMANDS = {
  INIT: new Uint8Array([ESC, 0x40]), // Initialize printer
  BOLD_ON: new Uint8Array([ESC, 0x45, 0x01]),
  BOLD_OFF: new Uint8Array([ESC, 0x45, 0x00]),
  CENTER: new Uint8Array([ESC, 0x61, 0x01]),
  LEFT: new Uint8Array([ESC, 0x61, 0x00]),
  RIGHT: new Uint8Array([ESC, 0x61, 0x02]),
  DOUBLE_HEIGHT: new Uint8Array([ESC, 0x21, 0x10]),
  NORMAL: new Uint8Array([ESC, 0x21, 0x00]),
  FEED: new Uint8Array([ESC, 0x64, 0x04]), // Feed 4 lines
  CUT: new Uint8Array([GS, 0x56, 0x00]), // Full cut
  PARTIAL_CUT: new Uint8Array([GS, 0x56, 0x01]),
};

interface PrinterConnection {
  port: SerialPort;
  writer: WritableStreamDefaultWriter<Uint8Array>;
}

let connection: PrinterConnection | null = null;

/**
 * Check if Web Serial API is available
 */
export function isWebSerialSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/**
 * Connect to thermal printer via Web Serial
 */
export async function connectPrinter(): Promise<boolean> {
  if (!isWebSerialSupported()) {
    console.warn('Web Serial API not supported');
    return false;
  }

  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });

    const writer = port.writable!.getWriter();
    connection = { port, writer };

    // Initialize printer
    await writer.write(COMMANDS.INIT);
    return true;
  } catch (error) {
    console.error('Failed to connect to printer:', error);
    return false;
  }
}

/**
 * Disconnect from printer
 */
export async function disconnectPrinter(): Promise<void> {
  if (connection) {
    try {
      connection.writer.releaseLock();
      await connection.port.close();
    } catch (e) {
      console.error('Error disconnecting printer:', e);
    }
    connection = null;
  }
}

/**
 * Check if printer is connected
 */
export function isPrinterConnected(): boolean {
  return connection !== null;
}

/**
 * Send raw bytes to printer
 */
async function sendBytes(data: Uint8Array): Promise<void> {
  if (!connection) throw new Error('Printer not connected');
  await connection.writer.write(data);
}

/**
 * Send text to printer
 */
async function sendText(text: string): Promise<void> {
  const encoder = new TextEncoder();
  await sendBytes(encoder.encode(text));
}

/**
 * Create a separator line
 */
function separator(char: string = '-'): string {
  return char.repeat(CHAR_WIDTH) + '\n';
}

/**
 * Pad text to fit columns (left + right aligned)
 */
function twoColumn(left: string, right: string): string {
  const space = CHAR_WIDTH - left.length - right.length;
  if (space <= 0) return left.substring(0, CHAR_WIDTH - right.length) + right + '\n';
  return left + ' '.repeat(space) + right + '\n';
}

/**
 * Center text
 */
function centerText(text: string): string {
  const pad = Math.max(0, Math.floor((CHAR_WIDTH - text.length) / 2));
  return ' '.repeat(pad) + text + '\n';
}

export interface ReceiptData {
  storeName: string;
  storeAddress: string;
  storeGSTIN: string;
  storePhone: string;
  invoiceNumber: string;
  date: string;
  time: string;
  cashierName: string;
  items: Array<{
    name: string;
    qty: number;
    price: number;
    total: number;
  }>;
  subtotal: number;
  cgst: number;
  sgst: number;
  totalTax: number;
  discount: number;
  grandTotal: number;
  paymentMethod: string;
  gstSummary: Array<{
    rate: number;
    taxable: number;
    cgst: number;
    sgst: number;
  }>;
}

/**
 * Generate receipt text for thermal printer
 */
export function generateReceiptText(data: ReceiptData): string {
  let receipt = '';

  // Store header
  receipt += centerText('MAXXCITY MALL');
  receipt += centerText('Ramnagar Main Road, Adilabad');
  if (data.storeGSTIN) receipt += centerText(`GSTIN: ${data.storeGSTIN}`);
  receipt += separator('─');

  // Invoice details
  receipt += `Invoice: ${data.invoiceNumber}\n`;
  receipt += `Date: ${data.date}  Time: ${data.time}\n`;
  receipt += `Cashier: ${data.cashierName}\n`;
  receipt += separator('─');

  // Items header
  receipt += twoColumn('Item Name', 'Qty   Amt');
  receipt += separator('─');

  // Items
  for (const item of data.items) {
    const name = item.name.length > 20 ? item.name.substring(0, 20) : item.name.padEnd(20, ' ');
    const right = `${String(item.qty).padStart(3)}  ${String(item.total).padStart(5)}`;
    receipt += twoColumn(name, right);
  }

  receipt += separator('─');

  // Totals
  receipt += twoColumn('Subtotal', `Rs.${data.subtotal.toFixed(2)}`);

  // GST breakdown
  for (const gst of data.gstSummary) {
    receipt += twoColumn(`CGST @${gst.rate / 2}%`, `Rs.${gst.cgst.toFixed(2)}`);
    receipt += twoColumn(`SGST @${gst.rate / 2}%`, `Rs.${gst.sgst.toFixed(2)}`);
  }

  receipt += separator('─');
  receipt += twoColumn('TOTAL', `Rs.${data.grandTotal.toFixed(2)}`);
  receipt += `Payment: ${data.paymentMethod}\n`;
  receipt += separator('─');

  // Footer
  receipt += centerText('Thank you! Visit again');
  receipt += centerText('@maxxcitymall | Rs.149 Always');
  receipt += '\n\n\n\n';

  return receipt;
}

/**
 * Print receipt on thermal printer
 */
export async function printReceipt(data: ReceiptData): Promise<boolean> {
  if (!connection) {
    // Fallback: browser print
    printReceiptBrowser(data);
    return true;
  }

  try {
    await sendBytes(COMMANDS.INIT);

    // Print header centered and bold
    await sendBytes(COMMANDS.CENTER);
    await sendBytes(COMMANDS.DOUBLE_HEIGHT);
    await sendText(data.storeName.toUpperCase() + '\n');
    await sendBytes(COMMANDS.NORMAL);
    await sendText(data.storeAddress + '\n');
    if (data.storePhone) await sendText(`Ph: ${data.storePhone}\n`);
    if (data.storeGSTIN) await sendText(`GSTIN: ${data.storeGSTIN}\n`);

    // Print rest of receipt left-aligned
    await sendBytes(COMMANDS.LEFT);

    const receiptBody = generateReceiptText(data).split('\n').slice(4).join('\n'); // Skip header lines
    await sendText(receiptBody);

    // Feed and cut
    await sendBytes(COMMANDS.FEED);
    await sendBytes(COMMANDS.PARTIAL_CUT);

    return true;
  } catch (error) {
    console.error('Print error:', error);
    // Fallback to browser print
    printReceiptBrowser(data);
    return false;
  }
}

/**
 * Fallback: print receipt via browser print dialog
 */
export function printReceiptBrowser(data: ReceiptData): void {
  const receiptText = generateReceiptText(data);
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) return;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Receipt - ${data.invoiceNumber}</title>
      <style>
        @page { margin: 0; size: 80mm auto; }
        body {
          font-family: 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.4;
          margin: 8px;
          white-space: pre;
        }
      </style>
    </head>
    <body>${receiptText}</body>
    </html>
  `);
  printWindow.document.close();
  printWindow.print();
}
