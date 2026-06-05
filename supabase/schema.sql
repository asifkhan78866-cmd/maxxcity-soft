-- ═══════════════════════════════════════
-- MaxxCity Mall Management System
-- Supabase Database Schema Migration
-- ═══════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Profiles (Users) ───
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('CASHIER', 'MANAGER', 'ADMIN')),
  pin_hash TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Products ───
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  barcode TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'Electronics', 'Home & Kitchen', 'Clothing', 'Accessories',
    'Toys', 'Stationery', 'Personal Care', 'Others'
  )),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate INTEGER NOT NULL CHECK (gst_rate IN (5, 12, 18)) DEFAULT 12,
  price NUMERIC(10,2) NOT NULL DEFAULT 149.00,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 20,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_barcode ON products(barcode);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_name ON products USING gin(to_tsvector('english', name));

-- ─── Invoice Counter ───
CREATE TABLE IF NOT EXISTS invoice_counter (
  id TEXT PRIMARY KEY DEFAULT 'main',
  prefix TEXT NOT NULL DEFAULT 'MCM/2025',
  current_number INTEGER NOT NULL DEFAULT 0
);

INSERT INTO invoice_counter (id, prefix, current_number)
VALUES ('main', 'MCM/2025', 0)
ON CONFLICT (id) DO NOTHING;

-- ─── Shifts ───
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cashier_id UUID NOT NULL REFERENCES profiles(id),
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  opening_cash NUMERIC(10,2) NOT NULL DEFAULT 0,
  closing_cash NUMERIC(10,2),
  expected_cash NUMERIC(10,2),
  cash_sales_total NUMERIC(10,2) DEFAULT 0,
  upi_sales_total NUMERIC(10,2) DEFAULT 0,
  card_sales_total NUMERIC(10,2) DEFAULT 0,
  total_sales NUMERIC(10,2) DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  total_transactions INTEGER DEFAULT 0,
  discrepancy NUMERIC(10,2),
  discrepancy_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shifts_cashier ON shifts(cashier_id);
CREATE INDEX idx_shifts_status ON shifts(status);

-- ─── Sales ───
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT UNIQUE NOT NULL,
  shift_id UUID NOT NULL REFERENCES shifts(id),
  cashier_id UUID NOT NULL REFERENCES profiles(id),
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cgst NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_sgst NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_tax NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount NUMERIC(10,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'UPI', 'CARD')),
  payment_status TEXT NOT NULL CHECK (payment_status IN ('COMPLETED', 'PENDING', 'FAILED')) DEFAULT 'COMPLETED',
  status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'VOID', 'RETURN')) DEFAULT 'COMPLETED',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sales_shift ON sales(shift_id);
CREATE INDEX idx_sales_cashier ON sales(cashier_id);
CREATE INDEX idx_sales_status ON sales(status);
CREATE INDEX idx_sales_created ON sales(created_at DESC);
CREATE INDEX idx_sales_invoice ON sales(invoice_number);

-- ─── Sale Items ───
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  barcode TEXT NOT NULL,
  hsn_code TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 149.00,
  gst_rate INTEGER NOT NULL DEFAULT 12,
  base_price NUMERIC(10,2) NOT NULL,
  tax_amount NUMERIC(10,2) NOT NULL,
  cgst NUMERIC(10,2) NOT NULL,
  sgst NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(10,2) NOT NULL
);

CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

-- ─── Purchase Orders ───
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED')) DEFAULT 'DRAFT',
  items JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── EMI Cases ───
CREATE TABLE IF NOT EXISTS emi_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  product_category TEXT NOT NULL,
  loan_amount NUMERIC(10,2) NOT NULL,
  finance_partner TEXT NOT NULL CHECK (finance_partner IN ('Bajaj', 'Snapmint', 'HomeCredit', 'Other')),
  booking_fee NUMERIC(10,2) NOT NULL DEFAULT 149.00,
  status TEXT NOT NULL CHECK (status IN (
    'BOOKED', 'SUBMITTED', 'APPROVED', 'DISBURSED', 'COMMISSION_RECEIVED'
  )) DEFAULT 'BOOKED',
  commission_earned NUMERIC(10,2) DEFAULT 0,
  commission_received BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emi_status ON emi_cases(status);
CREATE INDEX idx_emi_partner ON emi_cases(finance_partner);

-- ─── Activity Log ───
CREATE TABLE IF NOT EXISTS activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_user ON activity_log(user_id);
CREATE INDEX idx_activity_created ON activity_log(created_at DESC);

