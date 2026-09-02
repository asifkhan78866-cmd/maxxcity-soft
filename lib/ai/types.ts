// ═══════════════════════════════════════
// AI Module Row Shapes
// ═══════════════════════════════════════
// Minimal structural types for the database rows the AI/analytics modules
// read. They describe only the columns actually selected, which keeps the
// modules honest about what they depend on.

export interface SaleRowLite {
  id: string;
  invoice_number?: string;
  grand_total: number | string;
  total_sales?: number | string;
  created_at: string;
  status?: string;
  shift_id?: string;
  sale_items?: SaleItemLite[];
}

export interface SaleItemLite {
  product_id?: string;
  product_name?: string;
  qty: number;
  line_total?: number | string;
}

export interface ProductRowLite {
  id: string;
  name: string;
  barcode?: string;
  category?: string;
  stock_qty: number;
  low_stock_threshold: number;
  price?: number | string;
}

export interface ShiftRowLite {
  id: string;
  cashier_id: string;
  total_sales: number | string;
  expected_cash?: number | string | null;
  closing_cash?: number | string | null;
  discrepancy?: number | string | null;
}

export interface InventoryAuditResult {
  product_id: string;
  expected: number;
  actual: number;
}
