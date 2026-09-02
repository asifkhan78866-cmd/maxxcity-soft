// ═══════════════════════════════════════
// MaxxCity Mall Management System
// TypeScript Type Definitions
// ═══════════════════════════════════════

// ─── User Roles ───
export type UserRole = 'CASHIER' | 'MANAGER' | 'ADMIN';

export interface Profile {
  id: string;
  email: string | null;
  name: string;
  phone: string | null;
  role: UserRole;
  staff_code: string | null;
  /** Present only inside the server. Never sent to a client. */
  pin_hash?: string | null;
  /** Present only inside the server. Never sent to a client. */
  password_hash?: string | null;
  is_active: boolean;
  last_login_at: string | null;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
}

/** What the client is allowed to know about a staff member. */
export interface StaffSummary {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  staff_code: string | null;
  is_active: boolean;
  last_login_at: string | null;
  isLocked: boolean;
  hasPin: boolean;
  hasPassword: boolean;
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
  /**
   * Customer selling price, GST-inclusive.
   * Always DEFAULT_PRODUCT_PRICE from lib/config/pricing.ts — never hardcode.
   */
  price: number;
  /**
   * Supplier cost. A COMPLETELY SEPARATE value from `price`; null when the
   * supplier cost has not been captured yet. Margin reports skip null costs
   * rather than assuming one.
   */
  cost_price?: number | null;
  supplier_id?: string | null;
  stock_qty: number;
  low_stock_threshold: number;
  allow_negative_stock?: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Cart (internal cashier view) ───
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
  base_price: number; // Taxable value for the line
  tax_amount: number; // Total tax for the line
  cgst: number;
  sgst: number;
  line_total: number; // qty × unit_price
  stock_qty: number; // Stock known at the time the line was added
}

// ─── Sales ───
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD';
export type RefundMethod = PaymentMethod | 'STORE_CREDIT';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
export type SaleStatus = 'COMPLETED' | 'VOID' | 'RETURNED' | 'PARTIALLY_RETURNED';

export interface Sale {
  id: string;
  invoice_number: string;
  client_sale_id: string | null;
  terminal_id: string | null;
  shift_id: string;
  cashier_id: string;
  cashier_name?: string;
  customer_id: string | null;
  subtotal: number; // Sum of taxable values
  total_cgst: number;
  total_sgst: number;
  total_tax: number;
  discount: number;
  grand_total: number;
  total_items: number;
  amount_tendered: number | null;
  change_due: number | null;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  status: SaleStatus;
  is_offline_origin: boolean;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  items?: SaleItem[];
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
  qty_returned: number;
  unit_price: number;
  gst_rate: GSTRate;
  base_price: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  line_total: number;
  line_discount: number;
  /** Supplier cost snapshot at time of sale — powers margin reporting. */
  cost_price: number | null;
}

