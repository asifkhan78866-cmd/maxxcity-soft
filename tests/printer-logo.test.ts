// ═══════════════════════════════════════
// Printing the store logo
// ═══════════════════════════════════════
// The logo has to reach two printers that share nothing:
//
//   · the browser path, where a relative '/logo.jpeg' cannot resolve — the
//     print window is opened blank — so the image is inlined as a data: URI
//   · the thermal path, which speaks ESC/POS and cannot fetch anything, so
//     the image is sent as a one-bit raster (GS v 0)
//
// Neither may ever stop a receipt from printing: no logo still prints a bill.

import { describe, it, expect } from 'vitest';
import {
  encodeRasterImage,
  buildReceiptPrintHtml,
  PRINTER_DOTS_PER_LINE,
} from '@/lib/backend/printer';
import { buildCustomerReceipt } from '@/lib/backend/receipt';

const receipt = buildCustomerReceipt({
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

const GS_V_0 = [0x1d, 0x76, 0x30, 0x00];

describe('ESC/POS raster encoding', () => {
  it('writes the GS v 0 header with width in bytes and height in dots', () => {
    const black = new Uint8Array(16 * 2).fill(1);
    const bytes = Array.from(encodeRasterImage(black, 16, 2));

    expect(bytes).toEqual([...GS_V_0, 2, 0, 2, 0, 0xff, 0xff, 0xff, 0xff]);
  });

  it('packs the most significant bit leftmost', () => {
    // 8x1, only the leftmost dot inked -> 1000 0000
    const pixels = new Uint8Array(8);
    pixels[0] = 1;
    expect(Array.from(encodeRasterImage(pixels, 8, 1)).slice(8)).toEqual([0x80]);
  });

  it('pads a width that is not a whole number of bytes', () => {
    // 12 dots wide -> 2 bytes per row, the last 4 bits blank
    const pixels = new Uint8Array(12).fill(1);
    const bytes = Array.from(encodeRasterImage(pixels, 12, 1));
    expect(bytes.slice(0, 8)).toEqual([...GS_V_0, 2, 0, 1, 0]);
    expect(bytes.slice(8)).toEqual([0xff, 0xf0]);
  });

  it('splits a tall image into slices a print buffer can hold', () => {
    const height = 200;
    const pixels = new Uint8Array(PRINTER_DOTS_PER_LINE * height);
    const bytes = encodeRasterImage(pixels, PRINTER_DOTS_PER_LINE, height, 128);

    const headers = Array.from(bytes).filter(
      (_, i) => bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30
    );
    expect(headers.length).toBe(2);

    const widthBytes = PRINTER_DOTS_PER_LINE / 8;
    expect(bytes.length).toBe(2 * 8 + widthBytes * height);
  });

  it('encodes a full-width logo row as 72 bytes', () => {
    const pixels = new Uint8Array(PRINTER_DOTS_PER_LINE);
    const bytes = encodeRasterImage(pixels, PRINTER_DOTS_PER_LINE, 1);
    expect(bytes.length - 8).toBe(72);
    expect(Array.from(bytes.slice(4, 6))).toEqual([72, 0]);
  });
});

describe('the browser print document', () => {
  const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('inlines the logo instead of linking to a path it cannot resolve', () => {
    const html = buildReceiptPrintHtml(receipt, dataUri);
    expect(html).toContain(`src="${dataUri}"`);
    expect(html).not.toContain('/logo.jpeg');
  });

  it('still prints when the logo could not be loaded', () => {
    const html = buildReceiptPrintHtml(receipt, null);
    expect(html).not.toContain('<img');
    expect(html).toContain('window.print()');
    expect(html).toContain('TOTAL AMOUNT');
  });

  it('prints on window load, so a slow or failed logo cannot strand the receipt', () => {
    const html = buildReceiptPrintHtml(receipt, dataUri);
    expect(html).toContain("window.addEventListener('load'");
    // The old markup printed from the image's own handlers.
    expect(html).not.toContain('onerror="window.print()"');
  });
});
