// ═══════════════════════════════════════
// PDF Generators (jsPDF)
// ═══════════════════════════════════════
// TWO DISTINCT DOCUMENTS — do not conflate them:
//
//   1. Customer receipt PDF  (generateCustomerReceiptPDF)
//      80mm roll layout. Built ONLY from the sanitized CustomerReceiptData.
//      No product names, no itemisation. Safe to hand to a customer.
//
//   2. Formal GST tax invoice (generateGSTInvoice)
//      A4 layout with full item-level detail and the rate-wise GST summary,
//      as a tax invoice legally requires. INTERNAL / ADMIN / on explicit
//      request only — never produced as the default customer bill.

'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { SaleItem, PaymentMethod, InvoiceGSTSummary } from '@/types';
import { generateGSTSummary } from './gst';
import { formatINR } from '@/lib/money';
import {
  type CustomerReceiptData,
  renderCustomerReceiptText,
} from './receipt';

// ─────────────────────────────────────────────
// 1. CUSTOMER RECEIPT PDF (sanitized)
// ─────────────────────────────────────────────

/**
 * Render the customer receipt as an 80mm PDF.
 * Accepts only the sanitized DTO — there is no code path here that could
 * reach product-level data.
 */
export function generateCustomerReceiptPDF(data: CustomerReceiptData): jsPDF {
  const lines = renderCustomerReceiptText(data).split('\n');
  const lineHeight = 4;
  const marginTop = 6;
  const height = marginTop * 2 + lines.length * lineHeight;

  const doc = new jsPDF({ unit: 'mm', format: [80, Math.max(80, height)] });
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);

  let y = marginTop;
  for (const line of lines) {
    doc.text(line, 4, y);
    y += lineHeight;
  }

  return doc;
}

export function downloadCustomerReceipt(data: CustomerReceiptData): void {
  generateCustomerReceiptPDF(data).save(
    `Receipt_${data.invoiceNumber.replace(/[/\\]/g, '_')}.pdf`
  );
}

// ─────────────────────────────────────────────
// 2. FORMAL GST TAX INVOICE (item-level, internal)
// ─────────────────────────────────────────────

export interface GSTInvoiceData {
  invoiceNumber: string;
  date: string;
  storeName: string;
  storeAddress: string;
  storeGSTIN: string;
  storePhone: string;
  cashierName: string;
  /** Full item-level detail — required on a formal tax invoice. */
  items: Array<
    Pick<
      SaleItem,
      | 'product_name'
      | 'hsn_code'
      | 'qty'
      | 'unit_price'
      | 'gst_rate'
      | 'base_price'
      | 'tax_amount'
      | 'cgst'
      | 'sgst'
      | 'line_total'
    >
  >;
  subtotal: number;
  totalCGST: number;
  totalSGST: number;
  totalTax: number;
  discount: number;
  grandTotal: number;
  paymentMethod: PaymentMethod | string;
  customerName?: string;
  customerPhone?: string;
}

/**
 * Generate an A4 GST tax invoice with item-level detail.
 *
 * ADMIN / FORMAL USE ONLY. This document is not the retail customer receipt;
 * issue it when a buyer explicitly requires a tax invoice, or for accounting.
 */
