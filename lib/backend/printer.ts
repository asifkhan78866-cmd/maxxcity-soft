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
  BROWSER_RECEIPT_WIDTH,
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

// ─── Store logo ───
// The logo has to reach two very different printers:
//
//   · the browser print path, where it is INLINED as a data: URI. The print
//     window is opened blank (window.open('')), so it has no address for a
//     relative '/logo.jpeg' to resolve against — the image failed to load and
//     the receipt printed without it.
//   · the thermal path, which speaks ESC/POS and cannot fetch anything. The
//     image has to be sent as a one-bit raster (GS v 0).

const LOGO_PATH = '/logo.jpeg';

/** Dots per line on an 80mm printer: 48 columns x 12 dots (see RECEIPT_WIDTH). */
export const PRINTER_DOTS_PER_LINE = 576;

/** Rows per GS v 0 command. Whole-image rasters overflow small print buffers. */
const RASTER_SLICE_ROWS = 128;

/** Below this luminance a pixel is ink. Thermal paper has no greys. */
const LOGO_INK_THRESHOLD = 160;

/**
 * Pack a monochrome bitmap into ESC/POS raster commands (GS v 0).
 *
 * `pixels` is row-major, one entry per dot, 1 = black. Pure and exported so
 * the encoding can be tested without a printer or a browser.
 */
export function encodeRasterImage(
  pixels: Uint8Array,
  width: number,
  height: number,
  sliceRows = RASTER_SLICE_ROWS
): Uint8Array {
  const widthBytes = Math.ceil(width / 8);
  const out: number[] = [];

  for (let top = 0; top < height; top += sliceRows) {
    const rows = Math.min(sliceRows, height - top);
    // GS v 0 m xL xH yL yH — m=0 is normal size.
    out.push(GS, 0x76, 0x30, 0x00, widthBytes & 0xff, widthBytes >> 8, rows & 0xff, rows >> 8);

    for (let y = top; y < top + rows; y++) {
      for (let xByte = 0; xByte < widthBytes; xByte++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xByte * 8 + bit;
          if (x < width && pixels[y * width + x]) byte |= 0x80 >> bit;
        }
        out.push(byte);
      }
    }
  }

  return new Uint8Array(out);
}

let logoDataUrlPromise: Promise<string | null> | null = null;
let logoRasterPromise: Promise<Uint8Array | null> | null = null;

/**
 * The logo as a data: URI, fetched once per page. Null when it cannot be
 * loaded — a missing logo must never stop a receipt from printing.
 */
