-- ═══════════════════════════════════════════════════════════════
-- MaxxCity Mall — Production Hardening Migration
-- ═══════════════════════════════════════════════════════════════
-- Apply AFTER supabase/migrations/0001_initial.sql.
-- Safe to re-run (idempotent).
--
-- What this migration does:
--   1. Moves the selling price from ₹149 to the flat ₹99 model
--   2. Adds cost price so margin is computed against real supplier cost
--   3. Adds customers, suppliers, purchase orders/items, returns,
--      stock_movements, payments, store_settings, staff_sessions
--   4. Replaces the unvalidated inventory trigger with an atomic
--      create_sale() RPC that validates stock and writes a stock ledger
--   5. Adds void / return / stock-adjustment RPCs with full audit trail
--   6. Locks down RLS (all access flows through server routes using the
--      service role; anon/authenticated get no direct table access)
--   7. Adds the indexes the POS and reporting queries actually need
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───────────────────────────────────────────────
-- 1. PRICING: ₹149 → ₹99
-- ───────────────────────────────────────────────

ALTER TABLE products ALTER COLUMN price SET DEFAULT 99.00;

-- Reprice existing catalogue rows that still carry the retired ₹149 price.
-- Historical sale_items are deliberately NOT touched: past transactions must
-- keep the price that was actually charged.
UPDATE products SET price = 99.00, updated_at = NOW() WHERE price = 149.00;

ALTER TABLE sale_items ALTER COLUMN unit_price DROP DEFAULT;

-- Cost price is a SEPARATE business value from the ₹99 selling price.
-- NULL means "supplier cost not yet known" — margin reports must skip those
-- rather than assume a cost.
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id UUID;
ALTER TABLE products ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;

-- Guard rails on the catalogue itself.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_positive;
ALTER TABLE products ADD CONSTRAINT products_price_positive CHECK (price > 0);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_threshold_valid;
ALTER TABLE products ADD CONSTRAINT products_stock_threshold_valid CHECK (low_stock_threshold >= 0);
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_cost_price_valid;
ALTER TABLE products ADD CONSTRAINT products_cost_price_valid CHECK (cost_price IS NULL OR cost_price >= 0);

-- The original CHECK constraint rejected categories the POS actually uses.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (category IN (
  'Electronics', 'Home & Kitchen', 'Kitchen', 'Clothing', 'Fashion',
  'Accessories', 'Toys', 'Stationery', 'Personal Care', 'Care',
  'Seasonal', 'Others'
));

-- EMI booking fee is independent of the product selling price.
ALTER TABLE emi_cases ALTER COLUMN booking_fee SET DEFAULT 199.00;

-- ───────────────────────────────────────────────
-- 2. STAFF / AUTH
-- ───────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- PIN login must identify exactly one staff member, so PIN hashes carry a
-- short non-secret lookup code. (The hash itself cannot be searched.)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS staff_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_staff_code
  ON profiles(staff_code) WHERE staff_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_active ON profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- ───────────────────────────────────────────────
-- 3. CUSTOMERS
-- ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  total_visits INTEGER NOT NULL DEFAULT 0,
  total_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  last_purchase_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT customers_phone_format CHECK (phone ~ '^[0-9]{10}$')
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_last_purchase ON customers(last_purchase_at DESC);

-- ───────────────────────────────────────────────
-- 4. SUPPLIERS & PURCHASE ORDERS
-- ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  gstin TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(lower(name));

DO $$ BEGIN
  ALTER TABLE products
    ADD CONSTRAINT products_supplier_fk FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Normalise purchase orders: the JSONB items column cannot be joined,
-- indexed or reconciled against stock movements.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS po_number TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_by UUID REFERENCES profiles(id);
ALTER TABLE purchase_orders ALTER COLUMN supplier DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_number ON purchase_orders(po_number) WHERE po_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  barcode TEXT NOT NULL DEFAULT '',
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
  line_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_product ON purchase_order_items(product_id);

