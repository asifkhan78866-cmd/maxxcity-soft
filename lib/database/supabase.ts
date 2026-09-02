// ═══════════════════════════════════════
// Supabase Browser Client
// ═══════════════════════════════════════
// NOT a data path. Row level security denies the anon key every business
// table (see migration 0002), so this client cannot read sales, products,
// staff or customers. All data access goes through the authorised server
// route handlers.
//
// It is kept for Supabase-hosted flows that legitimately run in the browser
// (storage, realtime channels, Supabase Auth if it is ever adopted alongside
// the app's own session). The offline sync engine deliberately does NOT use
// it: it posts to /api/sales/sync so every offline sale is revalidated and
// priced by the server.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (!browserClient) browserClient = createClient();
  return browserClient;
}
