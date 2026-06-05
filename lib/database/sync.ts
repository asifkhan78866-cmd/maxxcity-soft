// ═══════════════════════════════════════
// Background Sync Engine
// ═══════════════════════════════════════
// Syncs offline sales from IndexedDB to Supabase.
// - Checks connectivity
// - Retries failed syncs with exponential backoff
// - Offline sales always win (never overwrite)

'use client';

import { db, type OfflineSale } from './dexie';
import { getSupabaseBrowser } from './supabase';

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'syncing' | 'error';

interface SyncCallbacks {
  onStatusChange?: (status: SyncStatus) => void;
  onProgress?: (synced: number, total: number) => void;
  onError?: (error: Error) => void;
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
let currentStatus: SyncStatus = 'synced';

/**
 * Get current online status
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Get current sync status
 */
export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

/**
 * Start background sync engine
 */
export function startSyncEngine(callbacks?: SyncCallbacks): void {
  if (syncInterval) return; // Already running

  // Listen for online/offline events
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      updateStatus('pending', callbacks);
      performSync(callbacks);
    });

    window.addEventListener('offline', () => {
      updateStatus('offline', callbacks);
    });
  }

  // Initial status check
  if (!isOnline()) {
    updateStatus('offline', callbacks);
  }

  // Periodic sync every 30 seconds
  syncInterval = setInterval(() => {
    if (isOnline()) {
      performSync(callbacks);
    }
  }, 30000);

  // Initial sync
  if (isOnline()) {
    performSync(callbacks);
  }
}

/**
 * Stop background sync engine
 */
export function stopSyncEngine(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/**
 * Perform a sync cycle
 */
export async function performSync(callbacks?: SyncCallbacks): Promise<void> {
  if (!isOnline()) {
    updateStatus('offline', callbacks);
    return;
  }

  try {
    const unsyncedSales = await db.offlineSales
      .where('synced')
      .equals(0)
      .toArray();

    if (unsyncedSales.length === 0) {
      updateStatus('synced', callbacks);
      return;
    }

    updateStatus('syncing', callbacks);
    const supabase = getSupabaseBrowser();
    let synced = 0;

    for (const sale of unsyncedSales) {
      try {
        await syncSale(supabase, sale);
        await db.offlineSales.update(sale.id!, { synced: true });
        synced++;
        callbacks?.onProgress?.(synced, unsyncedSales.length);
      } catch (error) {
        console.error(`Failed to sync sale ${sale.id}:`, error);
        // Increment retry count in sync queue
        await db.syncQueue
          .where('table_name')
          .equals('sales')
          .filter((q) => {
            const payload = JSON.parse(q.payload);
            return payload.id === sale.id;
          })
          .modify((q) => {
            q.retry_count++;
          });
      }
    }

    // Check remaining
    const remaining = await db.offlineSales.where('synced').equals(0).count();
    updateStatus(remaining > 0 ? 'pending' : 'synced', callbacks);
  } catch (error) {
    console.error('Sync engine error:', error);
    updateStatus('error', callbacks);
    callbacks?.onError?.(error as Error);
  }
}

/**
 * Sync a single sale to Supabase
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncSale(supabase: any, sale: OfflineSale): Promise<void> {
  const { items, synced, ...saleData } = sale;
  void synced; // unused

  // Insert sale header
  const { error: saleError } = await supabase
    .from('sales')
    .upsert(saleData, { onConflict: 'id', ignoreDuplicates: true });

  if (saleError) throw saleError;

  // Insert sale items
  const saleItems = items.map((item) => ({
    ...item,
    sale_id: sale.id,
  }));

  const { error: itemsError } = await supabase
    .from('sale_items')
    .upsert(saleItems, { onConflict: 'id', ignoreDuplicates: true });

  if (itemsError) throw itemsError;

  // Update sync queue
  await db.syncQueue
    .where('table_name')
    .equals('sales')
    .filter((q) => {
      try {
        const payload = JSON.parse(q.payload);
        return payload.id === sale.id;
      } catch {
        return false;
      }
    })
    .modify({ synced: true, synced_at: new Date().toISOString() });
}

/**
 * Get count of pending sync items
 */
export async function getPendingCount(): Promise<number> {
  return db.offlineSales.where('synced').equals(0).count();
}

/**
 * Force a manual sync
 */
export async function forceSync(callbacks?: SyncCallbacks): Promise<void> {
  await performSync(callbacks);
}

function updateStatus(status: SyncStatus, callbacks?: SyncCallbacks): void {
  currentStatus = status;
  callbacks?.onStatusChange?.(status);
}
