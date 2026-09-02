# MaxxCity Mall — POS & Business Management

Retail point-of-sale, inventory, procurement and analytics for MaxxCity Mall,
Ramnagar Main Road, Adilabad, Telangana.

Next.js 16 (App Router) · Supabase (Postgres) · Dexie/IndexedDB for offline ·
Tailwind + shadcn/ui.

---

## The two business rules everything else serves

**1. Every product sells for a flat ₹99, inclusive of GST.**

The price lives in exactly one place — `lib/config/pricing.ts` — and is applied
server-side. A client cannot submit a price; `POST /api/sales` accepts only
`{ product_id, qty }` per line and derives every rupee figure itself. GST is
back-calculated from ₹99 at each product's own rate (5% / 12% / 18%).

Supplier cost is a **separate** field (`products.cost_price`) and is what
margin reporting uses. So is the EMI booking fee (`EMI_BOOKING_FEE`) — changing
the selling price must never move either.

**2. The customer's receipt never shows what they bought.**

A customer receipt shows the store header, invoice number, date/time, cashier,
`TOTAL PRODUCTS`, `TOTAL AMOUNT` and the payment method. No product name,
barcode, HSN, per-item price, per-item tax or itemised lines.

This is enforced structurally rather than by discipline:

- `lib/backend/receipt.ts` defines `CustomerReceiptData`, which has **no field
  capable of carrying product identity**.
- Every customer-facing output path — ESC/POS thermal, browser print fallback,
  receipt PDF — consumes only that DTO.
- `GET /api/sales/[id]/receipt` projects a stored sale down to the DTO
  *server-side*, so a reprint's network payload contains no product data either.
- `tests/receipt-privacy.test.ts` fails the build if a product name ever
  reaches a receipt.

Product-level detail is **not** removed from the database. It stays in
`sale_items` for inventory, analytics, audit, returns, GST reporting and the
formal tax invoice.

**The retail receipt and a GST tax invoice are different documents.** The
formal invoice (`lib/backend/invoice.ts` → `generateGSTInvoice`) carries full
item-level detail and rate-wise tax, and is behind the `sale.invoice.formal`
permission.

---

## Getting started

```bash
cp .env.local.example .env.local
```

Fill in `.env.local` — at minimum `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and
`SESSION_SECRET`.

```bash
npm install
npm run dev
```

### Database

Apply the migrations in order, in the Supabase SQL editor or via the CLI:

```
supabase/migrations/0001_initial.sql
supabase/migrations/0002_production_hardening.sql
```

`0002` is idempotent and safe to re-run. It repricing ₹149 → ₹99, adds the
customer/supplier/returns/stock-ledger tables, replaces the unvalidated
inventory trigger with the atomic `create_sale()` RPC, and closes RLS.

### Creating the first admin

There are no default credentials anywhere in the codebase. Bootstrap once:

```bash
# 1. Put a token in .env.local:  BOOTSTRAP_TOKEN=$(openssl rand -hex 24)
# 2. Restart the dev server, then:
curl -X POST http://localhost:3000/api/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{
    "token": "<BOOTSTRAP_TOKEN>",
    "name": "Syed (Owner)",
    "email": "owner@maxxcity.in",
    "staff_code": "OWNER",
    "pin": "482913",
    "password": "a-long-unique-password"
  }'
# 3. Remove BOOTSTRAP_TOKEN from .env.local.
```

The route refuses to run once an active admin exists. Create the remaining
staff from **Admin → Staff**.

### Commands

```bash
npm run dev        # development server
npm run build      # production build
npm run start      # serve the production build
npm run test       # vitest
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run verify     # typecheck + lint + test
```

> **If Turbopack reports "not supported on this platform"** — it is almost
> certainly not the platform. Next needs a ~116 MB native SWC binary, and the
> message appears whenever that binary cannot be loaded, for any reason.
>
> There are TWO places it can go wrong, and fixing only the first leaves the
> error in place:
>
> ```bash
> # 1. the real package — a truncated npm cache leaves the directory
> #    holding only package.json and README.md, with no .node file
> rm -rf node_modules/@next/swc-darwin-arm64
> npm cache clean --force && npm install
>
> # 2. Next's auto-downloaded fallback — created when step 1 was broken.
> #    If that download was also incomplete it is tried FIRST on every
> #    start and keeps failing even after step 1 is fixed.
> rm -rf node_modules/next/next-swc-fallback .next
> ```
>
> To confirm the binary itself is healthy before blaming the platform:
>
> ```bash
> node -e "require('@next/swc-darwin-arm64'); console.log('ok')"
> ```
>
> `npm run build:webpack` is the fallback if it genuinely will not install.

---

## Architecture

```
app/
  (auth)/login              staff-code + PIN, or email + password
  (pos)/billing             three-panel POS, keyboard-first, offline-capable
  admin/                    dashboard · inventory · sales · purchases ·
                            staff · reports · EMI · AI · audit
  api/                      every route authorises before it touches data
lib/
  config/pricing.ts         THE selling price. Single source of truth.
  config/store.ts           store identity + terminal id
  money.ts                  integer-paise arithmetic
  backend/gst.ts            GST back-calculation
  backend/receipt.ts        the sanitized customer receipt DTO
  backend/printer.ts        ESC/POS + browser fallback (DTO only)
  backend/invoice.ts        customer receipt PDF · formal GST invoice
  auth/                     PBKDF2 hashing · signed sessions · RBAC · guards
  sales/service.ts          server-authoritative sale creation
  reports/                  every dashboard figure, from real queries
  database/                 Supabase (server) · Dexie (offline) · sync engine
  validation/schemas.ts     Zod, shared by forms and route handlers
