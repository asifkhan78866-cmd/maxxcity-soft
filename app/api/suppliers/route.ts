// ═══════════════════════════════════════
// Suppliers API
// ═══════════════════════════════════════

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { createSupplierSchema, parseOrThrow } from '@/lib/validation/schemas';

export const GET = withPermission(
  'purchase.read',
  async () => {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return ok(data ?? []);
  },
  'suppliers/GET'
);

export const POST = withPermission(
  'purchase.manage',
  async (request) => {
    const body = parseOrThrow(createSupplierSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.from('suppliers').insert(body).select('*').single();
    if (error) throw error;

    return ok(data, 201);
  },
  'suppliers/POST'
);
