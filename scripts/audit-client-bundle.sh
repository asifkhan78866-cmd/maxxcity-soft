#!/usr/bin/env bash
# ═══════════════════════════════════════
# Client bundle secret audit
# ═══════════════════════════════════════
# Usage:  npm run env:audit
#
# Builds the app and greps the JavaScript actually served to browsers for the
# real values of every server-only secret.
#
# Static analysis proves the import graph is clean; this proves the *output*
# is. They are different claims — a secret can reach the bundle through a
# barrel re-export or a stray literal that no import check would catch.
#
# Reads .env.local for the values to search for. It never prints them.

set -euo pipefail
cd "$(dirname "$0")/.."

RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

if [[ ! -f .env.local ]]; then
  echo "error: .env.local not found — nothing to audit against" >&2
  exit 1
fi

# Secrets that must NEVER appear in a client bundle.
SECRET_VARS=(SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_URL SESSION_SECRET BOOTSTRAP_TOKEN GROQ_API_KEY OPENROUTER_API_KEY)

echo
echo "${BOLD}Client bundle secret audit${RESET}"
echo

if [[ ! -d .next/static ]]; then
  echo "${DIM}No build found — building first (this takes a minute) ...${RESET}"
  npm run build > /tmp/env-audit-build.log 2>&1 || {
    echo "${RED}✗ Build failed${RESET}" >&2
    tail -25 /tmp/env-audit-build.log >&2
    exit 1
  }
  echo "${DIM}build complete${RESET}"
  echo
fi

# Everything the browser can download. `mapfile` is bash 4+ and macOS ships
# bash 3.2, so the scan greps the tree directly rather than building an array.
BUNDLE_COUNT="$(find .next/static -type f \( -name '*.js' -o -name '*.json' -o -name '*.map' \) 2>/dev/null | wc -l | tr -d ' ')"

if [[ "$BUNDLE_COUNT" -eq 0 ]]; then
  echo "${RED}✗ No client bundle files found under .next/static${RESET}" >&2
  exit 1
fi

# Searches every downloadable client file for a literal value.
bundle_contains() {
  grep -rqF --include='*.js' --include='*.json' --include='*.map' -- "$1" .next/static 2>/dev/null
}
bundle_matches() {
  grep -rlF --include='*.js' --include='*.json' --include='*.map' -- "$1" .next/static 2>/dev/null
}

echo "${DIM}scanning ${BUNDLE_COUNT} client files ...${RESET}"
echo

FAILED=0
CHECKED=0

for var in "${SECRET_VARS[@]}"; do
  value="$(grep "^${var}=" .env.local 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"

  if [[ -z "$value" ]]; then
    printf '  %s—%s %-28s %snot set, skipped%s\n' "$DIM" "$RESET" "$var" "$DIM" "$RESET"
    continue
  fi

  CHECKED=$((CHECKED + 1))

  # Search for the literal value, not the variable name — the name appearing
  # is harmless, the value leaking is not.
  if bundle_contains "$value"; then
    printf '  %s✗%s %-28s %sLEAKED INTO CLIENT BUNDLE%s\n' "$RED" "$RESET" "$var" "$RED$BOLD" "$RESET"
    echo "      found in:"
    bundle_matches "$value" | head -5 | sed 's/^/        /'
    FAILED=$((FAILED + 1))
  else
    printf '  %s✓%s %-28s %sabsent from client bundle%s\n' "$GREEN" "$RESET" "$var" "$DIM" "$RESET"
  fi
done

echo

# The anon key SHOULD be present — it is public by design. Its absence would
# mean the browser cannot reach Supabase at all.
anon="$(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
if [[ -n "$anon" ]]; then
  if bundle_contains "$anon"; then
    printf '  %s✓%s %-28s %spresent, as intended (public key)%s\n' \
      "$GREEN" "$RESET" "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$DIM" "$RESET"
  else
    printf '  %s!%s %-28s %snot inlined — the browser cannot reach Supabase%s\n' \
      "$RED" "$RESET" "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$DIM" "$RESET"
  fi
fi

echo
if [[ $FAILED -gt 0 ]]; then
  echo "${RED}${BOLD}✗ $FAILED secret(s) reachable from the browser.${RESET}"
  echo "${DIM}  Find the import chain pulling it in, and make that module server-only.${RESET}"
  echo "${DIM}  Then ROTATE the leaked key — it has been shipped.${RESET}"
  echo
  exit 1
fi

echo "${GREEN}${BOLD}✓ No server secret found in any client bundle${RESET} ${DIM}($CHECKED checked)${RESET}"
echo
