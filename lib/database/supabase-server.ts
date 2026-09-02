// ═══════════════════════════════════════
// Supabase Server Clients
// ═══════════════════════════════════════
// SERVER-ONLY. The service-role key must never reach the browser — importing
// this module from a Client Component is a build error waiting to happen, so
// keep it behind route handlers and server components.

import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not configured. Copy .env.local.example to .env.local and fill it in.`
    );
  }
  return value;
}

/**
 * Anon-key client bound to the request cookies.
 * Retained for Supabase Auth flows; note that RLS now denies this client
 * access to the business tables by design.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, which cannot set cookies.
          }
        },
      },
    }
  );
}

let serviceClient: SupabaseClient | null = null;

/**
 * Service-role client — bypasses RLS.
 *
 * This is the ONLY path the application uses to read and write business data.
 * Authorization happens above it, in lib/auth/guard.ts, before any query runs.
 * Never expose it, its key, or a raw query builder to client code.
 */
export function createServiceRoleClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  serviceClient = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'x-application-name': 'maxxcity-pos' } },
    }
  );

  return serviceClient;
}

/** Convenience alias used across the API routes. */
export const db = createServiceRoleClient;
