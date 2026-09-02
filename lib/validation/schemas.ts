// ═══════════════════════════════════════
// Validation Schemas (Zod)
// ═══════════════════════════════════════
// Shared by react-hook-form on the client AND by the API routes on the server.
// Client-side validation is a UX affordance; the server-side parse is the
// control — every route parses its body through these schemas before use.

import { z } from 'zod';
import { VALID_GST_RATES } from '@/lib/config/pricing';

// ─── Primitives ───

export const uuidSchema = z.string().uuid('Must be a valid id');

export const barcodeSchema = z
  .string()
  .trim()
  .min(4, 'Barcode is too short')
  .max(48, 'Barcode is too long')
  .regex(/^[A-Za-z0-9._-]+$/, 'Barcode may only contain letters, digits, dot, dash and underscore');

export const hsnSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'HSN must be 4–8 digits')
  .or(z.literal(''));

export const gstRateSchema = z
  .number()
  .int()
  .refine((v) => (VALID_GST_RATES as readonly number[]).includes(v), {
    message: `GST rate must be one of ${VALID_GST_RATES.join(', ')}%`,
  });

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number');

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, 'PIN must be 4–6 digits');

export const moneySchema = z
  .number()
  .finite()
  .nonnegative('Amount cannot be negative')
  .max(10_000_000, 'Amount is unrealistically large');

export const quantitySchema = z
  .number()
  .int('Quantity must be a whole number')
  .positive('Quantity must be at least 1')
  .max(9999, 'Quantity is unrealistically large');

export const productCategorySchema = z.enum([
  'Electronics',
  'Home & Kitchen',
  'Kitchen',
  'Clothing',
  'Fashion',
  'Accessories',
  'Toys',
  'Stationery',
  'Personal Care',
  'Care',
  'Seasonal',
  'Others',
]);

export const paymentMethodSchema = z.enum(['CASH', 'UPI', 'CARD']);
export const refundMethodSchema = z.enum(['CASH', 'UPI', 'CARD', 'STORE_CREDIT']);
export const userRoleSchema = z.enum(['CASHIER', 'MANAGER', 'ADMIN']);

// ─── Auth ───

export const pinLoginSchema = z.object({
  staffCode: z.string().trim().min(1, 'Staff code is required').max(16),
  pin: pinSchema,
});

export const emailLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

// ─── Products ───

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Product name is required').max(120),
  barcode: barcodeSchema,
  category: productCategorySchema,
  hsn_code: hsnSchema.default(''),
  gst_rate: gstRateSchema,
  // The selling price is NOT accepted from the client — the server applies the
  // centralised flat price. Cost price is the supplier cost and is separate.
  cost_price: moneySchema.optional().nullable(),
  stock_qty: z.number().int().min(0).max(1_000_000).default(0),
  low_stock_threshold: z.number().int().min(0).max(100_000).default(20),
  supplier_id: uuidSchema.optional().nullable(),
  is_active: z.boolean().default(true),
});

export const updateProductSchema = createProductSchema.partial().extend({
  id: uuidSchema,
});

export const stockAdjustmentSchema = z.object({
  product_id: uuidSchema,
  delta: z
    .number()
    .int('Adjustment must be a whole number')
    .refine((v) => v !== 0, 'Adjustment cannot be zero')
    .refine((v) => Math.abs(v) <= 1_000_000, 'Adjustment is unrealistically large'),
  movement_type: z.enum([
    'OPENING_STOCK',
    'PURCHASE',
    'MANUAL_ADJUSTMENT',
    'DAMAGE',
    'LOSS',
    'TRANSFER',
  ]),
  reason: z.string().trim().min(3, 'Give a reason for the adjustment').max(300),
});

// ─── Sales ───

/**
 * A sale line as submitted by the POS.
 *
 * Deliberately carries ONLY product_id and qty. Price, GST, taxable value and
 * totals are all derived server-side, so a tampered client payload cannot
 * change what is charged or recorded.
 */
export const saleLineSchema = z.object({
  product_id: uuidSchema,
  qty: quantitySchema,
});

export const createSaleSchema = z.object({
  /** Idempotency key — the same key never creates a second sale. */
  client_sale_id: z.string().trim().min(8).max(64),
  shift_id: uuidSchema,
  items: z.array(saleLineSchema).min(1, 'Add at least one item').max(500),
  payment_method: paymentMethodSchema,
  amount_tendered: moneySchema.optional().nullable(),
  discount: moneySchema.default(0),
  discount_reason: z.string().trim().max(300).optional().nullable(),
  customer_phone: phoneSchema.optional().nullable(),
  customer_name: z.string().trim().max(120).optional().nullable(),
  terminal_id: z.string().trim().max(32).optional().nullable(),
});

