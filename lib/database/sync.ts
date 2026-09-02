// ═══════════════════════════════════════
// Background Sync Engine
// ═══════════════════════════════════════
// Replays offline sales to the server once connectivity returns.
//
// Two changes from the original design matter:
//
//  1. Sync goes through POST /api/sales/sync, NOT straight to Supabase from
//     the browser. The old path used the anon key client-side, which meant the
//     browser could write sale rows directly — no stock validation, no server
//     price authority, and it required RLS policies open enough to be a
//     serious exposure. Everything now runs through the authorised, atomic
//     server route.
//
//  2. Duplicate protection is the server's `client_sale_id` idempotency key,
//     not local bookkeeping. A sale replayed twice — retry, reconnect race,
//     two tabs — returns the ORIGINAL sale and creates nothing.

'use client';

import {
  db,
  getPendingSales,
  markSaleSynced,
  recordSyncFailure,
  pruneSyncedSales,
  type OfflineSale,
} from './dexie';

export type SyncStatus = 'synced' | 'pending' | 'offline' | 'syncing' | 'error';

export interface SyncSummary {
  synced: number;
  duplicates: number;
  failed: number;
  pending: number;
}

interface SyncCallbacks {
  onStatusChange?: (status: SyncStatus) => void;
  onProgress?: (summary: SyncSummary) => void;
  onError?: (error: Error) => void;
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
let currentStatus: SyncStatus = 'synced';
/** Guards against two cycles overlapping (timer + online event together). */
let inFlight = false;

const SYNC_INTERVAL_MS = 30_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

function updateStatus(status: SyncStatus, callbacks?: SyncCallbacks): void {
  currentStatus = status;
  callbacks?.onStatusChange?.(status);
}

export function startSyncEngine(callbacks?: SyncCallbacks): void {
  if (syncInterval) return;

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      updateStatus('pending', callbacks);
      void performSync(callbacks);
    });
    window.addEventListener('offline', () => updateStatus('offline', callbacks));
  }

  if (!isOnline()) updateStatus('offline', callbacks);

  syncInterval = setInterval(() => {
    if (isOnline()) void performSync(callbacks);
  }, SYNC_INTERVAL_MS);

  if (isOnline()) void performSync(callbacks);

  // Housekeeping: drop confirmed sales older than a month. Unsynced sales are
  // never pruned regardless of age.
  void pruneSyncedSales(30).catch(() => {});
}

export function stopSyncEngine(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

/** Convert a locally stored sale into the server's sync payload. */
function toSyncPayload(sale: OfflineSale) {
  return {
    client_sale_id: sale.client_sale_id,
    invoice_number: sale.invoice_number,
    created_at: sale.created_at,
    cashier_id: sale.cashier_id,
    shift_id: sale.shift_id,
    terminal_id: sale.terminal_id,
    payment_method: sale.payment_method,
    amount_tendered: sale.amount_tendered,
    discount: sale.discount,
    discount_reason: sale.discount_reason,
    customer_phone: sale.customer_phone,
    customer_name: sale.customer_name,
    // Only product_id and qty cross the wire. The server derives price, GST
    // and totals from the catalogue — the local figures are for the cashier's
    // copy, never for the ledger.
    items: sale.items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
  };
}

export async function performSync(callbacks?: SyncCallbacks): Promise<SyncSummary> {
  const empty: SyncSummary = { synced: 0, duplicates: 0, failed: 0, pending: 0 };

  if (!isOnline()) {
    updateStatus('offline', callbacks);
    return empty;
  }
  if (inFlight) return empty;

  inFlight = true;

  try {
    const pending = (await getPendingSales()).filter(
      (s) => (s.sync_attempts ?? 0) < MAX_ATTEMPTS
    );

    if (pending.length === 0) {
      const remaining = await db.offlineSales.where('synced').equals(0).count();
      updateStatus(remaining > 0 ? 'error' : 'synced', callbacks);
      return { ...empty, pending: remaining };
    }

    updateStatus('syncing', callbacks);

    const summary: SyncSummary = { synced: 0, duplicates: 0, failed: 0, pending: 0 };

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);

      const response = await fetch('/api/sales/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales: batch.map(toSyncPayload) }),
      });

      if (!response.ok) {
        // A whole-batch failure (auth expired, server down) is transient —
        // count an attempt against each sale and try again next cycle.
        const message = `Sync request failed (${response.status})`;
        await Promise.all(batch.map((s) => recordSyncFailure(s.client_sale_id, message)));
        summary.failed += batch.length;
        continue;
      }

      const payload = await response.json();
      const results: Array<{
        client_sale_id: string;
        status: 'synced' | 'duplicate' | 'failed';
        sale_id?: string;
        invoice_number?: string;
        error?: string;
      }> = payload?.data?.results ?? [];

      for (const result of results) {
        if (result.status === 'synced' || result.status === 'duplicate') {
          await markSaleSynced(
            result.client_sale_id,
            result.sale_id ?? '',
            result.invoice_number
          );
          if (result.status === 'synced') summary.synced++;
          else summary.duplicates++;
        } else {
          await recordSyncFailure(result.client_sale_id, result.error ?? 'Rejected by server');
          summary.failed++;
        }
      }

      callbacks?.onProgress?.(summary);
    }

    summary.pending = await db.offlineSales.where('synced').equals(0).count();
    updateStatus(
      summary.failed > 0 ? 'error' : summary.pending > 0 ? 'pending' : 'synced',
      callbacks
    );

    return summary;
  } catch (error) {
    console.error('Sync engine error:', error);
    updateStatus('error', callbacks);
    callbacks?.onError?.(error as Error);
    return empty;
  } finally {
    inFlight = false;
  }
}

export async function getPendingCount(): Promise<number> {
  return db.offlineSales.where('synced').equals(0).count();
}

export async function forceSync(callbacks?: SyncCallbacks): Promise<SyncSummary> {
  return performSync(callbacks);
}