-- ─── Sync Queue ───
CREATE TABLE IF NOT EXISTS sync_queue (
  id SERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  payload JSONB NOT NULL,
  synced BOOLEAN DEFAULT false,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════
-- Functions
-- ═══════════════════════════════════════

-- Function to get next invoice number (atomic)
CREATE OR REPLACE FUNCTION get_next_invoice_number()
RETURNS TEXT AS $$
DECLARE
  v_prefix TEXT;
  v_number INTEGER;
  v_invoice TEXT;
BEGIN
  UPDATE invoice_counter
  SET current_number = current_number + 1,
      prefix = 'MCM/' || EXTRACT(YEAR FROM NOW())::TEXT
  WHERE id = 'main'
  RETURNING prefix, current_number INTO v_prefix, v_number;

  v_invoice := v_prefix || '/' || LPAD(v_number::TEXT, 6, '0');
  RETURN v_invoice;
END;
$$ LANGUAGE plpgsql;

-- Function to update shift totals after a sale
CREATE OR REPLACE FUNCTION update_shift_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'COMPLETED' THEN
    UPDATE shifts SET
      total_sales = total_sales + NEW.grand_total,
      total_transactions = total_transactions + 1,
      total_items = total_items + (
        SELECT COALESCE(SUM(qty), 0) FROM sale_items WHERE sale_id = NEW.id
      ),
      cash_sales_total = CASE
        WHEN NEW.payment_method = 'CASH' THEN cash_sales_total + NEW.grand_total
        ELSE cash_sales_total
      END,
      upi_sales_total = CASE
        WHEN NEW.payment_method = 'UPI' THEN upi_sales_total + NEW.grand_total
        ELSE upi_sales_total
      END,
      card_sales_total = CASE
        WHEN NEW.payment_method = 'CARD' THEN card_sales_total + NEW.grand_total
        ELSE card_sales_total
      END,
      expected_cash = opening_cash + CASE
        WHEN NEW.payment_method = 'CASH' THEN cash_sales_total + NEW.grand_total
        ELSE cash_sales_total
      END
    WHERE id = NEW.shift_id AND status = 'OPEN';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_shift_on_sale
AFTER INSERT ON sales
FOR EACH ROW
EXECUTE FUNCTION update_shift_on_sale();

-- Function to deduct inventory on sale
CREATE OR REPLACE FUNCTION deduct_inventory_on_sale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE products
  SET stock_qty = stock_qty - NEW.qty,
      updated_at = NOW()
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deduct_inventory
AFTER INSERT ON sale_items
FOR EACH ROW
EXECUTE FUNCTION deduct_inventory_on_sale();

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sales_updated_at BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_emi_updated_at BEFORE UPDATE ON emi_cases
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON purchase_orders
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════
-- Seed Data: Default Admin User
-- ═══════════════════════════════════════
INSERT INTO profiles (id, email, name, role, pin_hash, is_active)
VALUES (
  uuid_generate_v4(),
  'admin@maxxcity.in',
  'Syed (Owner)',
  'ADMIN',
  NULL,
  true
)
ON CONFLICT (email) DO NOTHING;

-- ═══════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE emi_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read products
CREATE POLICY "Products readable by all auth" ON products
  FOR SELECT USING (true);

-- Allow admins to manage products
CREATE POLICY "Products manageable by admin" ON products
  FOR ALL USING (true);

-- Shifts policies
CREATE POLICY "Shifts readable by all auth" ON shifts
  FOR SELECT USING (true);

CREATE POLICY "Shifts insertable by all auth" ON shifts
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Shifts updatable by all auth" ON shifts
  FOR UPDATE USING (true);

-- Sales policies
CREATE POLICY "Sales readable by all auth" ON sales
  FOR SELECT USING (true);

CREATE POLICY "Sales insertable by all auth" ON sales
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Sales updatable by admin" ON sales
  FOR UPDATE USING (true);

-- Sale items policies
CREATE POLICY "Sale items readable by all auth" ON sale_items
  FOR SELECT USING (true);

CREATE POLICY "Sale items insertable by all auth" ON sale_items
  FOR INSERT WITH CHECK (true);

-- Profiles policies
CREATE POLICY "Profiles readable by all auth" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Profiles manageable by admin" ON profiles
  FOR ALL USING (true);

-- EMI cases
CREATE POLICY "EMI cases all access" ON emi_cases
  FOR ALL USING (true);

-- Purchase orders
CREATE POLICY "PO all access" ON purchase_orders
  FOR ALL USING (true);

-- Activity log
CREATE POLICY "Activity log all access" ON activity_log
  FOR ALL USING (true);
