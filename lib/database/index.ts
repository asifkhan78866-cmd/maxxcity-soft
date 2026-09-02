// ═══════════════════════════════════════
// lib/database — Database Layer Index
// ═══════════════════════════════════════
// Dexie/IndexedDB (offline) + sync engine + browser Supabase client.
//
// Server-only modules (supabase-server, activity) are NOT re-exported here:
// pulling them into this barrel would drag the service-role client into any
// client component that imports from '@/lib/database'. Import them directly
// from '@/lib/database/supabase-server' inside route handlers instead.

export {
  db,
  MaxxCityDB,
  cacheProducts,
  getCachedProducts,
  getProductByBarcode,
  searchProductsOffline,
  getCacheAgeMinutes,
  saveOfflineSale,
  getPendingSales,
  getPendingSyncCount,
  markSaleSynced,
  recordSyncFailure,
  getStuckSales,
  pruneSyncedSales,
  saveHeldBill,
  getHeldBills,
  removeHeldBill,
  getNextOfflineInvoiceNumber,
  isOfflineInvoiceNumber,
  type OfflineSale,
  type OfflineSaleItem,
  type OfflineHeldBill,
  type CachedProduct,
  type OfflineInvoiceCounter,
  type SyncFlag,
} from './dexie';

export { createClient, getSupabaseBrowser } from './supabase';

export {
  startSyncEngine,
  stopSyncEngine,
  performSync,
  forceSync,
  isOnline,
  getSyncStatus,
  getPendingCount,
  type SyncStatus,
  type SyncSummary,
} from './sync';
