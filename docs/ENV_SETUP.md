# Environment Setup

How to configure MaxxCity Mart POS from a blank slate. Written to be followed
in order — each step depends on the one before it.

**No credential in this document is real.** Everything in `CAPITALS` or
`your-...` form is a placeholder you replace with your own value.

---

## The one rule that matters

There are two kinds of variable in this project, and mixing them up is the
mistake that causes real damage:

| | Prefix | Who can see it | Examples |
| --- | --- | --- | --- |
| **Public** | `NEXT_PUBLIC_` | **Everyone.** Baked into the JavaScript sent to every browser. | Project URL, anon key, store name |
| **Secret** | no prefix | Server only. Never leaves your machine or host. | Service-role key, database URL, session secret |

Anything you put behind `NEXT_PUBLIC_` is **published**. Adding that prefix to
a secret does not "make it work" — it hands the secret to every visitor.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com> and sign in.
2. **New project**.
3. Pick a name (e.g. `maxxcity-pos`) and a region close to Adilabad —
   **Mumbai (ap-south-1)** is the nearest.
4. Set a **database password**. Save it in your password manager now; you
   need it in step 5 and Supabase will not show it again.
5. Wait for provisioning (~2 minutes).

---

## 2. Find the Project URL

**Project Settings → Data API → Project URL**

Looks like:

```
https://abcdefghijklmnop.supabase.co
```

Goes into `.env.local` as:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
```

Public. Safe in the browser.

---

## 3. Find the publishable / anon key

**Project Settings → API Keys**

Take the key labelled **`anon` / `public`** (newer projects call this the
**publishable** key). It is a long JWT starting `eyJ...`.

```bash
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Public by design. On its own it cannot read your business data — row level
security denies it every table (see `supabase/migrations/0002_*.sql`).

---

## 4. Find the secret / service_role key

**Project Settings → API Keys → `service_role`** (newer projects: **secret**
key). You will have to click to reveal it.

```bash
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

> ### ⚠️ This key bypasses all security
>
> Anyone holding it has complete read and write access to every table —
> sales, staff, customers, everything. It is the single most sensitive value
> in this project.
>
> - **Never** prefix it with `NEXT_PUBLIC_`
> - **Never** import it into a React component or any `'use client'` file
> - **Never** paste it into a browser console, a chat, or a screenshot
> - If it leaks: **Project Settings → API Keys → Reset** immediately

---

## 5. Get the PostgreSQL connection string

Only needed to run migrations. The application never reads it.

**Project Settings → Database → Connection string → URI**, and choose the
**Session pooler** (port `5432`).

```
postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with the database password from step 1, then:

```bash
SUPABASE_DB_URL="postgresql://postgres.abcdefghijklmnop:mypassword@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
```

Quote it — passwords often contain `#`, `&` or `?`, which otherwise break the
line. Secret: it contains your database password in plain text.

---

## 6. Put the values in `.env.local`

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in what you gathered above, plus a session secret:

```bash
# generates a strong value and appends it
echo "SESSION_SECRET=$(openssl rand -base64 48)" >> .env.local
```

`.env.local` is gitignored and must never be committed. `.env.example` holds
placeholders only and is the file that *is* committed.

### Where each value goes

| Variable | Required | Visibility | Source |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public | Step 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public | Step 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Secret** | Step 4 |
| `SESSION_SECRET` | Yes (production) | **Secret** | `openssl rand -base64 48` |
| `SUPABASE_DB_URL` | Migrations only | **Secret** | Step 5 |
| `BOOTSTRAP_TOKEN` | Temporary | **Secret** | `openssl rand -hex 24` |
| `GROQ_API_KEY` | No | **Secret** | <https://console.groq.com> |
| `OPENROUTER_API_KEY` | No | **Secret** | <https://openrouter.ai/keys> |
| `NEXT_PUBLIC_STORE_*` | No | Public | Your store details |
| `NEXT_PUBLIC_TERMINAL_ID` | No | Public | A distinct id per counter |
| `NEXT_PUBLIC_EMI_BOOKING_FEE` | No | Public | Your finance partner's fee |

---

## 7. What must never be exposed

Three values, in order of severity:

1. **`SUPABASE_SERVICE_ROLE_KEY`** — full database access, bypasses RLS
2. **`SUPABASE_DB_URL`** — contains the database password
3. **`SESSION_SECRET`** — whoever has it can forge an admin session

The codebase enforces this structurally rather than by convention:

- `lib/config/env.ts` and `lib/database/supabase-server.ts` both begin with
  `import 'server-only'`. Importing either from a Client Component is a
  **build error**, not a runtime surprise.
- Public values are isolated in `lib/config/public-env.ts`, which contains
  nothing secret.
- `.gitignore` blocks `.env`, `.env.local` and `.env.*.local`.

---

## 8. Verify the configuration

```bash
npm run env:check
```

This validates everything and reports each problem at once, rather than one
per restart. A healthy run prints the configured features and confirms no
secret is set to a placeholder.

To prove secrets are genuinely absent from the browser bundle:

```bash
npm run env:audit
```

That builds the app and greps the client chunks for your service-role key and
database URL. It fails loudly if either is found.

---

## 9. Run migrations safely

```bash
./scripts/apply-migrations.sh
```

Applies every file in `supabase/migrations/` in order, each inside a single
transaction — a migration either applies completely or not at all, so a
half-applied schema is impossible.

Before pointing it at a real database, rehearse against a throwaway local one:

```bash
npm run test:db
```

That applies the same migrations to a scratch Postgres and exercises the
business logic (₹99 × 7 = ₹693, idempotent replays, oversell refusal, void
restoring stock). It never touches Supabase.

> The script does not drop, reset or truncate anything. `0002` is idempotent
> and safe to re-run.

---

## 10. Create the MaxxCity admin account

There are no default credentials anywhere in this codebase.

```bash
# 1. Enable bootstrap and restart the dev server so it reads the token
echo "BOOTSTRAP_TOKEN=$(openssl rand -hex 24)" >> .env.local

# 2. Create the account — the PIN is an argument, so it is never written
#    to a file or committed
./scripts/create-admin.sh 9154 "Syed Asif" SYED

# 3. Remove the BOOTSTRAP_TOKEN line from .env.local
```

Sign in at <http://localhost:3000/login> → **Staff PIN** tab → staff code
`SYED`, PIN `9154`.

A PIN alone is enough; the counter signs in with staff code + PIN. The route
refuses to run once an active admin exists — create everyone else from
**Admin → Staff**.

---

## Troubleshooting

**"Environment configuration is invalid"**
The message lists every offending variable. Most often a placeholder was left
in `.env.local`, or the server was started before the file was saved.

**"SUPABASE_SERVICE_ROLE_KEY is the same value as the anon key"**
Both keys look alike (`eyJ...`). Re-copy the `service_role` one — with the
anon key, every server write fails on row level security in confusing ways.

**Changes to `.env.local` seem ignored**
Next.js reads env files at startup, and `NEXT_PUBLIC_*` values are frozen into
the bundle at **build** time. Restart `npm run dev`; for a production build,
rebuild.

**`fetch failed` on every query**
The project URL is wrong or the project was deleted. Check it resolves:

```bash
nslookup your-project-ref.supabase.co
```
