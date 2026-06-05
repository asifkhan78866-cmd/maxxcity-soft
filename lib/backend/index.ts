// ═══════════════════════════════════════
// lib/backend — Business Logic Index
// ═══════════════════════════════════════
// GST Engine, Invoice Generator, Thermal Printer

export {
  getGSTRateForCategory,
  calculateGST,
  calculateLineGST,
  generateGSTSummary,
  calculateCartTotals,
  formatINR,
} from './gst';

export {
  generateA4Invoice,
  downloadInvoice,
  printInvoice,
} from './invoice';

export {
  isWebSerialSupported,
  connectPrinter,
  disconnectPrinter,
  isPrinterConnected,
  generateReceiptText,
  printReceipt,
  printReceiptBrowser,
  type ReceiptData,
} from './printer';
