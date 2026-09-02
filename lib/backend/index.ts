// ═══════════════════════════════════════
// lib/backend — Business Logic Index
// ═══════════════════════════════════════
// GST engine · customer receipt DTO · PDF generators · thermal printer

export {
  getGSTRateForCategory,
  calculateGST,
  calculateLineGST,
  generateGSTSummary,
  calculateCartTotals,
  formatINR,
  roundMoney,
  type TaxableLine,
} from './gst';

export {
  type CustomerReceiptData,
  FORBIDDEN_RECEIPT_FIELDS,
  RECEIPT_WIDTH,
  buildCustomerReceipt,
  buildCustomerReceiptFromCart,
  renderCustomerReceiptText,
} from './receipt';

export {
  generateCustomerReceiptPDF,
  downloadCustomerReceipt,
  generateGSTInvoice,
  downloadGSTInvoice,
  openGSTInvoice,
  type GSTInvoiceData,
} from './invoice';

export {
  isWebSerialSupported,
  connectPrinter,
  disconnectPrinter,
  isPrinterConnected,
  generateReceiptText,
  printCustomerReceipt,
  printReceiptBrowser,
  type PrintOutcome,
} from './printer';
