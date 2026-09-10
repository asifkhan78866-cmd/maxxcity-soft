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

DIM=$'\033[2m'; RESET=$'\033[0m'

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

# ── Migration tracking ───────────────────────────────────────
# Without a ledger this script replays every file on every run. 0002 and 0003
# are written to be idempotent, but 0001 is not — its CREATE INDEX statements
# have no IF NOT EXISTS — so a second run failed on an already-migrated
# database. Recording what has been applied fixes that generally, instead of
# patching three dozen statements.
psql "$DB_URL" --quiet --set ON_ERROR_STOP=1 >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SQL

is_applied() {
  local f; f="$(basename "$1")"
  [[ "$(psql "$DB_URL" --quiet --tuples-only --no-align \
        -c "select count(*) from schema_migrations where filename = '$f'")" == "1" ]]
}

mark_applied() {
  local f; f="$(basename "$1")"
  psql "$DB_URL" --quiet --set ON_ERROR_STOP=1 >/dev/null \
    -c "insert into schema_migrations (filename) values ('$f') on conflict do nothing"
}

# `--baseline [file...]` records migrations as applied WITHOUT running them,
# for a database that was migrated before tracking existed.
#
# Naming files explicitly is deliberate: baselining everything would also mark
# migrations that have NOT run, silently skipping them forever. Verify the
# schema first — this does not check for you.
if [[ "${1:-}" == "--baseline" ]]; then
  shift
  if [[ $# -eq 0 ]]; then
    echo "error: name the migrations to baseline, e.g." >&2
    echo "  ./scripts/apply-migrations.sh --baseline 0001_initial.sql" >&2
    exit 1
  fi
  for name in "$@"; do
    if [[ ! -f "supabase/migrations/$name" ]]; then
      echo "error: no such migration: $name" >&2
      exit 1
    fi
    mark_applied "supabase/migrations/$name"
    echo "  baselined $name  (recorded, not executed)"
  done
  echo
  echo "Ledger seeded. Re-run without --baseline to apply anything outstanding."
  exit 0
fi

shopt -s nullglob
APPLIED=0
for file in supabase/migrations/*.sql; do
  name="$(basename "$file")"
  if is_applied "$file"; then
    echo "→ $name"
    echo "  ${DIM}already applied, skipped${RESET}"
    continue
  fi

  echo "→ $name"
  if psql "$DB_URL" \
       --quiet \
       --single-transaction \
       --set ON_ERROR_STOP=1 \
       --file "$file" > /tmp/migration-out.log 2>&1; then
    mark_applied "$file"
    echo "  ✓ applied"
    APPLIED=$((APPLIED + 1))
  else
    echo "  ✗ FAILED — nothing from this file was committed" >&2
    tail -20 /tmp/migration-out.log >&2
    exit 1
  fi
done

echo
echo "  ${APPLIED} migration(s) applied this run."

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
