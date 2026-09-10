// ═══════════════════════════════════════
// Environment pre-flight check
// ═══════════════════════════════════════
// Usage:  npm run env:check
//
// Validates .env.local against the SAME schema the application uses
// (lib/config/env-schema.ts), so this can never pass while the app fails.
//
// Reports every problem at once rather than one per restart, and never prints
// a secret — only whether each one is present and plausible.

import { serverEnvSchema } from '../lib/config/env-schema.ts';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/** Never print a secret — just enough to confirm the right value was pasted. */
function fingerprint(value: string | undefined): string {
  if (!value) return `${DIM}not set${RESET}`;
  if (value.length <= 8) return `${DIM}set (${value.length} chars)${RESET}`;
  return `${DIM}set — ${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)${RESET}`;
}

const result = serverEnvSchema.safeParse(process.env);

console.log(`\n${BOLD}MaxxCity POS — environment check${RESET}\n`);

if (!result.success) {
  console.log(`${RED}✗ Configuration is invalid${RESET}\n`);
  for (const issue of result.error.issues) {
    const name = issue.path.join('.') || '(root)';
    console.log(`  ${RED}•${RESET} ${BOLD}${name}${RESET}`);
    console.log(`    ${issue.message}\n`);
  }
  console.log(`${DIM}  Fix these in .env.local, then run this again.`);
  console.log(`  docs/ENV_SETUP.md explains where each value comes from.${RESET}\n`);
  process.exit(1);
}

const env = result.data;

console.log(`${GREEN}✓ Required configuration is valid${RESET}\n`);

console.log(`${BOLD}  Supabase${RESET}`);
console.log(`    project url            ${env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`    anon key (public)      ${fingerprint(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}`);
console.log(`    service role (SECRET)  ${fingerprint(env.SUPABASE_SERVICE_ROLE_KEY)}`);
console.log(`    database url (SECRET)  ${fingerprint(env.SUPABASE_DB_URL)}`);

console.log(`\n${BOLD}  Auth${RESET}`);
console.log(`    session secret         ${fingerprint(env.SESSION_SECRET)}`);
console.log(`    bootstrap token        ${fingerprint(env.BOOTSTRAP_TOKEN)}`);

console.log(`\n${BOLD}  Optional features${RESET}`);
const feature = (on: boolean, label: string, hint: string) =>
  console.log(
    `    ${on ? `${GREEN}enabled ${RESET}` : `${DIM}disabled${RESET}`}  ${label}` +
      (on ? '' : `  ${DIM}(${hint})${RESET}`)
  );
feature(Boolean(env.GROQ_API_KEY), 'AI assistant       ', 'set GROQ_API_KEY');
feature(Boolean(env.OPENROUTER_API_KEY), 'AI weekly insights ', 'set OPENROUTER_API_KEY');
feature(Boolean(env.SUPABASE_DB_URL), 'Migration script   ', 'set SUPABASE_DB_URL');

// ── Warnings that are not hard failures ──
const warnings: string[] = [];

if (!env.SESSION_SECRET) {
  warnings.push(
    'SESSION_SECRET is not set. Development falls back to a known insecure value; ' +
      'production will refuse every session. Generate one: openssl rand -base64 48'
  );
}

if (env.BOOTSTRAP_TOKEN) {
  warnings.push(
    'BOOTSTRAP_TOKEN is still set. Remove it from .env.local once the admin ' +
      'account exists — it exists only to create the first one.'
  );
}

if (env.ALLOW_SEED === 'true' && env.NODE_ENV === 'production') {
  warnings.push(
    'ALLOW_SEED=true in production. Demo catalogue rows in a live store corrupt ' +
      'every report. Unset it unless you genuinely intend to seed.'
  );
}

if (warnings.length > 0) {
  console.log(`\n${YELLOW}  Warnings${RESET}`);
  for (const warning of warnings) console.log(`    ${YELLOW}!${RESET} ${warning}`);
}

console.log(
  `\n${DIM}  No secret values were printed. Next: ./scripts/apply-migrations.sh${RESET}\n`
);
