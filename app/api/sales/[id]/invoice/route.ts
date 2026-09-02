// ═══════════════════════════════════════
// Formal GST Tax Invoice data
// ═══════════════════════════════════════
// Item-level data for a legally-formatted tax invoice. This is a DIFFERENT
// document from the retail customer receipt and is gated behind an explicit
// permission — a cashier cannot pull it.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok, fail } from '@/lib/auth/guard';
import { STORE_CONFIG } from '@/lib/config/store';
import { logActivity } from '@/lib/database/activity';

export const GET = withPermission(
  'sale.invoice.formal',
  async (_request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const supabase = createServiceRoleClient();

    const { data: sale, error } = await supabase
      .from('sales')
      .select(
        '*, sale_items(*), profiles!sales_cashier_id_fkey(name), customers(name, phone)'
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!sale) return fail('Sale not found', 404, 'SALE_NOT_FOUND');

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'INVOICE_GENERATED',
      entityType: 'sale',
      entityId: id,
      details: `Formal GST invoice generated for ${sale.invoice_number}`,
    });

    const customer = (sale as { customers?: { name?: string; phone?: string } | null }).customers;

    return ok({
      invoiceNumber: sale.invoice_number,
      date: new Date(sale.created_at).toLocaleDateString('en-IN'),
      storeName: STORE_CONFIG.name,
      storeAddress: `${STORE_CONFIG.address}, ${STORE_CONFIG.city}`,
      storeGSTIN: STORE_CONFIG.gstin,
      storePhone: STORE_CONFIG.phone,
      cashierName:
        (sale as { profiles?: { name?: string } | null }).profiles?.name ?? 'Cashier',
      items: sale.sale_items ?? [],
      subtotal: Number(sale.subtotal),
      totalCGST: Number(sale.total_cgst),
      totalSGST: Number(sale.total_sgst),
      totalTax: Number(sale.total_tax),
      discount: Number(sale.discount ?? 0),
      grandTotal: Number(sale.grand_total),
      paymentMethod: sale.payment_method,
      customerName: customer?.name ?? undefined,
      customerPhone: customer?.phone ?? undefined,
    });
  },
  'sales/invoice'
);
