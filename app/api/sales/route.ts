// ═══════════════════════════════════════
// Sales API
// ═══════════════════════════════════════
// GET  — paginated sales history (internal view, full product detail)
// POST — create a sale. Server-authoritative, idempotent, atomic.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/database/supabase-server';
import {
  requireAuth,
  requirePermission,
  ok,
  handleApiError,
} from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { createSaleSchema, reportQuerySchema, parseOrThrow } from '@/lib/validation/schemas';
import { createSale } from '@/lib/sales/service';
import { resolvePeriod } from '@/lib/reports/period';
import { rows } from '@/lib/database/rows';

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const url = new URL(request.url);
    const query = parseOrThrow(
      reportQuerySchema,
      Object.fromEntries(url.searchParams.entries())
    );

    const supabase = createServiceRoleClient();
    const { from, to } = resolvePeriod(query.period, query.from, query.to);

    let builder = supabase
      .from('sales')
      .select(
        'id, invoice_number, created_at, cashier_id, shift_id, total_items, subtotal, ' +
          'total_cgst, total_sgst, total_tax, discount, grand_total, payment_method, ' +
          'payment_status, status, terminal_id, is_offline_origin, ' +
          'profiles!sales_cashier_id_fkey(name)',
        { count: 'exact' }
      )
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false });

    // A cashier only ever sees their own transactions.
    if (!hasPermission(session.role, 'sale.read.all')) {
      builder = builder.eq('cashier_id', session.sub);
    } else if (query.cashier_id) {
      builder = builder.eq('cashier_id', query.cashier_id);
    }

    if (query.payment_method) builder = builder.eq('payment_method', query.payment_method);
    if (query.status) builder = builder.eq('status', query.status);
    if (query.invoice) builder = builder.ilike('invoice_number', `%${query.invoice}%`);

    const offset = (query.page - 1) * query.page_size;
    const { data, error, count } = await builder.range(offset, offset + query.page_size - 1);

    if (error) throw error;

    return ok({
      sales: rows<{ profiles: { name?: string } | null }>(data).map((s) => ({
        ...s,
        cashier_name: s.profiles?.name ?? 'Unknown',
      })),
      pagination: {
        page: query.page,
        pageSize: query.page_size,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / query.page_size)),
      },
      range: { from: from.toISOString(), to: to.toISOString() },
    });
  } catch (error) {
    return handleApiError(error, 'sales/GET');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await requirePermission('pos.sell');
    const body = parseOrThrow(createSaleSchema, await request.json());

    const result = await createSale({
      clientSaleId: body.client_sale_id,
      cashierId: session.sub,
      cashierRole: session.role,
      shiftId: body.shift_id,
      items: body.items,
      paymentMethod: body.payment_method,
      amountTendered: body.amount_tendered ?? null,
      discount: body.discount,
      discountReason: body.discount_reason ?? null,
      customerPhone: body.customer_phone ?? null,
      customerName: body.customer_name ?? null,
      terminalId: body.terminal_id ?? null,
    });

    // 200 (not 201) on a replayed idempotency key so the client can tell the
    // difference between "created" and "already existed".
    return ok(result, result.duplicate ? 200 : 201);
  } catch (error) {
    return handleApiError(error, 'sales/POST');
  }
}
