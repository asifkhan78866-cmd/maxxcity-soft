#!/usr/bin/env bash
# ═══════════════════════════════════════
# Create the first ADMIN account
# ═══════════════════════════════════════
# Usage:  ./scripts/create-admin.sh <PIN> ["Full Name"] [STAFF_CODE]
# Example: ./scripts/create-admin.sh 9154 "Syed Asif" SYED
#
# The PIN is passed as an argument rather than stored here, so no credential
# is ever committed. BOOTSTRAP_TOKEN is read from .env.local.
#
# This works only while NO active admin exists — the route refuses to run a
# second time. Delete BOOTSTRAP_TOKEN from .env.local once you are done.

set -euo pipefail

PIN="${1:-}"
NAME="${2:-Syed Asif}"
STAFF_CODE="${3:-SYED}"
EMAIL="${ADMIN_EMAIL:-admin@maxxcity.in}"
BASE_URL="${BASE_URL:-http://localhost:3000}"

if [[ -z "$PIN" ]]; then
  echo "error: PIN is required" >&2
  echo "usage: $0 <PIN> [\"Full Name\"] [STAFF_CODE]" >&2
  exit 1
fi

if [[ ! "$PIN" =~ ^[0-9]{4,6}$ ]]; then
  echo "error: PIN must be 4-6 digits" >&2
  exit 1
fi

if [[ ! -f .env.local ]]; then
  echo "error: .env.local not found — run this from the project root" >&2
  exit 1
fi

TOKEN="$(grep '^BOOTSTRAP_TOKEN=' .env.local | cut -d= -f2- || true)"
if [[ -z "$TOKEN" ]]; then
  echo "error: BOOTSTRAP_TOKEN is not set in .env.local" >&2
  echo "  add one with:  echo \"BOOTSTRAP_TOKEN=\$(openssl rand -hex 24)\" >> .env.local" >&2
  echo "  then restart the dev server so it picks the value up." >&2
  exit 1
fi

echo "Creating admin \"$NAME\" (staff code $STAFF_CODE) at $BASE_URL ..."

RESPONSE="$(curl -sS -w $'\n%{http_code}' -X POST "$BASE_URL/api/auth/bootstrap" \
  -H 'Content-Type: application/json' \
  --data "$(STAFF_CODE="$STAFF_CODE" NAME="$NAME" EMAIL="$EMAIL" PIN="$PIN" TOKEN="$TOKEN" \
      python3 -c 'import json,os; print(json.dumps({k.lower() if k!="STAFF_CODE" else "staff_code": os.environ[k] for k in ("TOKEN","NAME","EMAIL","STAFF_CODE","PIN")}))')")"

STATUS="$(printf '%s' "$RESPONSE" | tail -n1)"
BODY="$(printf '%s' "$RESPONSE" | sed '$d')"

if [[ "$STATUS" == "201" ]]; then
  echo
  echo "✓ Admin created."
  echo "  Sign in at $BASE_URL/login → Staff PIN tab"
  echo "  Staff code: $STAFF_CODE"
  echo "  PIN:        (the one you just passed)"
  echo
  echo "Now remove BOOTSTRAP_TOKEN from .env.local."
else
  echo
  echo "✗ Failed (HTTP $STATUS)" >&2
  printf '%s\n' "$BODY" >&2
  echo >&2
  case "$STATUS" in
    409) echo "An admin already exists. Create further staff from Admin → Staff." >&2 ;;
    500) echo "Usually the database: check the Supabase project is reachable and that" >&2
         echo "both files in supabase/migrations/ have been applied." >&2 ;;
    403) echo "Token mismatch, or the dev server was started before BOOTSTRAP_TOKEN" >&2
         echo "was added — restart it." >&2 ;;
  esac
  exit 1
fi
