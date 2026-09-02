// ═══════════════════════════════════════
// Single Sale — internal/admin detail
// ═══════════════════════════════════════
// Returns full product-level information. This is the ADMIN view; it is not
// what a customer sees. Customer receipts come from /api/sales/[id]/receipt.

import { requireAuth, ok, fail, handleApiError } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { getSaleWithItems } from '@/lib/sales/service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;

    const sale = await getSaleWithItems(id);
    if (!sale) return fail('Sale not found', 404, 'SALE_NOT_FOUND');

    // A cashier may only open their own transactions.
    if (
      !hasPermission(session.role, 'sale.read.all') &&
      (sale as { cashier_id: string }).cashier_id !== session.sub
    ) {
      return fail('You are not permitted to view this sale', 403, 'FORBIDDEN');
    }

    return ok(sale);
  } catch (error) {
    return handleApiError(error, 'sales/[id]/GET');
  }
}
