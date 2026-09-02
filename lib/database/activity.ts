// ═══════════════════════════════════════
// Activity / Audit Logging
// ═══════════════════════════════════════
// Sensitive operations are recorded with actor, action, entity and metadata.
//
// Logging must never break the operation it is recording: a failure to write
// an audit row is reported to the server console but does not roll back a
// completed sale. Actions performed inside a database RPC are logged by that
// RPC in the same transaction, which is stronger — use this helper for
// operations that happen outside one (login, product edits, settings).

import 'server-only';

import { createServiceRoleClient } from './supabase-server';

export type ActivityAction =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'SALE_COMPLETED'
  | 'SALE_VOIDED'
  | 'RETURN_PROCESSED'
  | 'DISCOUNT_APPLIED'
  | 'STOCK_ADJUSTED'
  | 'PRODUCT_CREATED'
  | 'PRODUCT_UPDATED'
  | 'PRODUCT_DEACTIVATED'
  | 'STAFF_CREATED'
  | 'STAFF_UPDATED'
  | 'STAFF_DEACTIVATED'
  | 'SHIFT_OPENED'
  | 'SHIFT_CLOSED'
  | 'SETTINGS_UPDATED'
  | 'PURCHASE_ORDER_CREATED'
  | 'PURCHASE_RECEIVED'
  | 'CUSTOMER_CREATED'
  | 'RECEIPT_REPRINTED'
  | 'INVOICE_GENERATED'
  | 'OFFLINE_SALE_SYNCED'
  | 'DATABASE_SEEDED';

export interface ActivityEntry {
  userId: string | null;
  userName?: string | null;
  action: ActivityAction;
  entityType?: string;
  entityId?: string;
  details?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from('activity_log').insert({
      user_id: entry.userId,
      user_name: entry.userName ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? null,
      metadata: entry.metadata ?? null,
      ip_address: entry.ipAddress ?? null,
    });
    if (error) console.error('[activity-log] insert failed:', error.message);
  } catch (error) {
    console.error('[activity-log] unavailable:', error);
  }
}

/** Best-effort client IP from the proxy headers. */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip');
}
