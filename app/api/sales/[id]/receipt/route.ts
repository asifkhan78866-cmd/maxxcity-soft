// ═══════════════════════════════════════
// Customer Receipt (reprint)
// ═══════════════════════════════════════
// Returns ONLY the sanitized CustomerReceiptData for a historical sale.
//
// The route reads the full internal record from the database but deliberately
// projects it down to the receipt DTO before responding, so a reprint can
// never disclose product names — not even through the network payload.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { requireAuth, ok, fail, handleApiError } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { buildCustomerReceipt } from '@/lib/backend/receipt';
import { logActivity } from '@/lib/database/activity';
import { row } from '@/lib/database/rows';
import type { PaymentMethod } from '@/types';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    if (!hasPermission(session.role, 'pos.reprint')) {
      return fail('You are not permitted to reprint receipts', 403, 'FORBIDDEN');
    }

    const { id } = await params;
    const supabase = createServiceRoleClient();

    // total_items is stored on the sale, so the aggregate count needs no join
    // to sale_items — the product rows are never loaded on this path.
    const { data, error } = await supabase
      .from('sales')
      .select(
        'id, invoice_number, created_at, cashier_id, total_items, grand_total, discount, ' +
          'total_cgst, total_sgst, payment_method, amount_tendered, status, ' +
          'profiles!sales_cashier_id_fkey(name)'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    const sale = row<{
      id: string;
      invoice_number: string;
      created_at: string;
      cashier_id: string;
      total_items: number;
      grand_total: number;
      discount: number;
      total_cgst: number;
      total_sgst: number;
      payment_method: PaymentMethod;
      status: string;
      profiles: { name?: string } | null;
    }>(data);

    if (!sale) return fail('Sale not found', 404, 'SALE_NOT_FOUND');

    if (
      !hasPermission(session.role, 'sale.read.all') &&
      sale.cashier_id !== session.sub
    ) {
      return fail('You are not permitted to reprint this receipt', 403, 'FORBIDDEN');
    }

    const receipt = buildCustomerReceipt(
      {
        invoice_number: sale.invoice_number,
        grand_total: Number(sale.grand_total),
        discount: Number(sale.discount ?? 0),
        payment_method: sale.payment_method,
        total_cgst: Number(sale.total_cgst),
        total_sgst: Number(sale.total_sgst),
        created_at: sale.created_at,
        total_items: sale.total_items,
      },
      { isReprint: true, cashierName: sale.profiles?.name ?? 'Cashier' }
    );

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'RECEIPT_REPRINTED',
      entityType: 'sale',
      entityId: id,
      details: `Reprinted receipt for ${sale.invoice_number}`,
    });

    return ok({ receipt, saleStatus: sale.status });
  } catch (error) {
    return handleApiError(error, 'sales/receipt');
  }
}
