// ═══════════════════════════════════════
// Server Environment Access
// ═══════════════════════════════════════
// SERVER ONLY. Importing this from a Client Component is a build error, which
// is the point: it reads SUPABASE_SERVICE_ROLE_KEY and SUPABASE_DB_URL, and
// those must never be reachable from browser code.
//
// The validation rules live in ./env-schema so the CLI check can share them —
// see that file for why the split exists.
//
// WHY THE PUBLIC VARS ARE NOT READ THROUGH HERE
// Next.js inlines `NEXT_PUBLIC_*` into the client bundle at build time by
// textually replacing literal `process.env.NEXT_PUBLIC_X` references. A
// *dynamic* lookup — `env.NEXT_PUBLIC_X`, or destructuring `process.env` — is
// NOT inlined and comes back undefined in the browser. Reading them through a
// parsed object would break the browser build silently, so client-side public
// values are read as literals in lib/config/public-env.ts instead.
//
// Dynamic access is fine *here*, because this module only ever runs in Node.

import 'server-only';

import { serverEnvSchema, formatEnvIssues, type ServerEnv } from './env-schema';

export type { ServerEnv };

let cached: ServerEnv | null = null;

/**
 * Validated server environment.
 *
 * Validated once and memoised. Throws with every problem listed at once, so a
 * misconfiguration is fixed in one pass rather than one variable per restart.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const result = serverEnvSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(formatEnvIssues(result.error));
  }

  cached = result.data;
  return cached;
}

/**
 * Check the environment without throwing — for a health endpoint or a
 * pre-flight script that wants to report rather than crash.
 */
export function checkServerEnv():
  | { ok: true }
  | { ok: false; problems: Array<{ variable: string; message: string }> } {
  const result = serverEnvSchema.safeParse(process.env);
  if (result.success) return { ok: true };

  return {
    ok: false,
    problems: result.error.issues.map((issue) => ({
      variable: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  };
}

/** Which optional integrations are actually configured. */
export function getFeatureFlags() {
  const env = getServerEnv();
  return {
    aiQuery: Boolean(env.GROQ_API_KEY),
    aiInsights: Boolean(env.OPENROUTER_API_KEY),
    bootstrapEnabled: Boolean(env.BOOTSTRAP_TOKEN),
    seedAllowed: env.NODE_ENV !== 'production' || env.ALLOW_SEED === 'true',
  };
}

/** Test-only: drop the memoised value so a changed process.env is re-read. */
export function resetServerEnvCache(): void {
  cached = null;
}