// ─── Payments ───
export interface Payment {
  id: string;
  sale_id: string | null;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  provider: string | null;
  provider_payment_id: string | null;
  provider_order_id: string | null;
  /** Set only when the provider actually confirms the payment. */
  verified_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

// ─── Returns ───
export type ReturnStatus = 'PENDING' | 'COMPLETED' | 'REJECTED';

export interface SaleReturn {
  id: string;
  return_number: string;
  original_sale_id: string;
  shift_id: string | null;
  processed_by: string;
  refund_amount: number;
  refund_method: RefundMethod;
  total_items: number;
  total_cgst: number;
  total_sgst: number;
  reason: string;
  status: ReturnStatus;
  restock: boolean;
  items?: ReturnItem[];
  created_at: string;
}

export interface ReturnItem {
  id: string;
  return_id: string;
  sale_item_id: string;
  product_id: string;
  product_name: string;
  qty: number;
  unit_price: number;
  refund_amount: number;
  cgst: number;
  sgst: number;
}

// ─── Stock Movements ───
export type StockMovementType =
  | 'OPENING_STOCK'
  | 'PURCHASE'
  | 'SALE'
  | 'RETURN'
  | 'MANUAL_ADJUSTMENT'
  | 'DAMAGE'
  | 'LOSS'
  | 'TRANSFER'
  | 'VOID_REVERSAL';

export interface StockMovement {
  id: string;
  product_id: string;
  movement_type: StockMovementType;
  /** Signed: negative removes stock, positive adds it. */
  quantity: number;
  before_qty: number;
  after_qty: number;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── Shifts ───
export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface Shift {
  id: string;
  cashier_id: string;
  cashier_name?: string;
  terminal_id: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  cash_sales_total: number;
  upi_sales_total: number;
  card_sales_total: number;
  total_sales: number;
  total_items: number;
  total_transactions: number;
  total_refunds: number;
  total_voids: number;
  discrepancy: number | null;
  discrepancy_reason: string | null;
  status: ShiftStatus;
  created_at: string;
}

// ─── Customers ───
export interface Customer {
  id: string;
  phone: string;
  name: string | null;
  total_visits: number;
  total_spend: number;
  last_purchase_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Suppliers & Purchase Orders ───
export type POStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED';

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gstin: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_name: string;
  barcode: string;
  qty_ordered: number;
  qty_received: number;
  /** Supplier cost — NOT the customer selling price. */
  unit_cost: number;
  line_cost: number;
}

export interface PurchaseOrder {
  id: string;
  po_number: string | null;
  supplier_id: string | null;
  supplier_name?: string;
  status: POStatus;
  total_cost: number;
  notes: string | null;
  expected_at: string | null;
  received_at: string | null;
  created_by: string;
  items?: PurchaseOrderItem[];
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
  /**
   * Finance-case booking fee. An INDEPENDENT business value configured via
   * EMI_BOOKING_FEE — it has no relationship to the product selling price and
   * must never be changed as a side effect of a pricing change.
   */
  booking_fee: number;
  status: EMIStatus;
  commission_earned: number;
  commission_received: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Offline Sync ───
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
  user_id: string | null;
  user_name?: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ─── GST ───
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

// ─── Reporting ───
export interface DashboardKPIs {
  revenue: number;
  transactions: number;
  itemsSold: number;
  avgBasket: number;
  revenueChange: number;
  transactionsChange: number;
  itemsChange: number;
  basketChange: number;
}

export interface HourlySales {
  hour: number;
  label: string;
  revenue: number;
  transactions: number;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  qty: number;
  revenue: number;
}

// ─── AI ───
export interface AIQueryRequest {
  question: string;
  context?: string;
}

export interface AIQueryResponse {
  answer: string;
  chart_type?: string | null;
  sources?: string[];
}

export interface AIInsight {
  id: string;
  title: string;
  description: string;
  suggestions: string[];
  generated_at: string;
}

/**
 * A forecast value. `basis` states how it was produced so an estimate is
 * never presented to the user as an observed fact.
 */
export interface ForecastData {
  date: string;
  day: string;
  predicted_revenue: number;
  confidence_low: number;
  confidence_high: number;
  basis: 'observed' | 'estimated' | 'assumed';
  sample_days: number;
  is_shandy_day: boolean;
}

// ─── Held Bills ───
export interface HeldBill {
  id: string;
  label: string;
  items: CartItem[];
  held_at: string;
  held_by: string | null;
  customer_note?: string;
  customer_phone?: string;
}

// ─── Store Settings ───
export interface StoreSettings {
  store_name: string;
  store_address: string;
  store_city: string;
  store_gstin: string;
  store_phone: string;
  /** Read-only mirror of DEFAULT_PRODUCT_PRICE. */
  default_product_price: number;
  low_stock_default: number;
  allow_negative_stock: boolean;
  emi_booking_fee: number;
}

// ─── API envelope ───
export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: string; details?: unknown };
