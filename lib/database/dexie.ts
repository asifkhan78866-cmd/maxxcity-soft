// ═══════════════════════════════════════
// Dexie.js - Offline IndexedDB Database
// ═══════════════════════════════════════

import Dexie, { type Table } from 'dexie';

// ─── Offline DB Types ───
export interface OfflineSale {
  id?: string;
  invoice_number: string;
  shift_id: string;
  cashier_id: string;
  subtotal: number;
  total_cgst: number;
  total_sgst: number;
  total_tax: number;
  discount: number;
  grand_total: number;
  payment_method: string;
  payment_status: string;
  status: string;
  items: OfflineSaleItem[];
  synced: boolean;
  created_at: string;
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

export interface SyncQueueEntry {
  id?: number;
  table_name: string;
  operation: string;
  payload: string; // JSON stringified
  synced: boolean;
  retry_count: number;
  created_at: string;
  synced_at: string | null;
}

export interface OfflineInvoiceCounter {
  id: string;
  prefix: string;
  current_number: number;
}

// ─── Database Class ───
export class MaxxCityDB extends Dexie {
  offlineSales!: Table<OfflineSale, string>;
  cachedProducts!: Table<CachedProduct, string>;
  syncQueue!: Table<SyncQueueEntry, number>;
  invoiceCounter!: Table<OfflineInvoiceCounter, string>;

  constructor() {
    super('MaxxCityMall');

    this.version(1).stores({
      offlineSales: 'id, invoice_number, shift_id, cashier_id, synced, created_at',
      cachedProducts: 'id, barcode, name, category, is_active',
      syncQueue: '++id, table_name, synced, created_at',
      invoiceCounter: 'id, prefix',
    });
  }
}

// Singleton instance
export const db = new MaxxCityDB();

// ─── Helper Functions ───

/**
 * Cache all products from Supabase to IndexedDB for offline use
 */
export async function cacheProducts(products: CachedProduct[]) {
  await db.cachedProducts.clear();
  await db.cachedProducts.bulkAdd(
    products.map((p) => ({ ...p, cached_at: new Date().toISOString() }))
  );
}

/**
 * Get a product by barcode from offline cache
 */
export async function getProductByBarcode(barcode: string): Promise<CachedProduct | undefined> {
  return db.cachedProducts.where('barcode').equals(barcode).first();
}

/**
 * Search products in offline cache
 */
export async function searchProductsOffline(query: string): Promise<CachedProduct[]> {
  const lower = query.toLowerCase();
  return db.cachedProducts
    .filter(
      (p) =>
        p.name.toLowerCase().includes(lower) ||
        p.barcode.includes(query)
    )
    .limit(20)
    .toArray();
}

/**
 * Save a sale to IndexedDB for offline storage
 */
export async function saveOfflineSale(sale: OfflineSale): Promise<void> {
  await db.offlineSales.add(sale);
  // Also add to sync queue
  await db.syncQueue.add({
    table_name: 'sales',
    operation: 'INSERT',
    payload: JSON.stringify(sale),
    synced: false,
    retry_count: 0,
    created_at: new Date().toISOString(),
    synced_at: null,
  });
}

/**
 * Get all unsynced sales
 */
export async function getUnsyncedSales(): Promise<OfflineSale[]> {
  return db.offlineSales.where('synced').equals(0).toArray();
}

/**
 * Mark a sale as synced
 */
export async function markSaleSynced(saleId: string): Promise<void> {
  await db.offlineSales.update(saleId, { synced: true });
}

/**
 * Get pending sync count
 */
export async function getPendingSyncCount(): Promise<number> {
  return db.syncQueue.where('synced').equals(0).count();
}

/**
 * Get or initialize the offline invoice counter
 */
export async function getNextOfflineInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MCM/${year}`;
  
  let counter = await db.invoiceCounter.get('main');
  if (!counter) {
    counter = { id: 'main', prefix, current_number: 0 };
    await db.invoiceCounter.add(counter);
  }

  const next = counter.current_number + 1;
  await db.invoiceCounter.update('main', { current_number: next, prefix });

  return `${prefix}/${String(next).padStart(6, '0')}`;
}
