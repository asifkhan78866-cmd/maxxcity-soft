// ═══════════════════════════════════════
// Centralised Pricing Configuration
// ═══════════════════════════════════════
// SINGLE SOURCE OF TRUTH for the MaxxCity Mall selling price.
//
// Business rule: every product is sold to the customer at a flat ₹99,
// INCLUSIVE of GST. GST is back-calculated from ₹99 using the product's
// own GST rate (see lib/backend/gst.ts).
//
// Never hardcode the selling price anywhere else — import from here.

import type { GSTRate } from '@/types';

/** Flat customer selling price (GST-inclusive) for every product. */
export const DEFAULT_PRODUCT_PRICE = 99;

/** Human-readable label used in UI copy. */
export const DEFAULT_PRODUCT_PRICE_LABEL = '₹99';

/** The selling price is quoted inclusive of GST. */
export const PRICE_IS_GST_INCLUSIVE = true;

/**
 * Price override policy.
 *
 * The business currently sells everything at the flat price. Until an explicit
 * business requirement exists for per-product prices, the server REJECTS any
 * product whose price differs from DEFAULT_PRODUCT_PRICE at sale time.
 *
 * Set ALLOW_PER_PRODUCT_PRICE to true (and update store_settings) only when
 * the business genuinely introduces variable pricing.
 */
export const ALLOW_PER_PRODUCT_PRICE = false;

/** GST rates recognised by the system. */
export const VALID_GST_RATES: readonly GSTRate[] = [5, 12, 18] as const;

/** Default GST rate applied when a category has no explicit mapping. */
export const DEFAULT_GST_RATE: GSTRate = 12;

/** Default low-stock threshold for newly created products. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 20;

/**
 * EMI / finance booking fee.
 *
 * This is an INDEPENDENT business value. It is the fee charged to book a
 * finance case with a partner (Bajaj/Snapmint/HomeCredit) and has no
 * relationship to the ₹99 product selling price. It is configured separately
 * so a change to one never silently changes the other.
 */
export const EMI_BOOKING_FEE = Number(
  process.env.NEXT_PUBLIC_EMI_BOOKING_FEE ?? 199
);

/**
 * Resolve the authoritative selling price for a product.
 * Server-side sale calculation MUST go through this function so a client can
 * never dictate the price.
 */
export function resolveSellingPrice(productPrice?: number | null): number {
  if (ALLOW_PER_PRODUCT_PRICE && typeof productPrice === 'number' && productPrice > 0) {
    return productPrice;
  }
  return DEFAULT_PRODUCT_PRICE;
}

/** True when the stored product price matches the authoritative price. */
export function isValidSellingPrice(price: number): boolean {
  if (ALLOW_PER_PRODUCT_PRICE) return price > 0;
  return Math.abs(price - DEFAULT_PRODUCT_PRICE) < 0.005;
}

/** True when the value is a GST rate the system supports. */
export function isValidGSTRate(rate: unknown): rate is GSTRate {
  return VALID_GST_RATES.includes(rate as GSTRate);
}
