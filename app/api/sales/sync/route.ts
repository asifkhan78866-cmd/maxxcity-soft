// ═══════════════════════════════════════
// Offline Sale Sync
// ═══════════════════════════════════════
// Replays sales created while the terminal was offline.
//
// Two properties make this safe to call repeatedly:
//   · Idempotency — each sale carries a client_sale_id; create_sale() returns
//     the ORIGINAL sale for a key it has already seen, so a retried batch, a
//     duplicated queue entry or a double reconnect can never double-post.
//   · Server authority — an offline sale is validated exactly like an online
//     one. Prices and tax are recomputed from the catalogue; only the invoice
//     number and timestamp are honoured from the client, because those were
//     already printed on the customer's receipt.
//
// A sale that cannot be accepted (stock genuinely gone, product deleted) is
// reported back per-item so the terminal can surface it rather than silently
// dropping the transaction.

import { withPermission, ok } from '@/lib/auth/guard';
import { syncSaleSchema, parseOrThrow } from '@/lib/validation/schemas';
import { createSale } from '@/lib/sales/service';
import { logActivity } from '@/lib/database/activity';
import { z } from 'zod';

const syncBatchSchema = z.object({
  sales: z.array(syncSaleSchema).min(1).max(100),
});

export const POST = withPermission(
  'pos.sell',
  async (request, session) => {
    const body = parseOrThrow(syncBatchSchema, await request.json());

    const results: Array<{
      client_sale_id: string;
      status: 'synced' | 'duplicate' | 'failed';
      sale_id?: string;
      invoice_number?: string;
      error?: string;
      code?: string;
    }> = [];

    for (const sale of body.sales) {
      try {
        // The cashier recorded offline is trusted only as far as the session
        // allows: a cashier may sync their own sales; a manager or admin may
        // sync any terminal's backlog.
        const cashierId =
          session.role === 'CASHIER' ? session.sub : sale.cashier_id || session.sub;

        const result = await createSale({
          clientSaleId: sale.client_sale_id,
          cashierId,
          cashierRole: session.role,
          shiftId: sale.shift_id,
          items: sale.items,
          paymentMethod: sale.payment_method,
          amountTendered: sale.amount_tendered ?? null,
          discount: sale.discount,
          discountReason: sale.discount_reason ?? null,
          customerPhone: sale.customer_phone ?? null,
          customerName: sale.customer_name ?? null,
          terminalId: sale.terminal_id ?? null,
          invoiceNumber: sale.invoice_number,
          createdAt: sale.created_at,
          isOffline: true,
        });

        results.push({
          client_sale_id: sale.client_sale_id,
          status: result.duplicate ? 'duplicate' : 'synced',
          sale_id: result.sale_id,
          invoice_number: result.invoice_number,
        });

        if (!result.duplicate) {
          await logActivity({
            userId: cashierId,
            userName: session.name,
            action: 'OFFLINE_SALE_SYNCED',
            entityType: 'sale',
            entityId: result.sale_id,
            details: `Offline sale ${result.invoice_number} synced from terminal ${sale.terminal_id ?? 'unknown'}`,
            metadata: { terminal_id: sale.terminal_id, created_at: sale.created_at },
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Sync failed';
        const codeMatch = message.match(/^([A-Z_]+):\s*(.+)$/s);
        results.push({
          client_sale_id: sale.client_sale_id,
          status: 'failed',
          code: codeMatch?.[1] ?? 'SYNC_ERROR',
          error: codeMatch?.[2]?.trim() ?? message,
        });
      }
    }

    return ok({
      results,
      synced: results.filter((r) => r.status === 'synced').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      failed: results.filter((r) => r.status === 'failed').length,
    });
  },
  'sales/sync'
);