supabase/migrations/        schema
tests/                      vitest
```

### Money

All arithmetic runs in **integer paise** (`lib/money.ts`), converted back once
at the end. Rupee floats are never summed directly, and rounding shifts the
decimal point through the number's decimal string rather than multiplying by
100 — `1.005 * 100` is `100.49999999999999` in binary floating point and would
round ₹1.005 *down*. POS totals, the receipt, the database and the reports
therefore agree to the paisa.

### Transaction safety

A sale is one atomic Postgres transaction (`create_sale()`):

```
validate shift open
  → lock products (deterministic order, no deadlocks)
  → verify active, price, GST rate, stock
  → conditional decrement: WHERE stock_qty >= qty
  → write sale + sale_items + stock_movements
  → roll up shift totals + customer CRM
  → write audit row
```

Either all of it lands or none of it does. There is no window where a sale
exists without its stock movement.

- **Idempotency** — each basket carries a `client_sale_id`. A double-click, F8
  twice, a retry after a timeout or a duplicated offline sync all replay the
  same key and get the **original** sale back. No double billing.
- **Concurrency** — the decrement's `WHERE stock_qty >= qty` is the guard. If
  another counter took the last unit mid-basket, zero rows update and the whole
  transaction aborts with `INSUFFICIENT_STOCK`.
- **Print ordering** — the sale is **committed first, printed second**. A
  printer failure shows *"Sale completed — printing failed"* with a reprint
  button. A disconnected printer never creates financial uncertainty.

### Offline

The POS keeps billing through an internet outage:

- catalogue cached in IndexedDB (barcode lookup, search, categories)
- sales persisted locally, then replayed through the idempotent
  `POST /api/sales/sync`
- held bills survive a reload or a crash
- a service worker caches the app shell — but **never** any `/api/` response,
  because those carry sales, staff and customer data

**Offline invoice numbers** are namespaced `MCM/<year>/OFF-<TERMINAL>-<seq>`.
The `OFF-` marker and the terminal segment make collision impossible: two
counters billing offline draw from independent local sequences, and neither can
coincide with a server number (which comes from an atomic Postgres counter and
has no such segment).

Offline sales are validated exactly like online ones on sync — only the invoice
number and timestamp are honoured from the client, because those were already
printed on the customer's copy.

### Security

- PINs and passwords: **PBKDF2-SHA256**, 210k iterations, random salt. No API
  can return a PIN; the staff screen shows only whether one is *set*.
- Sessions: HMAC-SHA256 signed, httpOnly, `SameSite=Lax`, 12-hour expiry. Edit
  the cookie to change your role and verification fails. `SESSION_SECRET` is
  mandatory in production — the app refuses every session without it rather
  than falling back to a default.
- Authorization: a capability matrix (`lib/auth/rbac.ts`) drives the API
  guards. Proxy redirects page loads, but that is an *optimistic* check — each
  route handler independently authorises the caller, so hitting an admin API
  URL directly is rejected regardless.
- RLS: closed. `anon` and `authenticated` have no direct access to any business
  table; everything flows through server routes.
- Rate limiting: per-IP on login, plus per-account lockout after 5 failures.
- Discounts: a cashier cannot discount at all; a manager is capped at 10% /
  ₹500; an admin may override. Every discount is logged with its reason.

### What is audited

Login (success and failure), logout, sale, void, return, discount, stock
adjustment, product create/update/deactivate, staff create/update/deactivate,
shift open/close, settings change, goods receipt, receipt reprint, offline
sync, database seed. Visible at **Admin → Audit Log**.

### Honest numbers

Where a figure cannot be computed from real data, the UI says so instead of
substituting one:

- **Margin** reports its coverage percentage and excludes products with no
  recorded supplier cost.
- **Forecasts** label every day `observed`, `estimated` or `assumed`, with the
  sample size behind it.
- **AI features** report "not configured" without an API key. They never return
  invented revenue.
- **Seeding** is admin-only, blocked in production unless `ALLOW_SEED=true`,
  creates catalogue rows only (never sales), and prefixes every barcode with
  `DEMO-`.

---

## Keyboard shortcuts (POS)

| Key | Action |
| --- | --- |
| `F2` | New sale |
| `F3` | Hold current bill |
| `F4` | Held bills |
| `F5` | Reprint last receipt |
| `F8` | Confirm payment |
| `F10` | Close shift |

Barcode scanning works continuously; the input reclaims focus on its own.

---

## Remaining configuration

These need real-world values or credentials before go-live:

| Item | Status |
| --- | --- |
| `SESSION_SECRET` | **Required.** Production refuses sessions without it. |
| Supabase keys | Rotate — the previous ones were committed to `.env.local.example`. |
| GSTIN | Blank. Receipts omit the line until a real GSTIN is set. |
| UPI / card provider | **Not integrated.** The POS records the *cashier's* confirmation and says so on screen. Wiring a provider means server-side verification before a payment is marked COMPLETED. |
| Thermal printer | Web Serial, 80mm ESC/POS. Needs a physical printer and a one-time in-browser permission grant. Chrome/Edge only; other browsers fall back to the print dialog. |
| Supplier costs | Margin reporting stays partial until cost prices are entered or stock is received against purchase orders. |
| Supabase types | Generating them (`supabase gen types typescript`) would replace the hand-written row shapes in `lib/database/rows.ts`. |
| Multi-counter realtime | Terminals reconcile through the server on each request. Supabase Realtime push is not wired up. |
