// ═══════════════════════════════════════
// Returns / Refunds
// ═══════════════════════════════════════
// GET  — recent returns
// POST — process a return against an original invoice
//
// The RPC validates that each line belongs to the original sale, that the
// quantity does not exceed what remains returnable, restores stock through
// the ledger, refunds the amount actually collected (net of any discount)
// and writes the audit trail — all atomically.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { createReturnSchema, reportQuerySchema, parseOrThrow } from '@/lib/validation/schemas';
import { resolvePeriod } from '@/lib/reports/period';

export const GET = withPermission(
  'sale.return',
  async (request) => {
    const url = new URL(request.url);
    const query = parseOrThrow(
      reportQuerySchema,
      Object.fromEntries(url.searchParams.entries())
    );
    const { from, to } = resolvePeriod(query.period, query.from, query.to);

    const supabase = createServiceRoleClient();
    const offset = (query.page - 1) * query.page_size;

    const { data, error, count } = await supabase
      .from('returns')
      .select(
        '*, return_items(*), sales!returns_original_sale_id_fkey(invoice_number), ' +
          'profiles!returns_processed_by_fkey(name)',
        { count: 'exact' }
      )
      .gte('created_at', from.toISOString())
      .lte('created_at', to.toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + query.page_size - 1);

    if (error) throw error;

    return ok({
      returns: data ?? [],
      pagination: {
        page: query.page,
        pageSize: query.page_size,
        total: count ?? 0,
        totalPages: Math.max(1, Math.ceil((count ?? 0) / query.page_size)),
      },
    });
  },
  'returns/GET'
);

export const POST = withPermission(
  'sale.return',
  async (request, session) => {
    const body = parseOrThrow(createReturnSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('process_return', {
      p_sale_id: body.sale_id,
      p_user_id: session.sub,
      p_items: body.items,
      p_reason: body.reason,
      p_refund_method: body.refund_method,
      p_shift_id: body.shift_id ?? null,
      p_restock: body.restock,
    });

    if (error) throw new Error(error.message);
    return ok(data, 201);
  },
  'returns/POST'
);