export function loadLogoDataUrl(): Promise<string | null> {
  logoDataUrlPromise ??= (async () => {
    try {
      const response = await fetch(new URL(LOGO_PATH, window.location.origin), {
        cache: 'force-cache',
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  return logoDataUrlPromise;
}

/** The logo as ESC/POS raster bytes, prepared once per page. */
async function loadLogoRaster(): Promise<Uint8Array | null> {
  logoRasterPromise ??= (async () => {
    try {
      const src = await loadLogoDataUrl();
      if (!src) return null;

      const image = new Image();
      image.src = src;
      await image.decode();

      const width = PRINTER_DOTS_PER_LINE;
      const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      // Paper is white: flatten any transparency onto it before thresholding.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);

      const { data: rgba } = ctx.getImageData(0, 0, width, height);
      const pixels = new Uint8Array(width * height);
      for (let i = 0; i < pixels.length; i++) {
        const [r, g, b, a] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]];
        const luminance = a < 128 ? 255 : 0.299 * r + 0.587 * g + 0.114 * b;
        pixels[i] = luminance < LOGO_INK_THRESHOLD ? 1 : 0;
      }

      return encodeRasterImage(pixels, width, height);
    } catch {
      return null;
    }
  })();
  return logoRasterPromise;
}

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

    // The logo, as a raster bitmap. ESC/POS cannot fetch an image, and a
    // printer that rejects the raster must still get the receipt, so a
    // failure here only means no logo.
    const logo = await loadLogoRaster();
    if (logo) await sendBytes(logo);

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

    // The header is printed above, styled — render only the body. Emphasized
    // (bold) mode: thermal text at normal weight prints thin and faint.
    await sendBytes(COMMANDS.BOLD_ON);
    await sendText(renderCustomerReceiptText(data, { includeHeader: false }));
    await sendBytes(COMMANDS.BOLD_OFF);

    await sendBytes(COMMANDS.FEED);
    await sendBytes(COMMANDS.PARTIAL_CUT);

    return { ok: true, via: 'thermal' };
  } catch (error) {
    console.error('Thermal print error:', error);
    // Try the browser path so the customer still gets a receipt.
    const fallback = await printReceiptBrowser(data);
    if (fallback.ok) return { ok: true, via: 'browser' };
    return {
      ok: false,
      via: 'thermal',
      error: error instanceof Error ? error.message : 'Print failed',
    };
  }
}

/**
 * Font size of the browser-printed receipt.
 *
 * Sized against the paper, not picked by eye: BROWSER_RECEIPT_WIDTH columns of
 * a monospace font (≤ 0.602em per character) at this size is ~250px ≈ 66mm,
 * inside the ~72mm printable width of an 80mm roll. Any wider and the browser
 * shrinks the whole receipt to fit, which is what made the text tiny.
 */
export const BROWSER_PRINT_FONT_PX = 16;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The HTML document for the browser-printed receipt.
 *
 * Built from the exact same sanitized DTO and renderer as the thermal path,
 * so the two can never disagree about what the customer sees.
 */
export function buildReceiptPrintHtml(
  data: CustomerReceiptData,
  logoSrc: string | null = null
): string {
  // Drop leading blank lines so the text sits right under the logo.
  const receiptText = renderCustomerReceiptText(data, { width: BROWSER_RECEIPT_WIDTH }).replace(
    /^\n+/,
    ''
  );

  // Inlined as a data: URI by the caller. A relative '/logo.jpeg' cannot work
  // here: the print window is opened blank, so it has no address to resolve
  // against. When the logo could not be loaded the receipt prints without it.
  const logo = logoSrc
    ? `  <img src="${logoSrc}" class="logo" alt="${escapeHtml(data.storeName)}" />\n`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${escapeHtml(data.invoiceNumber)}</title>
  <style>
    @page { margin: 0; size: 80mm auto; }
    body {
      font-family: Menlo, Consolas, 'Courier New', Courier, monospace;
      font-size: ${BROWSER_PRINT_FONT_PX}px;
      font-weight: 900; /* Extra bold for dark printing */
      color: #000; /* Pure black */
      line-height: 1.35;
      margin: 8px;
      white-space: pre;
      text-align: center;
    }
    .logo {
      display: block;
      width: 75mm; /* Enlarged to almost fill the 80mm receipt width */
      max-width: 100%;
      margin: 0 auto -5px auto; /* Reduced space below logo */
      /* Snap the logo to pure black and white. A thermal head prints no
         greys: brightness() darkened the logo's white background to grey,
         which came out as a solid block around the logo. */
      filter: grayscale(1) contrast(1000%);
    }
    .content {
      text-align: left;
      display: inline-block;
      white-space: pre;
      font-weight: 900; /* Force bold text */
      text-shadow: 0 0 1px #000; /* Additional trick for darker prints in some browsers */
      -webkit-text-stroke: 0.35px #000; /* Thicker strokes — thermal heads print thin lines faintly */
      margin-top: -15px; /* Pull the text up even tighter */
    }
  </style>
</head>
<body>
${logo}  <div class="content">${escapeHtml(receiptText)}</div>
  <script>
    // load fires once images are decoded — or have failed. Printing from here
    // rather than from the image means a missing logo still prints a receipt.
    window.addEventListener('load', function () { window.print(); });
  </script>
</body>
</html>`;
}

/**
 * Browser print fallback.
 *
 * Consumes the exact same sanitized DTO as the thermal path, so the two can
 * never disagree about what the customer sees.
 */
export async function printReceiptBrowser(data: CustomerReceiptData): Promise<PrintOutcome> {
  // Opened BEFORE anything is awaited: a popup is only allowed while the
  // click that started the print is still the current task.
  const printWindow = window.open('', '_blank', 'width=400,height=640');

  if (!printWindow) {
    return {
      ok: false,
      via: 'browser',
      error: 'Print window blocked by the browser. Allow pop-ups to print receipts.',
    };
  }

  const logoSrc = await loadLogoDataUrl();

  printWindow.document.write(buildReceiptPrintHtml(data, logoSrc));
  printWindow.document.close();
  printWindow.focus();

  return { ok: true, via: 'browser' };
}

/**
 * @deprecated Use printCustomerReceipt. Kept so older call sites keep
 * compiling — it forwards to the sanitized path.
 */
export const printReceipt = printCustomerReceipt;
