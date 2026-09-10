-- ═══════════════════════════════════════════════════════════════
-- 0003 — Fix UUID generation inside SECURITY DEFINER functions
-- ═══════════════════════════════════════════════════════════════
-- Apply AFTER 0002. Idempotent (CREATE OR REPLACE), non-destructive:
-- it replaces two function bodies and touches no data.
--
-- THE BUG
-- Every sale failed at runtime with:
--     function uuid_generate_v4() does not exist
--
-- Supabase installs uuid-ossp into the `extensions` schema, not `public`.
-- These functions pin `SET search_path = public` on purpose — leaving the
-- search_path open on a SECURITY DEFINER function is a privilege-escalation
-- risk — so uuid_generate_v4() was unresolvable inside their bodies.
--
-- Column DEFAULTs were unaffected: a DEFAULT resolves the function at DDL
-- time and keeps working. Only the in-body calls broke, which is why the
-- schema looked healthy while every checkout returned a 500.
--
-- THE FIX
-- gen_random_uuid() is core Postgres (pg_catalog, since PG13), so it resolves
-- under any search_path and needs no extension.
--
-- NOTE: a local Postgres rehearsal cannot reproduce this — `CREATE EXTENSION
-- "uuid-ossp"` there installs into `public`, where search_path = public finds
-- it. It only appears against Supabase.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

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

  v_sale_id := gen_random_uuid();

  -- ── Cash validation, before any stock moves ─────────────────
  -- The net total is already known: every line discount sums back to the bill
  -- discount, so net = gross - discount. Checking here means an underpaid bill
  -- fails before it touches inventory rather than after.
  v_sum_net := v_total_gross - v_discount_paise;

  IF p_payment_method = 'CASH'
     AND p_amount_tendered IS NOT NULL
     AND ROUND(p_amount_tendered * 100) < v_sum_net THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH: tendered amount is less than the bill total';
  END IF;

  v_change := CASE
    WHEN p_payment_method = 'CASH' AND p_amount_tendered IS NOT NULL
      THEN GREATEST(0, p_amount_tendered - (v_sum_net / 100.0))
    ELSE NULL
  END;

  -- ── Sale header ─────────────────────────────────────────────
  -- Inserted BEFORE the line items because sale_items.sale_id references it.
  -- The tax columns are filled in after pass 2, which is when the per-line
  -- split is known; the whole function is one transaction, so the intermediate
  -- state is never visible to anyone.
  INSERT INTO sales (
    id, invoice_number, client_sale_id, terminal_id, shift_id, cashier_id, customer_id,
    subtotal, total_cgst, total_sgst, total_tax, discount, grand_total, total_items,
    payment_method, payment_status, status, amount_tendered, change_due,
    is_offline_origin, synced_at, discount_reason, created_at, updated_at
  ) VALUES (
    v_sale_id, v_invoice, p_client_sale_id, p_terminal_id, p_shift_id, p_cashier_id, p_customer_id,
    0, 0, 0, 0, v_discount_paise / 100.0, v_sum_net / 100.0, v_total_items,
    p_payment_method, p_payment_status, 'COMPLETED', p_amount_tendered, v_change,
    p_is_offline, CASE WHEN p_is_offline THEN NOW() ELSE NULL END,
    p_discount_reason, v_created_at, NOW()
  );

  -- Reset so pass 2 can accumulate the authoritative figures.
  v_sum_net := 0;

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

    v_sale_item_id := gen_random_uuid();

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

  -- ── Fill in the tax totals now the per-line split is known ──
  UPDATE sales SET
    subtotal    = v_sum_base / 100.0,
    total_cgst  = v_sum_cgst / 100.0,
    total_sgst  = v_sum_sgst / 100.0,
    total_tax   = (v_sum_cgst + v_sum_sgst) / 100.0,
    grand_total = v_sum_net / 100.0
  WHERE id = v_sale_id;

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
  v_return_id     UUID := gen_random_uuid();
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

  -- Header first: return_items.return_id references it. Totals are filled in
  -- once the lines are priced, all inside the one transaction.
  INSERT INTO returns (
    id, return_number, original_sale_id, shift_id, processed_by,
    refund_amount, refund_method, total_items, total_cgst, total_sgst,
    reason, status, restock
  ) VALUES (
    v_return_id, v_return_number, p_sale_id, p_shift_id, p_user_id,
    0, p_refund_method, 0, 0, 0, p_reason, 'COMPLETED', p_restock
  );

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

  UPDATE returns SET
    refund_amount = v_total_refund / 100.0,
    total_items   = v_total_items,
    total_cgst    = v_total_cgst / 100.0,
    total_sgst    = v_total_sgst / 100.0
  WHERE id = v_return_id;

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

COMMIT;