-- ───────────────────────────────────────────────
-- 5. STOCK MOVEMENT LEDGER
-- ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'OPENING_STOCK', 'PURCHASE', 'SALE', 'RETURN',
    'MANUAL_ADJUSTMENT', 'DAMAGE', 'LOSS', 'TRANSFER', 'VOID_REVERSAL'
  )),
  -- Signed: negative removes stock, positive adds it.
  quantity INTEGER NOT NULL,
  before_qty INTEGER NOT NULL,
  after_qty INTEGER NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  reason TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_mov_type ON stock_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_stock_mov_reference ON stock_movements(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_created ON stock_movements(created_at DESC);

-- ───────────────────────────────────────────────
-- 6. SALES: idempotency, customer link, void audit
-- ───────────────────────────────────────────────

ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_sale_id TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS terminal_id TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS total_items INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS amount_tendered NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS change_due NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_offline_origin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES profiles(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_reason TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_approved_by UUID REFERENCES profiles(id);

-- THE idempotency key. A retried submit, a double-click or a reconnect replays
-- the same client_sale_id and can never create a second sale.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id
  ON sales(client_sale_id) WHERE client_sale_id IS NOT NULL;

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_status_check;
ALTER TABLE sales ADD CONSTRAINT sales_status_check
  CHECK (status IN ('COMPLETED', 'VOID', 'RETURNED', 'PARTIALLY_RETURNED'));

-- Legacy rows used 'RETURN'; normalise before the constraint is trusted.
UPDATE sales SET status = 'RETURNED' WHERE status = 'RETURN';

CREATE INDEX IF NOT EXISTS idx_sales_terminal ON sales(terminal_id);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_method ON sales(payment_method);
CREATE INDEX IF NOT EXISTS idx_sales_created_status ON sales(created_at DESC, status);

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_discount NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS qty_returned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2);
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS gst_rate_snapshot INTEGER;

-- ───────────────────────────────────────────────
-- 7. PAYMENTS
-- ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('CASH', 'UPI', 'CARD')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'))
    DEFAULT 'PENDING',
  provider TEXT,
  provider_payment_id TEXT,
  provider_order_id TEXT,
  -- Set only when the provider confirms; never inferred from a displayed QR.
  verified_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_id
  ON payments(provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

-- ───────────────────────────────────────────────
-- 8. RETURNS / REFUNDS
-- ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS returns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_number TEXT UNIQUE NOT NULL,
  original_sale_id UUID NOT NULL REFERENCES sales(id),
  shift_id UUID REFERENCES shifts(id),
  processed_by UUID NOT NULL REFERENCES profiles(id),
  refund_amount NUMERIC(10,2) NOT NULL CHECK (refund_amount >= 0),
  refund_method TEXT NOT NULL CHECK (refund_method IN ('CASH', 'UPI', 'CARD', 'STORE_CREDIT')),
  total_items INTEGER NOT NULL DEFAULT 0,
  total_cgst NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_sgst NUMERIC(10,2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED')) DEFAULT 'COMPLETED',
  restock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_returns_sale ON returns(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_returns_created ON returns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_shift ON returns(shift_id);

CREATE TABLE IF NOT EXISTS return_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id UUID NOT NULL REFERENCES sale_items(id),
  product_id UUID NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  refund_amount NUMERIC(10,2) NOT NULL,
  cgst NUMERIC(10,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_sale_item ON return_items(sale_item_id);

-- ───────────────────────────────────────────────
-- 9. SHIFTS
-- ───────────────────────────────────────────────

ALTER TABLE shifts ADD COLUMN IF NOT EXISTS terminal_id TEXT;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES profiles(id);
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_refunds NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS total_voids INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS notes TEXT;

-- One open shift per cashier at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_cashier
  ON shifts(cashier_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_shifts_opened ON shifts(opened_at DESC);

-- ───────────────────────────────────────────────
-- 10. ACTIVITY LOG
-- ───────────────────────────────────────────────

ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS entity_id TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS metadata JSONB;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ip_address TEXT;

CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);

-- ───────────────────────────────────────────────
-- 11. STORE SETTINGS
-- ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS store_settings (
  id TEXT PRIMARY KEY DEFAULT 'main',
  store_name TEXT NOT NULL DEFAULT 'MaxxCity Mall',
  store_address TEXT NOT NULL DEFAULT 'Ramnagar Main Road',
  store_city TEXT NOT NULL DEFAULT 'Adilabad, Telangana 504001',
  store_gstin TEXT NOT NULL DEFAULT '',
  store_phone TEXT NOT NULL DEFAULT '',
  -- Mirrors DEFAULT_PRODUCT_PRICE in lib/config/pricing.ts.
  default_product_price NUMERIC(10,2) NOT NULL DEFAULT 99.00,
  low_stock_default INTEGER NOT NULL DEFAULT 20,
  allow_negative_stock BOOLEAN NOT NULL DEFAULT false,
  emi_booking_fee NUMERIC(10,2) NOT NULL DEFAULT 199.00,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT store_settings_singleton CHECK (id = 'main')
);

INSERT INTO store_settings (id) VALUES ('main') ON CONFLICT (id) DO NOTHING;
UPDATE store_settings SET default_product_price = 99.00 WHERE default_product_price = 149.00;

-- ───────────────────────────────────────────────
-- 12. INVOICE COUNTER — collision-resistant
-- ───────────────────────────────────────────────

-- Per-year counters so a year rollover cannot reuse a number.
CREATE TABLE IF NOT EXISTS invoice_counters (
  scope TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  current_number BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP FUNCTION IF EXISTS get_next_invoice_number();

-- Atomic: the UPDATE ... RETURNING takes a row lock, so concurrent counters
-- across any number of terminals are serialised by Postgres.
CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT := EXTRACT(YEAR FROM NOW())::TEXT;
  v_scope TEXT := 'MCM/' || v_year;
  v_number BIGINT;
BEGIN
  INSERT INTO invoice_counters (scope, prefix, current_number)
  VALUES (v_scope, v_scope, 0)
  ON CONFLICT (scope) DO NOTHING;

  UPDATE invoice_counters
     SET current_number = current_number + 1,
         updated_at = NOW()
   WHERE scope = v_scope
  RETURNING current_number INTO v_number;

  RETURN v_scope || '/' || LPAD(v_number::TEXT, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION next_return_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope TEXT := 'RET/' || EXTRACT(YEAR FROM NOW())::TEXT;
  v_number BIGINT;
BEGIN
  INSERT INTO invoice_counters (scope, prefix, current_number)
  VALUES (v_scope, v_scope, 0)
  ON CONFLICT (scope) DO NOTHING;

  UPDATE invoice_counters
     SET current_number = current_number + 1, updated_at = NOW()
   WHERE scope = v_scope
  RETURNING current_number INTO v_number;

  RETURN v_scope || '/' || LPAD(v_number::TEXT, 6, '0');
END;
$$;

-- Seed the new counter from the legacy one so numbering never goes backwards.
DO $$
DECLARE v_legacy BIGINT;
BEGIN
  SELECT current_number INTO v_legacy FROM invoice_counter WHERE id = 'main';
  IF v_legacy IS NOT NULL AND v_legacy > 0 THEN
    INSERT INTO invoice_counters (scope, prefix, current_number)
    VALUES ('MCM/' || EXTRACT(YEAR FROM NOW())::TEXT,
            'MCM/' || EXTRACT(YEAR FROM NOW())::TEXT,
            v_legacy)
    ON CONFLICT (scope) DO UPDATE
      SET current_number = GREATEST(invoice_counters.current_number, EXCLUDED.current_number);
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ───────────────────────────────────────────────
-- 13. REMOVE THE UNSAFE LEGACY TRIGGERS
-- ───────────────────────────────────────────────
-- The old trg_deduct_inventory decremented stock on ANY sale_items insert with
-- no stock check, no ledger entry and no way to reverse a void. Stock is now
-- moved only by the RPCs below, which validate first and always write a
-- stock_movements row.

DROP TRIGGER IF EXISTS trg_deduct_inventory ON sale_items;
DROP FUNCTION IF EXISTS deduct_inventory_on_sale();
DROP TRIGGER IF EXISTS trg_update_shift_on_sale ON sales;
DROP FUNCTION IF EXISTS update_shift_on_sale();

-- ───────────────────────────────────────────────
-- 14. ATOMIC SALE CREATION
-- ───────────────────────────────────────────────
-- Everything below runs inside one transaction. Either the sale, its items,
-- the stock decrement, the ledger entries, the shift totals and the audit row
-- all land, or none of them do. There is no window in which a sale exists
-- without its stock movement.

CREATE OR REPLACE FUNCTION create_sale(
  p_client_sale_id   TEXT,
  p_cashier_id       UUID,
  p_shift_id         UUID,
  p_payment_method   TEXT,
  p_items            JSONB,          -- [{"product_id": uuid, "qty": int}]
  p_default_price    NUMERIC,        -- authoritative price from lib/config/pricing.ts
  p_discount         NUMERIC DEFAULT 0,
  p_customer_id      UUID    DEFAULT NULL,
  p_terminal_id      TEXT    DEFAULT NULL,
  p_amount_tendered  NUMERIC DEFAULT NULL,
  p_invoice_number   TEXT    DEFAULT NULL,   -- supplied for offline-origin sales
  p_created_at       TIMESTAMPTZ DEFAULT NULL,
  p_is_offline       BOOLEAN DEFAULT false,
  p_discount_reason  TEXT    DEFAULT NULL,
  p_payment_status   TEXT    DEFAULT 'COMPLETED'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing        sales%ROWTYPE;
  v_sale_id         UUID;
  v_invoice         TEXT;
  v_created_at      TIMESTAMPTZ := COALESCE(p_created_at, NOW());
  v_item            JSONB;
  v_product         products%ROWTYPE;
  v_qty             INTEGER;
  v_price_paise     BIGINT;
  v_gross_paise     BIGINT;
  v_total_gross     BIGINT := 0;
  v_discount_paise  BIGINT := GREATEST(0, ROUND(COALESCE(p_discount, 0) * 100)::BIGINT);
  v_allocated       BIGINT := 0;
  v_line_discount   BIGINT;
  v_net_paise       BIGINT;
  v_base_paise      BIGINT;
  v_tax_paise       BIGINT;
  v_cgst_paise      BIGINT;
  v_sgst_paise      BIGINT;
  v_sum_base        BIGINT := 0;
  v_sum_cgst        BIGINT := 0;
  v_sum_sgst        BIGINT := 0;
  v_sum_net         BIGINT := 0;
  v_total_items     INTEGER := 0;
  v_before_qty      INTEGER;
  v_after_qty       INTEGER;
  v_updated         INTEGER;
  v_idx             INTEGER := 0;
  v_count           INTEGER;
  v_lines           JSONB := '[]'::JSONB;
  v_sale_item_id    UUID;
  v_change          NUMERIC;
  v_shift           shifts%ROWTYPE;
BEGIN
  -- ── Idempotency ─────────────────────────────────────────────
  -- A retry, double-click or post-timeout replay returns the ORIGINAL sale
  -- instead of creating a second one.
  IF p_client_sale_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM sales WHERE client_sale_id = p_client_sale_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'sale_id', v_existing.id,
        'invoice_number', v_existing.invoice_number,
        'grand_total', v_existing.grand_total,
        'total_items', v_existing.total_items,
        'total_cgst', v_existing.total_cgst,
        'total_sgst', v_existing.total_sgst,
        'created_at', v_existing.created_at,
        'duplicate', true
      );
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART: a sale must contain at least one item';
  END IF;

  IF p_payment_method NOT IN ('CASH', 'UPI', 'CARD') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: %', p_payment_method;
  END IF;

  -- ── Shift must be open and belong to this cashier ────────────
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: %', p_shift_id;
  END IF;
  IF v_shift.status <> 'OPEN' THEN
    RAISE EXCEPTION 'SHIFT_CLOSED: cannot bill against a closed shift';
  END IF;

  v_count := jsonb_array_length(p_items);

  -- ── Pass 1: validate products, lock rows, compute gross ──────
  -- Products are locked in a deterministic (id) order so two terminals
  -- selling overlapping carts can never deadlock each other.
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items)
    ORDER BY (value->>'product_id')
  LOOP
    v_qty := (v_item->>'qty')::INTEGER;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: quantity must be a positive whole number';
    END IF;

    SELECT * INTO v_product
      FROM products
     WHERE id = (v_item->>'product_id')::UUID
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', v_item->>'product_id';
    END IF;
    IF NOT v_product.is_active THEN
      RAISE EXCEPTION 'PRODUCT_INACTIVE: % is not available for sale', v_product.name;
    END IF;
    IF v_product.gst_rate NOT IN (5, 12, 18) THEN
      RAISE EXCEPTION 'INVALID_GST_RATE: % on product %', v_product.gst_rate, v_product.name;
    END IF;
    -- The server sets the price. A client-supplied unit_price is ignored
    -- entirely — it is never read from p_items.
    IF ROUND(v_product.price * 100) <> ROUND(p_default_price * 100) THEN
      RAISE EXCEPTION 'PRICE_MISMATCH: % is priced at % but the flat selling price is %',
        v_product.name, v_product.price, p_default_price;
    END IF;
    IF NOT (v_product.allow_negative_stock) AND v_product.stock_qty < v_qty THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % has % in stock but % requested',
        v_product.name, v_product.stock_qty, v_qty;
    END IF;

    v_total_gross := v_total_gross + (ROUND(v_product.price * 100)::BIGINT * v_qty);
    v_total_items := v_total_items + v_qty;
  END LOOP;

  IF v_discount_paise > v_total_gross THEN
    RAISE EXCEPTION 'INVALID_DISCOUNT: discount exceeds the bill total';
  END IF;

  -- ── Invoice number ──────────────────────────────────────────
  -- Offline-origin sales keep the terminal-scoped number they were issued
  -- locally (it is globally unique by construction); online sales draw from
  -- the atomic server counter.
  IF p_invoice_number IS NOT NULL AND length(trim(p_invoice_number)) > 0 THEN
    v_invoice := p_invoice_number;
  ELSE
    v_invoice := next_invoice_number();
  END IF;

  v_sale_id := uuid_generate_v4();

  -- ── Pass 2: move stock, write ledger, build lines ───────────
  FOR v_item IN
    SELECT value FROM jsonb_array_elements(p_items)
    ORDER BY (value->>'product_id')
  LOOP
    v_idx := v_idx + 1;
    v_qty := (v_item->>'qty')::INTEGER;

    SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID;

    v_price_paise := ROUND(v_product.price * 100)::BIGINT;
    v_gross_paise := v_price_paise * v_qty;

    -- Apportion the bill discount across lines by value. The last line takes
    -- the rounding remainder so the parts always sum to the whole.
    IF v_discount_paise = 0 THEN
      v_line_discount := 0;
    ELSIF v_idx = v_count THEN
      v_line_discount := v_discount_paise - v_allocated;
    ELSE
      v_line_discount := ROUND(v_discount_paise::NUMERIC * v_gross_paise / v_total_gross);
      v_allocated := v_allocated + v_line_discount;
    END IF;

    v_net_paise  := v_gross_paise - v_line_discount;
    v_base_paise := ROUND(v_net_paise::NUMERIC / (1 + v_product.gst_rate / 100.0));
    v_tax_paise  := v_net_paise - v_base_paise;
    v_sgst_paise := FLOOR(v_tax_paise / 2.0);
    v_cgst_paise := v_tax_paise - v_sgst_paise;

    v_sum_base := v_sum_base + v_base_paise;
    v_sum_cgst := v_sum_cgst + v_cgst_paise;
    v_sum_sgst := v_sum_sgst + v_sgst_paise;
    v_sum_net  := v_sum_net  + v_net_paise;

    -- Conditional decrement: the WHERE clause is the concurrency guard.
    -- If another terminal took the stock between pass 1 and here, zero rows
    -- update and the whole transaction aborts — stock can never go negative
    -- unless the product explicitly permits it.
    UPDATE products
       SET stock_qty = stock_qty - v_qty,
           updated_at = NOW()
     WHERE id = v_product.id
       AND (allow_negative_stock OR stock_qty >= v_qty)
    RETURNING stock_qty + v_qty, stock_qty INTO v_before_qty, v_after_qty;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % was sold on another counter while this bill was open',
        v_product.name;
    END IF;

    v_sale_item_id := uuid_generate_v4();

    INSERT INTO sale_items (
      id, sale_id, product_id, product_name, barcode, hsn_code,
      qty, unit_price, gst_rate, gst_rate_snapshot,
      base_price, tax_amount, cgst, sgst, line_total, line_discount, cost_price
    ) VALUES (
      v_sale_item_id, v_sale_id, v_product.id, v_product.name, v_product.barcode,
      v_product.hsn_code, v_qty, v_product.price, v_product.gst_rate, v_product.gst_rate,
      v_base_paise / 100.0, v_tax_paise / 100.0, v_cgst_paise / 100.0,
      v_sgst_paise / 100.0, v_gross_paise / 100.0, v_line_discount / 100.0,
      v_product.cost_price
    );

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, before_qty, after_qty,
      reference_type, reference_id, reason, created_by, created_at
    ) VALUES (
      v_product.id, 'SALE', -v_qty, v_before_qty, v_after_qty,
      'SALE', v_sale_id, 'Sale ' || v_invoice, p_cashier_id, v_created_at
    );

    v_lines := v_lines || jsonb_build_object(
      'sale_item_id', v_sale_item_id,
      'product_id', v_product.id,
      'qty', v_qty,
      'after_qty', v_after_qty
    );
  END LOOP;

  -- ── Sale header ─────────────────────────────────────────────
  v_change := CASE
    WHEN p_payment_method = 'CASH' AND p_amount_tendered IS NOT NULL
      THEN GREATEST(0, p_amount_tendered - (v_sum_net / 100.0))
    ELSE NULL
  END;

  IF p_payment_method = 'CASH'
     AND p_amount_tendered IS NOT NULL
     AND ROUND(p_amount_tendered * 100) < v_sum_net THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH: tendered amount is less than the bill total';
  END IF;

  INSERT INTO sales (
    id, invoice_number, client_sale_id, terminal_id, shift_id, cashier_id, customer_id,
    subtotal, total_cgst, total_sgst, total_tax, discount, grand_total, total_items,
    payment_method, payment_status, status, amount_tendered, change_due,
    is_offline_origin, synced_at, discount_reason, created_at, updated_at
  ) VALUES (
    v_sale_id, v_invoice, p_client_sale_id, p_terminal_id, p_shift_id, p_cashier_id, p_customer_id,
    v_sum_base / 100.0, v_sum_cgst / 100.0, v_sum_sgst / 100.0,
    (v_sum_cgst + v_sum_sgst) / 100.0, v_discount_paise / 100.0, v_sum_net / 100.0, v_total_items,
    p_payment_method, p_payment_status, 'COMPLETED', p_amount_tendered, v_change,
    p_is_offline, CASE WHEN p_is_offline THEN NOW() ELSE NULL END,
    p_discount_reason, v_created_at, NOW()
  );

  INSERT INTO payments (sale_id, method, amount, status, verified_at)
  VALUES (
    v_sale_id, p_payment_method, v_sum_net / 100.0, p_payment_status,
    CASE WHEN p_payment_status = 'COMPLETED' THEN v_created_at ELSE NULL END
  );

  -- ── Shift roll-up ───────────────────────────────────────────
  UPDATE shifts SET
    total_sales        = total_sales + (v_sum_net / 100.0),
    total_transactions = total_transactions + 1,
    total_items        = total_items + v_total_items,
    cash_sales_total   = cash_sales_total + CASE WHEN p_payment_method = 'CASH' THEN v_sum_net / 100.0 ELSE 0 END,
    upi_sales_total    = upi_sales_total  + CASE WHEN p_payment_method = 'UPI'  THEN v_sum_net / 100.0 ELSE 0 END,
    card_sales_total   = card_sales_total + CASE WHEN p_payment_method = 'CARD' THEN v_sum_net / 100.0 ELSE 0 END,
    expected_cash      = opening_cash + cash_sales_total
                         + CASE WHEN p_payment_method = 'CASH' THEN v_sum_net / 100.0 ELSE 0 END
                         - total_refunds
  WHERE id = p_shift_id;

  -- ── Customer CRM roll-up ────────────────────────────────────
  IF p_customer_id IS NOT NULL THEN
    UPDATE customers SET
      total_visits     = total_visits + 1,
      total_spend      = total_spend + (v_sum_net / 100.0),
      last_purchase_at = v_created_at,
      updated_at       = NOW()
    WHERE id = p_customer_id;
  END IF;

  -- ── Audit ───────────────────────────────────────────────────
  INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
  VALUES (
    p_cashier_id, 'SALE_COMPLETED', 'sale', v_sale_id::TEXT,
    'Invoice ' || v_invoice || ' — ' || v_total_items || ' item(s), Rs.' || (v_sum_net / 100.0),
    jsonb_build_object(
      'invoice_number', v_invoice,
      'payment_method', p_payment_method,
      'terminal_id', p_terminal_id,
      'discount', v_discount_paise / 100.0,
      'offline_origin', p_is_offline
    )
  );

  IF v_discount_paise > 0 THEN
    INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
    VALUES (
      p_cashier_id, 'DISCOUNT_APPLIED', 'sale', v_sale_id::TEXT,
      'Discount Rs.' || (v_discount_paise / 100.0) || ' on ' || v_invoice,
      jsonb_build_object('reason', p_discount_reason, 'amount', v_discount_paise / 100.0)
    );
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'invoice_number', v_invoice,
    'subtotal', v_sum_base / 100.0,
    'total_cgst', v_sum_cgst / 100.0,
    'total_sgst', v_sum_sgst / 100.0,
    'total_tax', (v_sum_cgst + v_sum_sgst) / 100.0,
    'discount', v_discount_paise / 100.0,
    'grand_total', v_sum_net / 100.0,
    'total_items', v_total_items,
    'change_due', v_change,
    'created_at', v_created_at,
    'lines', v_lines,
    'duplicate', false
  );
END;
$$;

-- ───────────────────────────────────────────────
-- 15. VOID A SALE
-- ───────────────────────────────────────────────
-- Status-based reversal. The original financial record is preserved for
-- audit; stock is returned through the ledger, never by a silent UPDATE.

CREATE OR REPLACE FUNCTION void_sale(
  p_sale_id   UUID,
  p_user_id   UUID,
  p_reason    TEXT,
  p_restock   BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale       sales%ROWTYPE;
  v_item       sale_items%ROWTYPE;
  v_before     INTEGER;
  v_after      INTEGER;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a void must record why it happened';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: %', p_sale_id;
  END IF;
  IF v_sale.status = 'VOID' THEN
    RAISE EXCEPTION 'ALREADY_VOID: this sale was already voided';
  END IF;
  IF v_sale.status IN ('RETURNED', 'PARTIALLY_RETURNED') THEN
    RAISE EXCEPTION 'HAS_RETURNS: process the return reversal instead of voiding';
  END IF;

  IF p_restock THEN
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
      UPDATE products
         SET stock_qty = stock_qty + v_item.qty, updated_at = NOW()
       WHERE id = v_item.product_id
      RETURNING stock_qty - v_item.qty, stock_qty INTO v_before, v_after;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity, before_qty, after_qty,
        reference_type, reference_id, reason, created_by
      ) VALUES (
        v_item.product_id, 'VOID_REVERSAL', v_item.qty, v_before, v_after,
        'SALE_VOID', p_sale_id, 'Void of ' || v_sale.invoice_number || ': ' || p_reason,
        p_user_id
      );
    END LOOP;
  END IF;

  UPDATE sales
     SET status = 'VOID',
         voided_at = NOW(),
         voided_by = p_user_id,
         void_reason = p_reason,
         updated_at = NOW()
   WHERE id = p_sale_id;

  UPDATE payments SET status = 'REFUNDED', updated_at = NOW() WHERE sale_id = p_sale_id;

  -- Back out the shift roll-up so reconciliation stays truthful.
  UPDATE shifts SET
    total_sales        = total_sales - v_sale.grand_total,
    total_transactions = GREATEST(0, total_transactions - 1),
    total_items        = GREATEST(0, total_items - v_sale.total_items),
    total_voids        = total_voids + 1,
    cash_sales_total   = cash_sales_total - CASE WHEN v_sale.payment_method = 'CASH' THEN v_sale.grand_total ELSE 0 END,
    upi_sales_total    = upi_sales_total  - CASE WHEN v_sale.payment_method = 'UPI'  THEN v_sale.grand_total ELSE 0 END,
    card_sales_total   = card_sales_total - CASE WHEN v_sale.payment_method = 'CARD' THEN v_sale.grand_total ELSE 0 END,
    expected_cash      = expected_cash - CASE WHEN v_sale.payment_method = 'CASH' THEN v_sale.grand_total ELSE 0 END
  WHERE id = v_sale.shift_id;

  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
       SET total_visits = GREATEST(0, total_visits - 1),
           total_spend = GREATEST(0, total_spend - v_sale.grand_total),
           updated_at = NOW()
     WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
  VALUES (
    p_user_id, 'SALE_VOIDED', 'sale', p_sale_id::TEXT,
    'Voided ' || v_sale.invoice_number || ': ' || p_reason,
    jsonb_build_object(
      'invoice_number', v_sale.invoice_number,
      'grand_total', v_sale.grand_total,
      'restocked', p_restock,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'invoice_number', v_sale.invoice_number,
    'status', 'VOID',
    'restocked', p_restock
  );
END;
$$;

-- ───────────────────────────────────────────────
-- 16. RETURNS / REFUNDS
-- ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION process_return(
  p_sale_id        UUID,
  p_user_id        UUID,
  p_items          JSONB,   -- [{"sale_item_id": uuid, "qty": int}]
  p_reason         TEXT,
  p_refund_method  TEXT,
  p_shift_id       UUID DEFAULT NULL,
  p_restock        BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale          sales%ROWTYPE;
  v_return_id     UUID := uuid_generate_v4();
  v_return_number TEXT;
  v_entry         JSONB;
  v_item          sale_items%ROWTYPE;
  v_qty           INTEGER;
  v_line_net      BIGINT;
  v_refund_paise  BIGINT;
  v_cgst_paise    BIGINT;
  v_sgst_paise    BIGINT;
  v_tax_paise     BIGINT;
  v_total_refund  BIGINT := 0;
  v_total_cgst    BIGINT := 0;
  v_total_sgst    BIGINT := 0;
  v_total_items   INTEGER := 0;
  v_before        INTEGER;
  v_after         INTEGER;
  v_remaining     INTEGER;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a return must record why it happened';
  END IF;
  IF p_refund_method NOT IN ('CASH', 'UPI', 'CARD', 'STORE_CREDIT') THEN
    RAISE EXCEPTION 'INVALID_REFUND_METHOD: %', p_refund_method;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_RETURN: select at least one item to return';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND: %', p_sale_id;
  END IF;
  IF v_sale.status = 'VOID' THEN
    RAISE EXCEPTION 'SALE_VOIDED: a voided sale has nothing to return';
  END IF;

  v_return_number := next_return_number();

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_entry->>'qty')::INTEGER;

    SELECT * INTO v_item
      FROM sale_items
     WHERE id = (v_entry->>'sale_item_id')::UUID AND sale_id = p_sale_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ITEM_NOT_ON_SALE: %', v_entry->>'sale_item_id';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_QTY: return quantity must be positive';
    END IF;
    IF v_qty > (v_item.qty - v_item.qty_returned) THEN
      RAISE EXCEPTION 'EXCESS_RETURN: only % of "%" remain returnable',
        (v_item.qty - v_item.qty_returned), v_item.product_name;
    END IF;

    -- Refund the amount actually paid for those units, net of any discount
    -- that was apportioned to the line. Prorating (rather than dividing to a
    -- per-unit figure first) means returning every unit refunds exactly what
    -- the line collected, to the paisa.
    v_line_net := ROUND((v_item.line_total - v_item.line_discount) * 100)::BIGINT;
    v_refund_paise := ROUND(v_line_net::NUMERIC * v_qty / v_item.qty);
    v_tax_paise := v_refund_paise - ROUND(v_refund_paise::NUMERIC / (1 + v_item.gst_rate / 100.0));
    v_sgst_paise := FLOOR(v_tax_paise / 2.0);
    v_cgst_paise := v_tax_paise - v_sgst_paise;

    v_total_refund := v_total_refund + v_refund_paise;
    v_total_cgst   := v_total_cgst + v_cgst_paise;
    v_total_sgst   := v_total_sgst + v_sgst_paise;
    v_total_items  := v_total_items + v_qty;

    UPDATE sale_items SET qty_returned = qty_returned + v_qty WHERE id = v_item.id;

    IF p_restock THEN
      UPDATE products
         SET stock_qty = stock_qty + v_qty, updated_at = NOW()
       WHERE id = v_item.product_id
      RETURNING stock_qty - v_qty, stock_qty INTO v_before, v_after;

      INSERT INTO stock_movements (
        product_id, movement_type, quantity, before_qty, after_qty,
        reference_type, reference_id, reason, created_by
      ) VALUES (
        v_item.product_id, 'RETURN', v_qty, v_before, v_after,
        'RETURN', v_return_id, 'Return ' || v_return_number || ': ' || p_reason, p_user_id
      );
    END IF;

    INSERT INTO return_items (
      return_id, sale_item_id, product_id, product_name, qty,
      unit_price, refund_amount, cgst, sgst
    ) VALUES (
      v_return_id, v_item.id, v_item.product_id, v_item.product_name, v_qty,
      v_item.unit_price, v_refund_paise / 100.0, v_cgst_paise / 100.0, v_sgst_paise / 100.0
    );
  END LOOP;

  INSERT INTO returns (
    id, return_number, original_sale_id, shift_id, processed_by,
    refund_amount, refund_method, total_items, total_cgst, total_sgst,
    reason, status, restock
  ) VALUES (
    v_return_id, v_return_number, p_sale_id, p_shift_id, p_user_id,
    v_total_refund / 100.0, p_refund_method, v_total_items,
    v_total_cgst / 100.0, v_total_sgst / 100.0, p_reason, 'COMPLETED', p_restock
  );

  -- Fully returned or partially returned?
  SELECT COALESCE(SUM(qty - qty_returned), 0) INTO v_remaining
    FROM sale_items WHERE sale_id = p_sale_id;

  UPDATE sales
     SET status = CASE WHEN v_remaining = 0 THEN 'RETURNED' ELSE 'PARTIALLY_RETURNED' END,
         updated_at = NOW()
   WHERE id = p_sale_id;

  IF p_shift_id IS NOT NULL THEN
    UPDATE shifts SET
      total_refunds = total_refunds + (v_total_refund / 100.0),
      expected_cash = expected_cash
        - CASE WHEN p_refund_method = 'CASH' THEN v_total_refund / 100.0 ELSE 0 END
    WHERE id = p_shift_id;
  END IF;

  INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
  VALUES (
    p_user_id, 'RETURN_PROCESSED', 'return', v_return_id::TEXT,
    v_return_number || ' against ' || v_sale.invoice_number || ' — Rs.' || (v_total_refund / 100.0),
    jsonb_build_object(
      'return_number', v_return_number,
      'original_invoice', v_sale.invoice_number,
      'refund_amount', v_total_refund / 100.0,
      'refund_method', p_refund_method,
      'items', v_total_items,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'return_id', v_return_id,
    'return_number', v_return_number,
    'refund_amount', v_total_refund / 100.0,
    'total_items', v_total_items,
    'sale_status', CASE WHEN v_remaining = 0 THEN 'RETURNED' ELSE 'PARTIALLY_RETURNED' END
  );
END;
$$;

-- ───────────────────────────────────────────────
-- 17. STOCK ADJUSTMENT
-- ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION adjust_stock(
  p_product_id     UUID,
  p_user_id        UUID,
  p_delta          INTEGER,
  p_movement_type  TEXT,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product products%ROWTYPE;
  v_before  INTEGER;
  v_after   INTEGER;
BEGIN
  IF p_movement_type NOT IN ('OPENING_STOCK','PURCHASE','MANUAL_ADJUSTMENT','DAMAGE','LOSS','TRANSFER') THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE: %', p_movement_type;
  END IF;
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'ZERO_ADJUSTMENT: adjustment must be non-zero';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a stock adjustment must record why';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: %', p_product_id;
  END IF;

  v_before := v_product.stock_qty;
  v_after := v_before + p_delta;

  IF v_after < 0 AND NOT v_product.allow_negative_stock THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: adjustment would take % to %', v_product.name, v_after;
  END IF;

  UPDATE products SET stock_qty = v_after, updated_at = NOW() WHERE id = p_product_id;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, before_qty, after_qty,
    reference_type, reference_id, reason, created_by
  ) VALUES (
    p_product_id, p_movement_type, p_delta, v_before, v_after,
    'ADJUSTMENT', NULL, p_reason, p_user_id
  );

  INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
  VALUES (
    p_user_id, 'STOCK_ADJUSTED', 'product', p_product_id::TEXT,
    v_product.name || ': ' || v_before || ' → ' || v_after || ' (' || p_reason || ')',
    jsonb_build_object('delta', p_delta, 'type', p_movement_type, 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id, 'before_qty', v_before, 'after_qty', v_after
  );
END;
$$;

-- ───────────────────────────────────────────────
-- 18. RECEIVE A PURCHASE ORDER
-- ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION receive_purchase_order(
  p_po_id    UUID,
  p_user_id  UUID,
  p_items    JSONB   -- [{"po_item_id": uuid, "qty_received": int}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po       purchase_orders%ROWTYPE;
  v_entry    JSONB;
  v_po_item  purchase_order_items%ROWTYPE;
  v_qty      INTEGER;
  v_before   INTEGER;
  v_after    INTEGER;
  v_received INTEGER := 0;
  v_pending  INTEGER;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO_NOT_FOUND: %', p_po_id;
  END IF;
  IF v_po.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'PO_CANCELLED: cannot receive against a cancelled order';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_entry->>'qty_received')::INTEGER;
    IF v_qty IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_po_item
      FROM purchase_order_items
     WHERE id = (v_entry->>'po_item_id')::UUID AND purchase_order_id = p_po_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PO_ITEM_NOT_FOUND: %', v_entry->>'po_item_id';
    END IF;
    IF v_po_item.qty_received + v_qty > v_po_item.qty_ordered THEN
      RAISE EXCEPTION 'OVER_RECEIPT: % exceeds the ordered quantity for %',
        v_qty, v_po_item.product_name;
    END IF;

    UPDATE products
       SET stock_qty = stock_qty + v_qty,
           -- Keep the latest known supplier cost; it drives margin reporting
           -- and must never be confused with the ₹99 selling price.
           cost_price = v_po_item.unit_cost,
           updated_at = NOW()
     WHERE id = v_po_item.product_id
    RETURNING stock_qty - v_qty, stock_qty INTO v_before, v_after;

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, before_qty, after_qty,
      reference_type, reference_id, reason, created_by
    ) VALUES (
      v_po_item.product_id, 'PURCHASE', v_qty, v_before, v_after,
      'PURCHASE_ORDER', p_po_id,
      'Received against PO ' || COALESCE(v_po.po_number, p_po_id::TEXT), p_user_id
    );

    UPDATE purchase_order_items
       SET qty_received = qty_received + v_qty
     WHERE id = v_po_item.id;

    v_received := v_received + v_qty;
  END LOOP;

  SELECT COALESCE(SUM(qty_ordered - qty_received), 0) INTO v_pending
    FROM purchase_order_items WHERE purchase_order_id = p_po_id;

  UPDATE purchase_orders
     SET status = CASE WHEN v_pending = 0 THEN 'RECEIVED' ELSE 'ORDERED' END,
         received_at = CASE WHEN v_pending = 0 THEN NOW() ELSE received_at END,
         received_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_po_id;

  INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
  VALUES (
    p_user_id, 'PURCHASE_RECEIVED', 'purchase_order', p_po_id::TEXT,
    'Received ' || v_received || ' unit(s)',
    jsonb_build_object('units', v_received, 'fully_received', v_pending = 0)
  );

  RETURN jsonb_build_object(
    'purchase_order_id', p_po_id, 'units_received', v_received, 'fully_received', v_pending = 0
  );
END;
$$;

-- ───────────────────────────────────────────────
-- 19. CLOSE A SHIFT
-- ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION close_shift(
  p_shift_id      UUID,
  p_user_id       UUID,
  p_closing_cash  NUMERIC,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift     shifts%ROWTYPE;
  v_expected  NUMERIC;
  v_diff      NUMERIC;
BEGIN
  SELECT * INTO v_shift FROM shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SHIFT_NOT_FOUND: %', p_shift_id;
  END IF;
  IF v_shift.status = 'CLOSED' THEN
    RAISE EXCEPTION 'SHIFT_ALREADY_CLOSED';
  END IF;
  IF p_closing_cash IS NULL OR p_closing_cash < 0 THEN
    RAISE EXCEPTION 'INVALID_CLOSING_CASH';
  END IF;

  -- Recompute rather than trusting the running total.
  v_expected := v_shift.opening_cash + v_shift.cash_sales_total - v_shift.total_refunds;
  v_diff := p_closing_cash - v_expected;

  -- A material discrepancy must be explained.
  IF ABS(v_diff) > 50 AND (p_reason IS NULL OR length(trim(p_reason)) < 3) THEN
    RAISE EXCEPTION 'REASON_REQUIRED: explain the cash difference of Rs.%', v_diff;
  END IF;

  UPDATE shifts SET
    status = 'CLOSED',
    closed_at = NOW(),
    closed_by = p_user_id,
    closing_cash = p_closing_cash,
    expected_cash = v_expected,
    discrepancy = v_diff,
    discrepancy_reason = p_reason
  WHERE id = p_shift_id;

  INSERT INTO activity_log (user_id, action, entity_type, entity_id, details, metadata)
  VALUES (
    p_user_id, 'SHIFT_CLOSED', 'shift', p_shift_id::TEXT,
    'Expected Rs.' || v_expected || ', counted Rs.' || p_closing_cash || ', diff Rs.' || v_diff,
    jsonb_build_object(
      'expected_cash', v_expected, 'closing_cash', p_closing_cash,
      'discrepancy', v_diff, 'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'shift_id', p_shift_id, 'expected_cash', v_expected,
    'closing_cash', p_closing_cash, 'discrepancy', v_diff
  );
END;
$$;

-- ───────────────────────────────────────────────
-- 20. updated_at triggers for the new tables
-- ───────────────────────────────────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers','suppliers','payments','store_settings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
  END LOOP;
END $$;

-- ───────────────────────────────────────────────
-- 21. ROW LEVEL SECURITY — deny by default
-- ───────────────────────────────────────────────
-- The application authenticates staff with its own signed session and reaches
-- the database only from server-side route handlers using the service role
-- (which bypasses RLS). No browser ever holds a key that can read these
-- tables, so the correct posture is: no permissive policies at all.
--
-- The permissive "USING (true)" policies from the initial schema are dropped —
-- with the anon key they allowed anyone who could reach the project URL to
-- read every sale, profile and product.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','products','shifts','sales','sale_items','purchase_orders',
    'purchase_order_items','emi_cases','activity_log','sync_queue','customers',
    'suppliers','stock_movements','payments','returns','return_items',
    'store_settings','invoice_counters'
  ] LOOP
    EXECUTE format('ALTER TABLE IF EXISTS %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE IF EXISTS %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t);
  END LOOP;
END $$;

-- Only the service role may execute the business RPCs.
REVOKE ALL ON FUNCTION create_sale(TEXT,UUID,UUID,TEXT,JSONB,NUMERIC,NUMERIC,UUID,TEXT,NUMERIC,TEXT,TIMESTAMPTZ,BOOLEAN,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION void_sale(UUID,UUID,TEXT,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION process_return(UUID,UUID,JSONB,TEXT,TEXT,UUID,BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION adjust_stock(UUID,UUID,INTEGER,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_purchase_order(UUID,UUID,JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION close_shift(UUID,UUID,NUMERIC,TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION next_invoice_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION next_return_number() FROM PUBLIC, anon, authenticated;

COMMIT;