export function generateGSTInvoice(data: GSTInvoiceData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 15;

  // ─── Header ───
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(27, 94, 32); // MaxxCity green
  doc.text(data.storeName.toUpperCase(), pageWidth / 2, y, { align: 'center' });
  y += 7;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60, 60, 60);
  doc.text(data.storeAddress, pageWidth / 2, y, { align: 'center' });
  y += 5;

  if (data.storePhone) {
    doc.text(`Phone: ${data.storePhone}`, pageWidth / 2, y, { align: 'center' });
    y += 5;
  }

  if (data.storeGSTIN) {
    doc.setFont('helvetica', 'bold');
    doc.text(`GSTIN: ${data.storeGSTIN}`, pageWidth / 2, y, { align: 'center' });
    y += 5;
  }

  doc.setDrawColor(27, 94, 32);
  doc.setLineWidth(0.5);
  doc.line(14, y, pageWidth - 14, y);
  y += 8;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('TAX INVOICE', pageWidth / 2, y, { align: 'center' });
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice No: ${data.invoiceNumber}`, 14, y);
  doc.text(`Date: ${data.date}`, pageWidth - 14, y, { align: 'right' });
  y += 5;
  doc.text(`Cashier: ${data.cashierName}`, 14, y);
  doc.text(`Payment: ${data.paymentMethod}`, pageWidth - 14, y, { align: 'right' });
  y += 5;

  if (data.customerName || data.customerPhone) {
    doc.text(
      `Customer: ${[data.customerName, data.customerPhone].filter(Boolean).join(' • ')}`,
      14,
      y
    );
    y += 5;
  }
  y += 3;

  // ─── Items table ───
  const tableData = data.items.map((item, index) => [
    index + 1,
    item.product_name,
    item.hsn_code,
    item.qty,
    `${item.gst_rate}%`,
    formatINR(item.unit_price),
    formatINR(item.base_price),
    formatINR(item.tax_amount),
    formatINR(item.line_total),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'HSN', 'Qty', 'GST%', 'Price', 'Taxable', 'Tax', 'Total']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [27, 94, 32],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 45 },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 14, halign: 'center' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 20, halign: 'right' },
      8: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // ─── Rate-wise GST summary ───
  const gstSummary = generateGSTSummary(data.items);
  const gstTableData = gstSummary.map((g: InvoiceGSTSummary) => [
    `${g.rate}%`,
    formatINR(g.taxable_value),
    `${g.rate / 2}%`,
    formatINR(g.cgst),
    `${g.rate / 2}%`,
    formatINR(g.sgst),
    formatINR(g.total_tax),
  ]);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('GST Summary', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['GST Rate', 'Taxable Value', 'CGST Rate', 'CGST', 'SGST Rate', 'SGST', 'Total Tax']],
    body: gstTableData,
    theme: 'grid',
    headStyles: {
      fillColor: [232, 160, 0],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 8;

  // ─── Totals ───
  const totalsX = pageWidth - 14;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  doc.text('Subtotal (excl. tax):', totalsX - 60, y);
  doc.text(formatINR(data.subtotal), totalsX, y, { align: 'right' });
  y += 5;

  doc.text('CGST:', totalsX - 60, y);
  doc.text(formatINR(data.totalCGST), totalsX, y, { align: 'right' });
  y += 5;

  doc.text('SGST:', totalsX - 60, y);
  doc.text(formatINR(data.totalSGST), totalsX, y, { align: 'right' });
  y += 5;

  if (data.discount > 0) {
    doc.text('Discount:', totalsX - 60, y);
    doc.setTextColor(211, 47, 47);
    doc.text(`-${formatINR(data.discount)}`, totalsX, y, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }

  doc.setLineWidth(0.3);
  doc.line(totalsX - 65, y, totalsX, y);
  y += 5;

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Grand Total:', totalsX - 60, y);
  doc.setTextColor(27, 94, 32);
  doc.text(formatINR(data.grandTotal), totalsX, y, { align: 'right' });
  y += 12;

  doc.setTextColor(100, 100, 100);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('All prices are inclusive of GST.', pageWidth / 2, y, { align: 'center' });
  y += 5;
  doc.text(`Thank you for shopping at ${data.storeName}!`, pageWidth / 2, y, {
    align: 'center',
  });

  return doc;
}

export function downloadGSTInvoice(data: GSTInvoiceData): void {
  generateGSTInvoice(data).save(
    `TaxInvoice_${data.invoiceNumber.replace(/[/\\]/g, '_')}.pdf`
  );
}

export function openGSTInvoice(data: GSTInvoiceData): void {
  const blob = generateGSTInvoice(data).output('blob');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Release the object URL once the new tab has had a chance to load it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
