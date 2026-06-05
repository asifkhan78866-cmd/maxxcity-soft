// ═══════════════════════════════════════
// lib/database — Database Layer Index
// ═══════════════════════════════════════
// Supabase (online) + Dexie/IndexedDB (offline) + Sync Engine

export {
  db,
  MaxxCityDB,
  cacheProducts,
  getProductByBarcode,
  searchProductsOffline,
  saveOfflineSale,
  getUnsyncedSales,
  markSaleSynced,
  getPendingSyncCount,
  getNextOfflineInvoiceNumber,
  type OfflineSale,
  type OfflineSaleItem,
  type CachedProduct,
  type SyncQueueEntry,
  type OfflineInvoiceCounter,
} from './dexie';

export { createClient, getSupabaseBrowser } from './supabase';

export { createServerSupabaseClient, createServiceRoleClient } from './supabase-server';

export {
  startSyncEngine,
  stopSyncEngine,
  performSync,
  forceSync,
  isOnline,
  getSyncStatus,
  getPendingCount,
  type SyncStatus,
} from './sync';
