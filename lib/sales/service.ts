// ═══════════════════════════════════════
// Sale Service — server-authoritative
// ═══════════════════════════════════════
// Shared by the online POS route and the offline sync route so both go
// through exactly the same validation and the same atomic RPC.
//
// The client submits only `{ product_id, qty }` per line. Price, GST, taxable
// value, tax split and the grand total are all derived here and inside
// create_sale(). A tampered payload cannot change what is charged.

import 'server-only';

import { createServiceRoleClient } from '@/lib/database/supabase-server';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import { maxDiscountFor } from '@/lib/auth/rbac';
import { ApiError } from '@/lib/auth/guard';
import { roundMoney } from '@/lib/money';
import type { UserRole, PaymentMethod } from '@/types';

export interface SaleLineInput {
  product_id: string;
  qty: number;
}

export interface CreateSaleInput {
  clientSaleId: string;
  cashierId: string;
  cashierRole: UserRole;
  shiftId: string;
  items: SaleLineInput[];
  paymentMethod: PaymentMethod;
  amountTendered?: number | null;
  discount?: number;
  discountReason?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  terminalId?: string | null;
  /** Offline replay only. */
  invoiceNumber?: string | null;
  createdAt?: string | null;
  isOffline?: boolean;
}

export interface CreateSaleResult {
  sale_id: string;
  invoice_number: string;
  subtotal: number;
  total_cgst: number;
  total_sgst: number;
  total_tax: number;
  discount: number;
  grand_total: number;
  total_items: number;
  change_due: number | null;
  created_at: string;
  duplicate: boolean;
}

/**
 * Merge duplicate product lines.
 *
 * A cart can legitimately contain the same product twice (scanned, then
 * scanned again). Collapsing them here means the stock check sees the true
 * combined quantity and the sale gets one line per product.
 */
export function mergeLines(items: SaleLineInput[]): SaleLineInput[] {
  const merged = new Map<string, number>();
  for (const item of items) {
    merged.set(item.product_id, (merged.get(item.product_id) ?? 0) + item.qty);
  }
  return Array.from(merged, ([product_id, qty]) => ({ product_id, qty }));
}

/** Look up (or create) a customer by phone. Never blocks the sale. */
async function resolveCustomerId(
  phone: string | null | undefined,
  name: string | null | undefined
): Promise<string | null> {
  if (!phone) return null;

  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase
    .from('customers')
    .select('id, name')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) {
    // Fill in a name we did not have before, but never overwrite one.
    if (name && !existing.name) {
      await supabase.from('customers').update({ name }).eq('id', existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await supabase
    .from('customers')
    .insert({ phone, name: name ?? null })
    .select('id')
    .single();

  if (error) {
    // A concurrent insert may have won the race — re-read rather than failing
    // a checkout over an optional field.
    const { data: raced } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();
    return raced?.id ?? null;
  }

  return created.id;
}

/**
 * Validate a requested discount against the operator's role.
 * Returns the approved discount in rupees, or throws.
 */
export function authorizeDiscount(
  role: UserRole,
  requested: number,
  billTotal: number,
  reason: string | null | undefined
): number {
  const discount = roundMoney(Math.max(0, requested));
  if (discount === 0) return 0;

  const cap = maxDiscountFor(role, billTotal);
  if (cap <= 0) {
    throw new ApiError(
      403,
      'Your role is not permitted to apply a discount. Ask a manager to authorise it.',
      'DISCOUNT_NOT_PERMITTED'
    );
  }
  if (discount > cap) {
    throw new ApiError(
      403,
      `A ${role.toLowerCase()} may discount at most ₹${cap.toFixed(2)} on this bill.`,
      'DISCOUNT_LIMIT_EXCEEDED'
    );
  }
  if (!reason || reason.trim().length < 3) {
    throw new ApiError(
      422,
      'A discount must record a reason.',
      'DISCOUNT_REASON_REQUIRED'
    );
  }
  return discount;
}

/**
 * Create a sale.
 *
 * All the real work — stock validation, atomic decrement, ledger entries,
 * invoice numbering, shift roll-up and the audit row — happens inside the
 * create_sale() Postgres function in a single transaction.
 */
export async function createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
  const supabase = createServiceRoleClient();
  const items = mergeLines(input.items);

  // Pre-compute the gross so the discount cap can be checked before we take
  // any locks. create_sale() re-derives every figure regardless.
  const grossTotal = roundMoney(
    items.reduce((sum, i) => sum + DEFAULT_PRODUCT_PRICE * i.qty, 0)
  );

  const discount = authorizeDiscount(
    input.cashierRole,
    input.discount ?? 0,
    grossTotal,
    input.discountReason
  );

  const customerId = await resolveCustomerId(input.customerPhone, input.customerName);

  const { data, error } = await supabase.rpc('create_sale', {
    p_client_sale_id: input.clientSaleId,
    p_cashier_id: input.cashierId,
    p_shift_id: input.shiftId,
    p_payment_method: input.paymentMethod,
    p_items: items,
    p_default_price: DEFAULT_PRODUCT_PRICE,
    p_discount: discount,
    p_customer_id: customerId,
    p_terminal_id: input.terminalId ?? null,
    p_amount_tendered: input.amountTendered ?? null,
    p_invoice_number: input.invoiceNumber ?? null,
    p_created_at: input.createdAt ?? null,
    p_is_offline: input.isOffline ?? false,
    p_discount_reason: input.discountReason ?? null,
    p_payment_status: 'COMPLETED',
  });

  if (error) {
    // Surface the RPC's `CODE: message` contract; handleApiError maps it to a
    // 409 with the code intact so the POS can react (e.g. re-check stock).
    throw new Error(error.message);
  }

  return data as CreateSaleResult;
}

/**
 * Load a sale with its items — INTERNAL/ADMIN view.
 * Customer-facing output must be built from lib/backend/receipt.ts instead.
 */
export async function getSaleWithItems(saleId: string) {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from('sales')
    .select('*, sale_items(*), profiles!sales_cashier_id_fkey(name), customers(phone, name)')
    .eq('id', saleId)
    .maybeSingle();

  if (error) throw error;
  return data;
}
