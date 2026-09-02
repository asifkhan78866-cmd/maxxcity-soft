// ═══════════════════════════════════════
// EMI / Finance Cases
// ═══════════════════════════════════════
// The finance booking fee is an INDEPENDENT business value (EMI_BOOKING_FEE).
// It is deliberately not derived from the product selling price — the two
// changed together in the old code, which is exactly the coupling that made a
// pricing change silently alter an unrelated financial figure.

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { withPermission, ok } from '@/lib/auth/guard';
import { EMI_BOOKING_FEE } from '@/lib/config/pricing';
import { parseOrThrow, phoneSchema, moneySchema } from '@/lib/validation/schemas';
import { logActivity } from '@/lib/database/activity';
import { z } from 'zod';

const createCaseSchema = z.object({
  customer_name: z.string().trim().min(2).max(120),
  customer_phone: phoneSchema,
  product_category: z.string().trim().min(2).max(60),
  loan_amount: moneySchema.positive('Loan amount must be greater than zero'),
  finance_partner: z.enum(['Bajaj', 'Snapmint', 'HomeCredit', 'Other']),
  booking_fee: moneySchema.optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

const updateCaseSchema = z.object({
  id: z.string().uuid(),
  status: z
    .enum(['BOOKED', 'SUBMITTED', 'APPROVED', 'DISBURSED', 'COMMISSION_RECEIVED'])
    .optional(),
  commission_earned: moneySchema.optional(),
  commission_received: z.boolean().optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const GET = withPermission(
  'reports.read',
  async () => {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('emi_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) throw error;

    return ok({ cases: data ?? [], bookingFee: EMI_BOOKING_FEE });
  },
  'emi/GET'
);

export const POST = withPermission(
  'reports.read',
  async (request, session) => {
    const body = parseOrThrow(createCaseSchema, await request.json());
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('emi_cases')
      .insert({
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        product_category: body.product_category,
        loan_amount: body.loan_amount,
        finance_partner: body.finance_partner,
        // Defaults to the configured fee; an explicit override is allowed
        // because partners occasionally set a different fee per scheme.
        booking_fee: body.booking_fee ?? EMI_BOOKING_FEE,
        status: 'BOOKED',
        notes: body.notes ?? null,
      })
      .select('*')
      .single();

    if (error) throw error;

    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'SETTINGS_UPDATED',
      entityType: 'emi_case',
      entityId: data.id,
      details: `EMI case booked for ${body.customer_name} (${body.finance_partner}, ₹${body.loan_amount})`,
    });

    return ok(data, 201);
  },
  'emi/POST'
);

export const PATCH = withPermission(
  'reports.read',
  async (request) => {
    const body = parseOrThrow(updateCaseSchema, await request.json());
    const { id, ...updates } = body;
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('emi_cases')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) throw error;
    return ok(data);
  },
  'emi/PATCH'
);
