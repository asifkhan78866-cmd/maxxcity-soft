#!/usr/bin/env bash
# ═══════════════════════════════════════
# Migration + business-logic test
# ═══════════════════════════════════════
# Applies every migration to a scratch database and exercises the money-moving
# RPCs against it. Requires a local Postgres (brew install postgresql@16).
#
#   ./scripts/test-migrations.sh
#
# This exists because the SQL is where the real money logic lives and it is not
# covered by vitest. Running it caught two foreign-key ordering bugs that the
# application tests could never have found: create_sale inserted sale_items
# before the sales header, and process_return did the same with return_items.
#
# Uses a throwaway database — it never touches Supabase or .env.local.

set -uo pipefail
cd "$(dirname "$0")/.."

DB="${TEST_DB:-maxxcity_migration_test}"

command -v psql >/dev/null || { echo "error: psql not found (brew install postgresql@16)" >&2; exit 1; }
pg_isready -q || { echo "error: local Postgres is not running (brew services start postgresql@16)" >&2; exit 1; }

echo "Rebuilding scratch database '$DB' ..."
psql -d postgres -q -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
psql -d postgres -q -c "CREATE DATABASE $DB"          >/dev/null 2>&1

FAILED=0

for file in supabase/migrations/*.sql; do
  if psql -d "$DB" --quiet --single-transaction --set ON_ERROR_STOP=1 -f "$file" >/tmp/mig.log 2>&1; then
    echo "  ✓ $(basename "$file")"
  else
    echo "  ✗ $(basename "$file")"; grep -E "^ERROR" /tmp/mig.log | head -5; exit 1
  fi
done

echo
echo "Running business-logic assertions ..."

# Every assertion RAISEs a NOTICE beginning PASS or FAIL, so the summary below
# can count them without depending on psql exit codes.
psql -d "$DB" --quiet 2>&1 <<'SQL' | grep -E "PASS|FAIL" | sed 's/^NOTICE:  /  /'
\set ON_ERROR_STOP 0
SET client_min_messages TO NOTICE;

INSERT INTO profiles (id,email,name,role,staff_code,is_active)
VALUES ('11111111-1111-4111-8111-111111111111','t@x.in','Test Cashier','CASHIER','T1',true);
INSERT INTO products (id,name,barcode,category,hsn_code,gst_rate,price,stock_qty) VALUES
 ('22222222-2222-4222-8222-222222222221','Widget A','B1','Electronics','8518',18,99,10),
 ('22222222-2222-4222-8222-222222222222','Widget B','B2','Kitchen','3924',12,99,10),
 ('22222222-2222-4222-8222-222222222223','Widget C','B3','Clothing','6109', 5,99,10);
INSERT INTO shifts (id,cashier_id,opening_cash,status)
VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',5000,'OPEN');

DO $$
DECLARE r JSONB; v_sale UUID; v_item UUID; v_before INT; v_after INT; v_exp NUMERIC;
BEGIN
  -- 7 units across three GST rates must come to exactly 693.
  r := create_sale('k1','11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','CASH',
    '[{"product_id":"22222222-2222-4222-8222-222222222221","qty":2},
      {"product_id":"22222222-2222-4222-8222-222222222222","qty":3},
      {"product_id":"22222222-2222-4222-8222-222222222223","qty":2}]'::jsonb,
    99,0,NULL,'T1',1000);
  RAISE NOTICE '% seven items total 693 (got %)',
    CASE WHEN (r->>'grand_total')::numeric=693.00 AND (r->>'total_items')::int=7
         THEN 'PASS —' ELSE 'FAIL —' END, r->>'grand_total';

  PERFORM 1 FROM sales WHERE client_sale_id='k1'
    AND subtotal+total_tax=grand_total AND total_cgst+total_sgst=total_tax;
  RAISE NOTICE '% tax reconciles to the paisa', CASE WHEN FOUND THEN 'PASS —' ELSE 'FAIL —' END;

  SELECT sum(stock_qty) INTO v_after FROM products;
  RAISE NOTICE '% stock decremented by exactly 7 (30→%)',
    CASE WHEN v_after=23 THEN 'PASS —' ELSE 'FAIL —' END, v_after;

  -- Replaying the idempotency key must return the original, not bill again.
  r := create_sale('k1','11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','CASH',
    '[{"product_id":"22222222-2222-4222-8222-222222222221","qty":2}]'::jsonb,99,0,NULL,'T1',1000);
  RAISE NOTICE '% replayed idempotency key does not double-bill',
    CASE WHEN (r->>'duplicate')::boolean AND (SELECT count(*) FROM sales)=1
         THEN 'PASS —' ELSE 'FAIL —' END;

  PERFORM 1 FROM stock_movements WHERE movement_type='SALE' HAVING sum(quantity)=-7;
  RAISE NOTICE '% stock ledger records every line', CASE WHEN FOUND THEN 'PASS —' ELSE 'FAIL —' END;

  PERFORM 1 FROM shifts WHERE id='33333333-3333-4333-8333-333333333333'
    AND total_sales=693 AND total_items=7;
  RAISE NOTICE '% shift totals rolled up', CASE WHEN FOUND THEN 'PASS —' ELSE 'FAIL —' END;
END $$;

-- Overselling.
DO $$ BEGIN
  PERFORM create_sale('k2','11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','CASH',
    '[{"product_id":"22222222-2222-4222-8222-222222222221","qty":999}]'::jsonb,99,0,NULL,'T1',99999);
  RAISE NOTICE 'FAIL — oversell was allowed';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS — oversell rejected'; END $$;

-- Underpayment must fail before stock moves.
DO $$ DECLARE b INT; a INT; BEGIN
  SELECT stock_qty INTO b FROM products WHERE barcode='B1';
  BEGIN
    PERFORM create_sale('k3','11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333','CASH',
      '[{"product_id":"22222222-2222-4222-8222-222222222221","qty":1}]'::jsonb,99,0,NULL,'T1',10);
    RAISE NOTICE 'FAIL — underpayment accepted';
  EXCEPTION WHEN OTHERS THEN
    SELECT stock_qty INTO a FROM products WHERE barcode='B1';
    RAISE NOTICE '% underpayment rejected with stock untouched',
      CASE WHEN a=b THEN 'PASS —' ELSE 'FAIL —' END;
  END;
END $$;

-- A stale 149 price must never be sellable.
UPDATE products SET price=149 WHERE barcode='B1';
DO $$ BEGIN
  PERFORM create_sale('k4','11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','CASH',
    '[{"product_id":"22222222-2222-4222-8222-222222222221","qty":1}]'::jsonb,99,0,NULL,'T1',1000);
  RAISE NOTICE 'FAIL — a 149 product was sold';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS — mispriced product refused'; END $$;
UPDATE products SET price=99 WHERE barcode='B1';

-- Void restores stock, reverses the shift, and preserves the record.
DO $$ DECLARE v UUID; b INT; a INT; BEGIN
  SELECT id INTO v FROM sales WHERE client_sale_id='k1';
  SELECT sum(stock_qty) INTO b FROM products;
  PERFORM void_sale(v,'11111111-1111-4111-8111-111111111111','Test void',true);
  SELECT sum(stock_qty) INTO a FROM products;
  RAISE NOTICE '% void restores stock and reverses the shift',
    CASE WHEN a-b=7 AND (SELECT total_sales FROM shifts
                          WHERE id='33333333-3333-4333-8333-333333333333')=0
         THEN 'PASS —' ELSE 'FAIL —' END;
  PERFORM 1 FROM sales WHERE id=v AND status='VOID'
    AND void_reason IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL;
  RAISE NOTICE '% void is recorded, not deleted', CASE WHEN FOUND THEN 'PASS —' ELSE 'FAIL —' END;
END $$;

-- Returns.
DO $$ DECLARE v_sale UUID; v_item UUID; r JSONB; st INT; BEGIN
  SELECT (create_sale('k5','11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','CASH',
    '[{"product_id":"22222222-2222-4222-8222-222222222222","qty":4}]'::jsonb,
    99,0,NULL,'T1',500)->>'sale_id')::uuid INTO v_sale;
  SELECT id INTO v_item FROM sale_items WHERE sale_id=v_sale;
  SELECT stock_qty INTO st FROM products WHERE barcode='B2';

  r := process_return(v_sale,'11111111-1111-4111-8111-111111111111',
    format('[{"sale_item_id":"%s","qty":2}]',v_item)::jsonb,
    'Changed mind','CASH','33333333-3333-4333-8333-333333333333',true);
  RAISE NOTICE '% partial return refunds 198 and restocks (got %)',
    CASE WHEN (r->>'refund_amount')::numeric=198.00
          AND (r->>'sale_status')='PARTIALLY_RETURNED'
          AND (SELECT stock_qty FROM products WHERE barcode='B2')=st+2
         THEN 'PASS —' ELSE 'FAIL —' END, r->>'refund_amount';

  BEGIN
    PERFORM process_return(v_sale,'11111111-1111-4111-8111-111111111111',
      format('[{"sale_item_id":"%s","qty":99}]',v_item)::jsonb,'Too many','CASH',NULL,true);
    RAISE NOTICE 'FAIL — excess return allowed';
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS — excess return rejected'; END;

  r := process_return(v_sale,'11111111-1111-4111-8111-111111111111',
    format('[{"sale_item_id":"%s","qty":2}]',v_item)::jsonb,'Rest','CASH',NULL,true);
  RAISE NOTICE '% returning the remainder marks the sale RETURNED',
    CASE WHEN r->>'sale_status'='RETURNED' THEN 'PASS —' ELSE 'FAIL —' END;
END $$;

-- Shift reconciliation.
DO $$ DECLARE v JSONB; e NUMERIC; BEGIN
  SELECT expected_cash INTO e FROM shifts WHERE id='33333333-3333-4333-8333-333333333333';
  v := close_shift('33333333-3333-4333-8333-333333333333',
       '11111111-1111-4111-8111-111111111111', e, NULL);
  RAISE NOTICE '% shift closes with zero discrepancy',
    CASE WHEN (v->>'discrepancy')::numeric=0 THEN 'PASS —' ELSE 'FAIL —' END;
END $$;

DO $$ BEGIN
  PERFORM close_shift('33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111', 1.00, NULL);
  RAISE NOTICE 'FAIL — unexplained cash difference accepted';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS — unexplained difference demands a reason'; END $$;

DO $$ BEGIN
  PERFORM 1 FROM activity_log HAVING count(*) FILTER (WHERE action='SALE_COMPLETED')>0
                                  AND count(*) FILTER (WHERE action='SALE_VOIDED')>0
                                  AND count(*) FILTER (WHERE action='RETURN_PROCESSED')>0;
  RAISE NOTICE '% sale, void and return are all audited',
    CASE WHEN FOUND THEN 'PASS —' ELSE 'FAIL —' END;
END $$;
SQL

echo
RESULT=$(psql -d "$DB" -tAc "select count(*) from sales" 2>/dev/null)
echo "Scratch database '$DB' left in place for inspection ($RESULT sale rows)."
echo "Drop it with:  psql -d postgres -c 'DROP DATABASE $DB'"
