#!/usr/bin/env bash
# ═══════════════════════════════════════
# Apply database migrations
# ═══════════════════════════════════════
# Usage:  ./scripts/apply-migrations.sh
#
# Reads SUPABASE_DB_URL from .env.local and applies every file in
# supabase/migrations/ in filename order.
#
# Each file runs inside a single transaction (ON_ERROR_STOP + --single-
# transaction), so a migration either applies completely or not at all —
# a half-applied schema is worse than none.
#
# 0002 is written to be idempotent, so re-running is safe.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env.local ]]; then
  echo "error: .env.local not found" >&2
  exit 1
fi

DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | tr -d '"' || true)"

if [[ -z "$DB_URL" ]]; then
  cat >&2 <<'MSG'
error: SUPABASE_DB_URL is not set in .env.local

Get it from the Supabase dashboard:
  Project Settings → Database → Connection string → URI

It looks like:
  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

Add it as:
  SUPABASE_DB_URL="postgresql://..."
MSG
  exit 1
fi

if ! command -v psql >/dev/null; then
  echo "error: psql not found (brew install postgresql@16)" >&2
  exit 1
fi

echo "Checking connectivity ..."
if ! psql "$DB_URL" -c 'select 1' >/dev/null 2>&1; then
  echo "error: cannot connect with SUPABASE_DB_URL" >&2
  echo "  check the password is correct and that the URI is the pooler/session string" >&2
  exit 1
fi
echo "  ✓ connected"
echo

shopt -s nullglob
for file in supabase/migrations/*.sql; do
  echo "→ $(basename "$file")"
  if psql "$DB_URL" \
       --quiet \
       --single-transaction \
       --set ON_ERROR_STOP=1 \
       --file "$file" > /tmp/migration-out.log 2>&1; then
    echo "  ✓ applied"
  else
    echo "  ✗ FAILED — nothing from this file was committed" >&2
    tail -20 /tmp/migration-out.log >&2
    exit 1
  fi
done

echo
echo "Verifying schema ..."
psql "$DB_URL" --quiet --tuples-only --no-align <<'SQL'
select '  ' ||
  case when count(*) = 8 then '✓' else '✗' end ||
  ' core tables present (' || count(*) || '/8)'
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles','products','sales','sale_items',
                     'stock_movements','customers','returns','store_settings');

select '  ' ||
  case when count(*) = 6 then '✓' else '✗' end ||
  ' business functions present (' || count(*) || '/6)'
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('create_sale','void_sale','process_return',
                       'adjust_stock','receive_purchase_order','close_shift');

select '  ✓ selling price default = ' || default_product_price
from store_settings where id = 'main';
SQL

echo
echo "Next: ./scripts/create-admin.sh 9154 \"Syed Asif\" SYED"
