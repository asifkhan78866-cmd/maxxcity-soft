// ═══════════════════════════════════════
// Dexie.js — Offline IndexedDB Store
// ═══════════════════════════════════════
// Keeps the POS billing while the internet is down:
//   · cached product catalogue (barcode lookup, search, categories)
//   · locally persisted sales awaiting sync
//   · a terminal-scoped invoice counter that cannot collide with the server's
//   · held bills that survive a page reload or a browser crash
//
// NOTE ON INDEXES: IndexedDB cannot index a boolean. The previous schema
// stored `synced: false` but queried `.equals(0)`, so unsynced sales were
// never found and nothing ever synced. Sync state is therefore a NUMBER
// (0 = pending, 1 = synced) and is indexed as such.

import Dexie, { type Table } from 'dexie';
import type { CartItem, PaymentMethod } from '@/types';

export type SyncFlag = 0 | 1;

/**
 * A sale captured on this terminal.
 *
 * Full product-level detail is kept locally for the cashier's own records and
 * for a local reprint. What gets POSTed to the server on sync is only
 * `{ product_id, qty }` per line — the server recomputes every price and tax
 * figure itself.
 */
export interface OfflineSale {
  id: string;
  /** Idempotency key — the server will never create two sales for one key. */
  client_sale_id: string;
  invoice_number: string;
  terminal_id: string;
  shift_id: string;
  cashier_id: string;
  cashier_name: string;
  items: OfflineSaleItem[];
  subtotal: number;
  total_cgst: number;
  total_sgst: number;
  total_tax: number;
  discount: number;
  discount_reason: string | null;
  grand_total: number;
  total_items: number;
  payment_method: PaymentMethod;
  amount_tendered: number | null;
  customer_phone: string | null;
  customer_name: string | null;
  /** 0 = awaiting sync, 1 = accepted by the server. */
  synced: SyncFlag;
  sync_attempts: number;
  last_sync_error: string | null;
  /** Server sale id, once known. */
  server_sale_id: string | null;
  created_at: string;
  synced_at: string | null;
}

export interface OfflineSaleItem {
  product_id: string;
  product_name: string;
  barcode: string;
  hsn_code: string;
  qty: number;
  unit_price: number;
  gst_rate: number;
  base_price: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  line_total: number;
}

export interface CachedProduct {
  id: string;
  name: string;
  barcode: string;
  category: string;
  hsn_code: string;
  gst_rate: number;
  price: number;
  stock_qty: number;
  low_stock_threshold: number;
  is_active: boolean;
  cached_at: string;
}

export interface OfflineHeldBill {
  id: string;
  label: string;
  items: CartItem[];
  customer_phone: string | null;
  customer_note: string | null;
  held_by: string | null;
  held_at: string;
}

export interface OfflineInvoiceCounter {
  id: string;
  prefix: string;
  current_number: number;
}

export class MaxxCityDB extends Dexie {
  offlineSales!: Table<OfflineSale, string>;
  cachedProducts!: Table<CachedProduct, string>;
  heldBills!: Table<OfflineHeldBill, string>;
  invoiceCounter!: Table<OfflineInvoiceCounter, string>;

  constructor() {
    super('MaxxCityMall');

    // v1 — original schema (kept so existing installs upgrade cleanly).
    this.version(1).stores({
      offlineSales: 'id, invoice_number, shift_id, cashier_id, synced, created_at',
      cachedProducts: 'id, barcode, name, category, is_active',
      syncQueue: '++id, table_name, synced, created_at',
      invoiceCounter: 'id, prefix',
    });

    // v2 — numeric sync flag, held bills, idempotency key; the separate
    // syncQueue table is dropped (offlineSales IS the queue, which removes a
    // whole class of the two going out of step).
    this.version(2)
      .stores({
        offlineSales:
          'id, client_sale_id, invoice_number, shift_id, cashier_id, synced, created_at',
        cachedProducts: 'id, barcode, name, category, is_active',
        heldBills: 'id, held_at',
        invoiceCounter: 'id, prefix',
        syncQueue: null,
      })
      .upgrade(async (tx) => {
        // Migrate boolean sync flags to the indexable numeric form.
        await tx
          .table('offlineSales')
          .toCollection()
          .modify((sale: Record<string, unknown>) => {
            sale.synced = sale.synced === true || sale.synced === 1 ? 1 : 0;
            sale.sync_attempts = sale.sync_attempts ?? 0;
            sale.last_sync_error = sale.last_sync_error ?? null;
            sale.server_sale_id = sale.server_sale_id ?? null;
            sale.client_sale_id = sale.client_sale_id ?? (sale.id as string);
          });
      });
  }
}

export const db = new MaxxCityDB();

// ─── Products ───

/**
 * Refresh the offline catalogue.
 *
 * Written inside one transaction so a failure part-way cannot leave the
 * terminal with an empty catalogue — the old cache survives instead.
 */
