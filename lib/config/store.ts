// ═══════════════════════════════════════
// Store Configuration
// ═══════════════════════════════════════
// Store identity used on receipts, invoices and reports.
// Values come from environment variables so the same build can serve
// a different outlet without a code change.

import { publicEnv } from './public-env';

export interface StoreConfig {
  name: string;
  address: string;
  city: string;
  gstin: string;
  phone: string;
  upiId: string;
}

export const STORE_CONFIG: StoreConfig = {
  name: publicEnv.storeName,
  address: publicEnv.storeAddress,
  city: publicEnv.storeCity,
  // Empty until the real GSTIN is provided. Receipts omit the line when blank
  // rather than printing a placeholder that would be legally misleading.
  gstin: publicEnv.storeGstin,
  phone: publicEnv.storePhone,
  upiId: publicEnv.storeUpiId,
};

/**
 * Terminal / counter identity.
 *
 * Each POS terminal must have a distinct id so offline invoice numbers from
 * different counters can never collide. Configure NEXT_PUBLIC_TERMINAL_ID per
 * machine; when unset a stable per-browser id is generated and persisted.
 */
export const CONFIGURED_TERMINAL_ID = publicEnv.terminalId;

const TERMINAL_STORAGE_KEY = 'maxxcity_terminal_id';

/** Get (or lazily create) this browser's terminal id. Client-side only. */
export function getTerminalId(): string {
  if (CONFIGURED_TERMINAL_ID) return CONFIGURED_TERMINAL_ID;
  if (typeof window === 'undefined') return 'SERVER';

  try {
    const existing = window.localStorage.getItem(TERMINAL_STORAGE_KEY);
    if (existing) return existing;
    const generated = `T${crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    window.localStorage.setItem(TERMINAL_STORAGE_KEY, generated);
    return generated;
  } catch {
    // Private browsing / storage disabled — fall back to a session-scoped id.
    return `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }
}