/** An offline sale being replayed to the server after reconnection. */
export const syncSaleSchema = createSaleSchema.extend({
  invoice_number: z.string().trim().min(3).max(64),
  created_at: z.string().datetime({ offset: true }),
  cashier_id: uuidSchema,
});

export const voidSaleSchema = z.object({
  reason: z.string().trim().min(3, 'A void must record a reason').max(300),
  restock: z.boolean().default(true),
});

export const returnLineSchema = z.object({
  sale_item_id: uuidSchema,
  qty: quantitySchema,
});

export const createReturnSchema = z.object({
  sale_id: uuidSchema,
  items: z.array(returnLineSchema).min(1, 'Select at least one item to return'),
  reason: z.string().trim().min(3, 'A return must record a reason').max(300),
  refund_method: refundMethodSchema,
  shift_id: uuidSchema.optional().nullable(),
  restock: z.boolean().default(true),
});

// ─── Shifts ───

export const openShiftSchema = z.object({
  opening_cash: moneySchema.max(1_000_000),
  terminal_id: z.string().trim().max(32).optional().nullable(),
});

export const closeShiftSchema = z.object({
  shift_id: uuidSchema,
  closing_cash: moneySchema.max(10_000_000),
  reason: z.string().trim().max(300).optional().nullable(),
});

// ─── Staff ───

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email().optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  role: userRoleSchema,
  staff_code: z
    .string()
    .trim()
    .min(2, 'Staff code is required')
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/, 'Staff code may only contain letters, digits, dash and underscore'),
  pin: pinSchema.optional().nullable(),
  password: z.string().min(8).max(200).optional().nullable(),
  is_active: z.boolean().default(true),
});

export const updateStaffSchema = createStaffSchema.partial().extend({ id: uuidSchema });

// ─── Customers ───

export const upsertCustomerSchema = z.object({
  phone: phoneSchema,
  name: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

// ─── Suppliers & purchase orders ───

export const createSupplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  contact_person: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().toLowerCase().email().optional().nullable(),
  address: z.string().trim().max(400).optional().nullable(),
  gstin: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const purchaseOrderItemSchema = z.object({
  product_id: uuidSchema,
  qty_ordered: quantitySchema,
  /** Supplier cost — NOT the ₹99 customer selling price. */
  unit_cost: moneySchema,
});

export const createPurchaseOrderSchema = z.object({
  supplier_id: uuidSchema,
  items: z.array(purchaseOrderItemSchema).min(1, 'Add at least one line'),
  notes: z.string().trim().max(500).optional().nullable(),
  expected_at: z.string().datetime({ offset: true }).optional().nullable(),
});

export const receivePurchaseOrderSchema = z.object({
  items: z
    .array(z.object({ po_item_id: uuidSchema, qty_received: z.number().int().min(0).max(1_000_000) }))
    .min(1),
});

// ─── Reports ───

export const reportQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  period: z.enum(['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'custom']).default('today'),
  cashier_id: uuidSchema.optional(),
  payment_method: paymentMethodSchema.optional(),
  status: z.enum(['COMPLETED', 'VOID', 'RETURNED', 'PARTIALLY_RETURNED']).optional(),
  invoice: z.string().trim().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Settings ───

export const updateSettingsSchema = z.object({
  store_name: z.string().trim().min(2).max(120).optional(),
  store_address: z.string().trim().max(200).optional(),
  store_city: z.string().trim().max(120).optional(),
  store_gstin: z
    .string()
    .trim()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
    .or(z.literal(''))
    .optional(),
  store_phone: z.string().trim().max(20).optional(),
  low_stock_default: z.number().int().min(0).max(100_000).optional(),
  allow_negative_stock: z.boolean().optional(),
  emi_booking_fee: moneySchema.optional(),
});

/**
 * Parse a request body, converting a Zod failure into a flat field→message map
 * the UI can render next to the offending input.
 */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  data: unknown
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    const error = new Error(
      result.error.issues[0]?.message ?? 'The submitted data is not valid'
    ) as Error & { fieldErrors: Record<string, string>; isValidationError: true };
    error.fieldErrors = fieldErrors;
    error.isValidationError = true;
    throw error;
  }
  return result.data;
}