export async function cacheProducts(products: Omit<CachedProduct, 'cached_at'>[]): Promise<void> {
  const cachedAt = new Date().toISOString();
  await db.transaction('rw', db.cachedProducts, async () => {
    await db.cachedProducts.clear();
    await db.cachedProducts.bulkPut(products.map((p) => ({ ...p, cached_at: cachedAt })));
  });
}

export async function getCachedProducts(): Promise<CachedProduct[]> {
  return db.cachedProducts.toArray();
}

export async function getProductByBarcode(barcode: string): Promise<CachedProduct | undefined> {
  return db.cachedProducts.where('barcode').equals(barcode).first();
}

export async function searchProductsOffline(query: string): Promise<CachedProduct[]> {
  const lower = query.toLowerCase();
  return db.cachedProducts
    .filter((p) => p.name.toLowerCase().includes(lower) || p.barcode.includes(query))
    .limit(50)
    .toArray();
}

/** Age of the cache in minutes — used to warn about a stale catalogue. */
export async function getCacheAgeMinutes(): Promise<number | null> {
  const one = await db.cachedProducts.limit(1).first();
  if (!one) return null;
  return Math.floor((Date.now() - new Date(one.cached_at).getTime()) / 60_000);
}

// ─── Sales ───

export async function saveOfflineSale(sale: OfflineSale): Promise<void> {
  // put (not add) so replaying the same sale id is harmless.
  await db.offlineSales.put(sale);
}

export async function getPendingSales(): Promise<OfflineSale[]> {
  return db.offlineSales.where('synced').equals(0).sortBy('created_at');
}

export async function getPendingSyncCount(): Promise<number> {
  return db.offlineSales.where('synced').equals(0).count();
}

export async function markSaleSynced(
  clientSaleId: string,
  serverSaleId: string,
  serverInvoice?: string
): Promise<void> {
  const sale = await db.offlineSales.where('client_sale_id').equals(clientSaleId).first();
  if (!sale) return;

  await db.offlineSales.update(sale.id, {
    synced: 1,
    server_sale_id: serverSaleId,
    synced_at: new Date().toISOString(),
    last_sync_error: null,
    // The server may have assigned its own number for an online sale.
    ...(serverInvoice ? { invoice_number: serverInvoice } : {}),
  });
}

export async function recordSyncFailure(clientSaleId: string, error: string): Promise<void> {
  const sale = await db.offlineSales.where('client_sale_id').equals(clientSaleId).first();
  if (!sale) return;

  await db.offlineSales.update(sale.id, {
    sync_attempts: (sale.sync_attempts ?? 0) + 1,
    last_sync_error: error,
  });
}

/** Sales the server rejected repeatedly — surfaced for manual resolution. */
export async function getStuckSales(maxAttempts = 5): Promise<OfflineSale[]> {
  return db.offlineSales
    .where('synced')
    .equals(0)
    .filter((s) => (s.sync_attempts ?? 0) >= maxAttempts)
    .toArray();
}

/**
 * Prune synced sales older than `days`.
 * Only ever removes rows the server has confirmed — an unsynced sale is
 * never deleted, however old.
 */
export async function pruneSyncedSales(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return db.offlineSales
    .where('synced')
    .equals(1)
    .filter((s) => s.created_at < cutoff)
    .delete();
}

// ─── Held bills ───

export async function saveHeldBill(bill: OfflineHeldBill): Promise<void> {
  await db.heldBills.put(bill);
}

export async function getHeldBills(): Promise<OfflineHeldBill[]> {
  return db.heldBills.orderBy('held_at').reverse().toArray();
}

export async function removeHeldBill(id: string): Promise<void> {
  await db.heldBills.delete(id);
}

// ─── Offline invoice numbering ───

/**
 * Issue an invoice number for a sale made while offline.
 *
 * Format: `MCM/<year>/OFF-<TERMINAL>-<seq>`
 *
 * The terminal segment is what makes this collision-resistant: two counters
 * billing simultaneously offline draw from independent local sequences, and
 * the terminal id keeps the resulting strings distinct. The `OFF-` marker also
 * means an offline number can never coincide with a server-issued one, which
 * comes from the atomic Postgres counter and has no such segment.
 *
 * The number is issued inside a transaction so two rapid sales on the same
 * terminal cannot read the same counter value.
 */
export async function getNextOfflineInvoiceNumber(terminalId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MCM/${year}`;
  const counterId = `offline:${terminalId}:${year}`;

  return db.transaction('rw', db.invoiceCounter, async () => {
    const counter = await db.invoiceCounter.get(counterId);
    const next = (counter?.current_number ?? 0) + 1;

    await db.invoiceCounter.put({ id: counterId, prefix, current_number: next });

    return `${prefix}/OFF-${terminalId}-${String(next).padStart(5, '0')}`;
  });
}

/** True when a number was issued locally rather than by the server. */
export function isOfflineInvoiceNumber(invoiceNumber: string): boolean {
  return invoiceNumber.includes('/OFF-');
}
