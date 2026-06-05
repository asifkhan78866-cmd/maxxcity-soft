// ═══════════════════════════════════════
// MaxxCity Mall Management System
// TypeScript Type Definitions
// ═══════════════════════════════════════

// ─── User Roles ───
export type UserRole = 'CASHIER' | 'MANAGER' | 'ADMIN';

export interface Profile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  pin_hash: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Products ───
export type GSTRate = 5 | 12 | 18;

export type ProductCategory =
  | 'Electronics'
  | 'Home & Kitchen'
  | 'Kitchen'
  | 'Clothing'
  | 'Fashion'
  | 'Accessories'
  | 'Toys'
  | 'Stationery'
  | 'Personal Care'
  | 'Care'
  | 'Seasonal'
  | 'Others';

export interface Product {
  id: string;
  name: string;
  barcode: string;
  category: ProductCategory;
  hsn_code: string;
  gst_rate: GSTRate;
  price: number; // Always 149
  stock_qty: number;
  low_stock_threshold: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Cart ───
export interface CartItem {
  id: string; // Unique cart line ID
  product_id: string;
  product_name: string;
  barcode: string;
  hsn_code: string;
  category: ProductCategory;
  gst_rate: GSTRate;
  qty: number;
  unit_price: number;
  base_price: number; // Price excluding GST
  tax_amount: number; // Total tax for this line
  cgst: number;
  sgst: number;
  line_total: number; // qty * unit_price
}

// ─── Sales ───
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD';
export type PaymentStatus = 'COMPLETED' | 'PENDING' | 'FAILED';
export type SaleStatus = 'COMPLETED' | 'VOID' | 'RETURN';

export interface Sale {
  id: string;
  invoice_number: string;
  shift_id: string;
  cashier_id: string;
  cashier_name?: string;
  subtotal: number; // Sum of base prices
  total_cgst: number;
  total_sgst: number;
  total_tax: number;
  discount: number;
  grand_total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  status: SaleStatus;
  items: SaleItem[];
  created_at: string;
  updated_at: string;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  barcode: string;
  hsn_code: string;
  qty: number;
  unit_price: number;
  gst_rate: GSTRate;
  base_price: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  line_total: number;
}

// ─── Shifts ───
export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface Shift {
  id: string;
  cashier_id: string;
  cashier_name?: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  cash_sales_total: number;
  upi_sales_total: number;
  card_sales_total: number;
  total_sales: number;
  total_items: number;
  total_transactions: number;
  discrepancy: number | null;
  discrepancy_reason: string | null;
  status: ShiftStatus;
  created_at: string;
}

// ─── Invoice Counter ───
export interface InvoiceCounter {
  id: string;
  prefix: string;
  current_number: number;
}

// ─── Purchase Orders ───
export type POStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
  product_id: string;
  product_name: string;
  barcode: string;
  qty_ordered: number;
  qty_received: number;
  unit_cost: number;
}

export interface PurchaseOrder {
  id: string;
  supplier: string;
  status: POStatus;
  items: PurchaseOrderItem[];
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// ─── EMI / Finance Cases ───
export type EMIStatus =
  | 'BOOKED'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'DISBURSED'
  | 'COMMISSION_RECEIVED';

export type FinancePartner = 'Bajaj' | 'Snapmint' | 'HomeCredit' | 'Other';

export interface EMICase {
  id: string;
  customer_name: string;
  customer_phone: string;
  product_category: string;
  loan_amount: number;
  finance_partner: FinancePartner;
  booking_fee: number; // Usually ₹149
  status: EMIStatus;
  commission_earned: number;
  commission_received: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Sync Queue ───
export type SyncOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface SyncQueueItem {
  id?: number;
  table_name: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  synced: boolean;
  retry_count: number;
  created_at: string;
  synced_at: string | null;
}

// ─── Activity Log ───
export interface ActivityLog {
  id: string;
  user_id: string;
  user_name?: string;
  action: string;
  details: string | null;
  created_at: string;
}

// ─── GST Calculation Result ───
export interface GSTBreakdown {
  base_price: number;
  gst_rate: GSTRate;
  gst_amount: number;
  cgst: number;
  sgst: number;
  total: number;
}

export interface InvoiceGSTSummary {
  rate: GSTRate;
  taxable_value: number;
  cgst: number;
  sgst: number;
  total_tax: number;
}

// ─── Dashboard KPIs ───
export interface DashboardKPIs {
  today_revenue: number;
  today_items_sold: number;
  today_transactions: number;
  avg_basket_value: number;
  revenue_change: number; // % vs yesterday
  items_change: number;
  transactions_change: number;
  basket_change: number;
}

export interface HourlySales {
  hour: string;
  revenue: number;
  transactions: number;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  qty_sold: number;
  revenue: number;
}

// ─── AI Types ───
export interface AIQueryRequest {
  question: string;
  context?: string;
}

export interface AIQueryResponse {
  answer: string;
  sources?: string[];
}

export interface AIInsight {
  id: string;
  title: string;
  description: string;
  suggestions: string[];
  generated_at: string;
}

export interface ForecastData {
  date: string;
  day: string;
  predicted_revenue: number;
  confidence: number;
  is_shandy_day: boolean;
}

// ─── Held Bill ───
export interface HeldBill {
  id: string;
  items: CartItem[];
  held_at: string;
  customer_note?: string;
}

// ─── Store Settings ───
export interface StoreSettings {
  store_name: string;
  store_address: string;
  store_gstin: string;
  store_phone: string;
  default_price: number;
  low_stock_default: number;
  thursday_target_multiplier: number;
}
