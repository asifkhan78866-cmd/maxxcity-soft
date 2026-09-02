// ═══════════════════════════════════════
// Customers API
// ═══════════════════════════════════════
// Lightweight CRM. Customer capture is OPTIONAL — checkout never depends on
// it, and a lookup miss is a normal, non-error outcome.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { upsertCustomerSchema, parseOrThrow } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';

export const GET = withPermission(
  'customer.read',
  async (request) => {
    const url = new URL(request.url);
    const phone = url.searchParams.get('phone')?.trim();
    const search = url.searchParams.get('search')?.trim();
    const supabase = createServiceRoleClient();

    if (phone) {
      const { data, error } = await supabase
        .from('customers')
        .select('id, phone, name, total_visits, total_spend, last_purchase_at')
        .eq('phone', phone)
        .maybeSingle();

      if (error) throw error;
      // A miss is expected for a first-time customer — 200 with null, not 404.
      return ok({ customer: data ?? null });
    }

    let builder = supabase
      .from('customers')
      .select('id, phone, name, total_visits, total_spend, last_purchase_at, created_at')
      .order('last_purchase_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (search) {
      const safe = search.replace(/[,()]/g, ' ');
      builder = builder.or(`phone.ilike.%${safe}%,name.ilike.%${safe}%`);
    }

    const { data, error } = await builder;
    if (error) throw error;
    return ok({ customers: data ?? [] });
  },
  'customers/GET'
);

export const POST = withPermission(
  'customer.manage',
  async (request, session) => {
    const body = parseOrThrow(upsertCustomerSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('customers')
      .upsert(
        { phone: body.phone, name: body.name ?? null, notes: body.notes ?? null },
        { onConflict: 'phone' }
      )
      .select('id, phone, name, total_visits, total_spend, last_purchase_at')
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'CUSTOMER_CREATED',
      entityType: 'customer',
      entityId: data.id,
      details: `Customer ${body.phone} saved`,
    });

    return ok(data, 201);
  },
  'customers/POST'
);
