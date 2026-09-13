# Deploying to Vercel

The app is one Next.js project: the API routes are the backend and the pages
are the frontend, so a single Vercel deployment covers both. Supabase stays
where it is — Vercel never holds business data.

**No credential in this document is real.** You enter every secret in Vercel's
own dashboard; they must never be committed.

---

## Before you start

**Vercel's Hobby (free) plan is for non-commercial use.** A shop till is
commercial, so this needs a Pro plan (about $20/month).

---

## 1. Import the repository

1. <https://vercel.com/new> → **Import Git Repository**
2. Pick `asifkhan78866-cmd/maxxcity-soft`
3. Framework preset: **Next.js** (detected automatically)
4. Leave build and output settings alone — the defaults are correct
5. **Do not deploy yet.** Add the environment variables first (next step), or
   the first build fails on the missing `SESSION_SECRET`.

Pushing to `main` deploys automatically from then on.

---

## 2. Environment variables

**Settings → Environment Variables**, for the **Production** environment.
Take the values from your local `.env.local`.

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public. Row level security denies it every table |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Secret.** Full database access |
| `SESSION_SECRET` | Yes | **Secret.** The build refuses to run in production without it |
| `NEXT_PUBLIC_STORE_NAME` | No | Printed on receipts |
| `NEXT_PUBLIC_STORE_ADDRESS` | No | Printed on receipts |
| `NEXT_PUBLIC_STORE_CITY` | No | Printed on receipts |
| `NEXT_PUBLIC_STORE_PHONE` | No | Printed on receipts |
| `NEXT_PUBLIC_STORE_GSTIN` | No | Leave unset until a real GSTIN is issued |
| `NEXT_PUBLIC_STORE_UPI_ID` | No | Shown on the UPI payment panel |
| `NEXT_PUBLIC_EMI_BOOKING_FEE` | No | Defaults to 199 |
| `GROQ_API_KEY` | No | **Secret.** Without it the AI screens report themselves unconfigured |
| `OPENROUTER_API_KEY` | No | **Secret.** Same |

### Deliberately NOT set on Vercel

| Variable | Why |
| --- | --- |
| `SUPABASE_DB_URL` | Only `scripts/apply-migrations.sh` uses it, from your own machine. It carries the database password |
| `BOOTSTRAP_TOKEN` | Creates the first admin. Your admin already exists |
| `NEXT_PUBLIC_TERMINAL_ID` | **Must stay unset.** One value here would give every till the same terminal id, and offline invoice numbers from two tills could then collide. Unset, each browser generates and keeps its own |
| `ALLOW_SEED` | Demo rows in a live shop corrupt every report |

> `NEXT_PUBLIC_*` values are frozen into the browser bundle at **build** time.
> Changing one takes effect only after a redeploy.

---

## 3. Region

`vercel.json` pins the functions to **`icn1` (Seoul)** because the Supabase
project runs in `ap-northeast-2` (Seoul). Each page makes several database
calls, so keeping them in the same region matters more than being near
Adilabad.

Moving Supabase to Mumbai later? Change the region to `bom1` in the same file
and redeploy.

---

## 4. After the first deploy

Check, in this order:

1. **Sign in** at `https://<your-app>.vercel.app/login` — staff code and PIN
2. **A sale** goes through and the invoice number continues the same series
   (both this deployment and the local server share one database and one
   invoice counter, so they cannot collide)
3. **Reports** show today's takings
4. **Printing:** over HTTPS the thermal printer works from any till PC in
   Chrome. On the LAN server it only ever worked on the machine itself,
   because the Web Serial API needs a secure origin

---

## 5. Migrations stay manual

Vercel never runs migrations. When `supabase/migrations/` gains a file, apply
it yourself from your machine and then redeploy:

```bash
./scripts/apply-migrations.sh
```

The script tracks what it has already applied and never resets anything.

---

## Running both the local server and Vercel

They can run together against the same Supabase project, and this is the
recommended setup:

- **Local (`com.maxxcity.pos` on port 3000)** — the till's primary. Keeps
  working when the internet drops, and is faster on the LAN.
- **Vercel** — printing over HTTPS on other machines, plus sales and reports
  from anywhere.

Nothing conflicts: every sale goes through the same idempotent `create_sale`
function, and offline invoice numbers are namespaced per terminal.

The internet is the trade-off. A till that opens a fresh browser with no
connection gets nothing from Vercel, whereas the local server still serves the
LAN. Once a browser has loaded the app, the service worker keeps the screen
available and queues offline sales in IndexedDB either way.
