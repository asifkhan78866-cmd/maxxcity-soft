// ═══════════════════════════════════════
// Server Environment Schema
// ═══════════════════════════════════════
// The validation RULES only — no values, no secrets, and deliberately NO
// `server-only` guard, so tooling can import it too:
//   · lib/config/env.ts wraps it with the server-only guard and memoisation
//   · scripts/check-env.mts reuses it from the CLI
//
// Splitting it this way keeps one definition of "valid configuration". A
// second copy in a script would drift, and the drift would only be noticed
// when a deploy failed.

import { z } from 'zod';

/**
 * A value that is obviously still a placeholder from .env.example.
 *
 * Matched ANYWHERE in the string, not just at the start: the commonest miss is
 * `https://your-project-ref.supabase.co`, which begins with `https://` and so
 * slips past a start-anchored pattern. Real Supabase URLs are a random
 * lowercase ref, and real keys are JWTs — neither contains these fragments.
 */
const PLACEHOLDER = /(your-|your_|changeme|placeholder|<your|xxxx|todo:)/i;

/**
 * Treat an empty string as "not set".
 *
 * `.env` files routinely carry blank optional keys (`GROQ_API_KEY=`), and dotenv
 * loads those as `''` rather than omitting them. Without this, a blank optional
 * variable fails as "too short" instead of simply disabling its feature.
 */
function optionalText<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
}

export const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // ── Supabase (the URL and anon key are public, but the server needs them too) ──
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .url('must be a full URL, e.g. https://your-ref.supabase.co')
      .refine((v) => !PLACEHOLDER.test(v), 'still set to the placeholder value'),

    NEXT_PUBLIC_SUPABASE_ANON_KEY: z
      .string()
      .min(20, 'looks too short to be a real key')
      .refine((v) => !PLACEHOLDER.test(v), 'still set to the placeholder value'),

    // ── Server-only secret. Bypasses row level security. ──
    SUPABASE_SERVICE_ROLE_KEY: z
      .string()
      .min(20, 'looks too short to be a real key')
      .refine((v) => !PLACEHOLDER.test(v), 'still set to the placeholder value'),

    // ── Signs the session cookie. ──
    SESSION_SECRET: optionalText(
      z.string().min(32, 'must be at least 32 characters — generate with: openssl rand -base64 48')
    ),

    // ── Optional ──
    BOOTSTRAP_TOKEN: optionalText(z.string().min(16, 'must be at least 16 characters')),
    GROQ_API_KEY: optionalText(z.string().min(1)),
    OPENROUTER_API_KEY: optionalText(z.string().min(1)),
    ALLOW_SEED: optionalText(z.enum(['true', 'false'])),

    // ── Tooling only: used by scripts/apply-migrations.sh, never by the app. ──
    SUPABASE_DB_URL: optionalText(
      z
        .string()
        .refine(
          (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
          'must be a postgresql:// connection URI'
        )
    ),
  })
  // A missing session secret is fatal in production: without it the app would
  // otherwise fall back to a known dev value and every session becomes forgeable.
  .refine((env) => env.NODE_ENV !== 'production' || Boolean(env.SESSION_SECRET), {
    message:
      'SESSION_SECRET is required in production. Generate one with: openssl rand -base64 48',
    path: ['SESSION_SECRET'],
  })
  // A very common and very dangerous misconfiguration — it silently downgrades
  // every server query to anon permissions, so writes fail in confusing ways.
  .refine((env) => env.SUPABASE_SERVICE_ROLE_KEY !== env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    message:
      'SUPABASE_SERVICE_ROLE_KEY is the same value as the anon key — copy the service_role / secret key instead',
    path: ['SUPABASE_SERVICE_ROLE_KEY'],
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Render Zod issues as a readable block, listing every problem at once. */
export function formatEnvIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  • ${name}: ${issue.message}`;
  });

  return [
    '',
    '  ╭─────────────────────────────────────────────────────────────╮',
    '  │  Environment configuration is invalid                        │',
    '  ╰─────────────────────────────────────────────────────────────╯',
    '',
    ...lines,
    '',
    '  Fix these in .env.local, then restart the server.',
    '  See docs/ENV_SETUP.md for where each value comes from.',
    '',
  ].join('\n');
}
