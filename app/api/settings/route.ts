// ═══════════════════════════════════════
// Store Settings
// ═══════════════════════════════════════
// The selling price is deliberately NOT editable here: it is a code-level
// business rule (lib/config/pricing.ts) and changing it must be a reviewed
// deploy, not a field in a form. The row exposes it read-only so an admin can
// confirm the database and the application agree.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, withAuth, ok } from '@/lib/auth/guard';
import { updateSettingsSchema, parseOrThrow } from '@/lib/validation/schemas';
import { DEFAULT_PRODUCT_PRICE, EMI_BOOKING_FEE } from '@/lib/config/pricing';
import { logActivity } from '@/lib/database/activity';

export const GET = withAuth(async () => {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('store_settings')
    .select('*')
    .eq('id', 'main')
    .maybeSingle();

  if (error) throw error;

  return ok({
    ...(data ?? {}),
    // Authoritative values, surfaced so a mismatch is visible rather than silent.
    default_product_price: DEFAULT_PRODUCT_PRICE,
    emi_booking_fee: data?.emi_booking_fee ?? EMI_BOOKING_FEE,
    priceIsReadOnly: true,
    dbPriceMatchesApp:
      data == null || Number(data.default_product_price) === DEFAULT_PRODUCT_PRICE,
  });
}, 'settings/GET');

export const PATCH = withPermission(
  'settings.write',
  async (request, session) => {
    const body = parseOrThrow(updateSettingsSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('store_settings')
      .update({ ...body, updated_by: session.sub, updated_at: new Date().toISOString() })
      .eq('id', 'main')
      .select('*')
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'SETTINGS_UPDATED',
      entityType: 'store_settings',
      entityId: 'main',
      details: `Updated: ${Object.keys(body).join(', ')}`,
      metadata: { changes: body },
    });

    return ok(data);
  },
  'settings/PATCH'
);
