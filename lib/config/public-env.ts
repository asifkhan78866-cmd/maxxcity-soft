// ═══════════════════════════════════════
// Public Environment (browser-safe)
// ═══════════════════════════════════════
// Every value here is `NEXT_PUBLIC_*`, meaning Next.js inlines it into the
// JavaScript sent to the browser. Treat all of it as PUBLISHED — never put a
// secret behind this prefix. Server-only values live in lib/config/env.ts,
// which cannot be imported from client code.
//
// ⚠️  READ THIS BEFORE EDITING
// Each variable below MUST be written as a literal `process.env.NEXT_PUBLIC_X`.
// Next.js inlines these by textual replacement at build time; a dynamic lookup
// is NOT inlined and returns undefined in the browser:
//
//     const key = 'NEXT_PUBLIC_SUPABASE_URL';
//     process.env[key]                        // ✗ undefined in the browser
//     const { NEXT_PUBLIC_SUPABASE_URL } = process.env;  // ✗ undefined
//     process.env.NEXT_PUBLIC_SUPABASE_URL    // ✓ inlined
//
// So the literals are read first, and only the resulting object is validated.
// Validating `process.env` itself with a schema would break the browser build
// silently — the values would simply be missing at runtime.

/** Raw literal reads. Do not refactor into a loop or a destructure. */
const raw = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  storeName: process.env.NEXT_PUBLIC_STORE_NAME,
  storeAddress: process.env.NEXT_PUBLIC_STORE_ADDRESS,
  storeCity: process.env.NEXT_PUBLIC_STORE_CITY,
  storeGstin: process.env.NEXT_PUBLIC_STORE_GSTIN,
  storePhone: process.env.NEXT_PUBLIC_STORE_PHONE,
  storeUpiId: process.env.NEXT_PUBLIC_STORE_UPI_ID,
  terminalId: process.env.NEXT_PUBLIC_TERMINAL_ID,
  emiBookingFee: process.env.NEXT_PUBLIC_EMI_BOOKING_FEE,
} as const;

export const publicEnv = {
  /** Required for any Supabase call. */
  supabaseUrl: raw.supabaseUrl ?? '',
  supabaseAnonKey: raw.supabaseAnonKey ?? '',

  /** Store identity — all optional, with sensible defaults. */
  storeName: raw.storeName || 'MaxxCity Mall',
  storeAddress: raw.storeAddress || 'Ramnagar Main Road',
  storeCity: raw.storeCity || 'Adilabad, Telangana 504001',
  /** Blank until a real GSTIN is issued; receipts omit the line rather than
   *  printing a placeholder, which would be legally misleading. */
  storeGstin: raw.storeGstin || '',
  storePhone: raw.storePhone || '',
  storeUpiId: raw.storeUpiId || '',

  /** Empty means "generate a stable per-browser id" (see config/store.ts). */
  terminalId: raw.terminalId || '',

  /** Finance booking fee — independent of the product selling price. */
  emiBookingFee: Number(raw.emiBookingFee ?? 199),
} as const;

/**
 * Whether the Supabase public config is present.
 * Used to show a helpful message instead of an opaque network failure when
 * someone runs the app before filling in .env.local.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}
