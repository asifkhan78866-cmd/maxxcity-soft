// ═══════════════════════════════════════
// Activity / Audit Log
// ═══════════════════════════════════════
// Admin-only view of who did what, when, to which entity.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';

export const GET = withPermission(
  'audit.read',
  async (request) => {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    const userId = url.searchParams.get('user_id');
    const entityType = url.searchParams.get('entity_type');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));

    const supabase = createServiceRoleClient();
    let builder = supabase
      .from('activity_log')
      .select('*, profiles(name, role)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (action) builder = builder.eq('action', action);
    if (userId) builder = builder.eq('user_id', userId);
    if (entityType) builder = builder.eq('entity_type', entityType);

    const offset = (page - 1) * limit;
    const { data, error, count } = await builder.range(offset, offset + limit - 1);
    if (error) throw error;

    return ok({
      entries: data ?? [],
      pagination: { page, pageSize: limit, total: count ?? 0 },
    });
  },
  'activity'
);
