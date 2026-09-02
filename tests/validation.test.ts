// ═══════════════════════════════════════
// Server-Side Input Validation
// ═══════════════════════════════════════
// The client is never trusted. These tests assert the specific attacks the
// schemas are there to stop — chiefly a client trying to dictate the price or
// the totals of a sale.

import { describe, it, expect } from 'vitest';
import {
  createSaleSchema,
  createProductSchema,
  stockAdjustmentSchema,
  voidSaleSchema,
  createReturnSchema,
  closeShiftSchema,
  createStaffSchema,
  pinLoginSchema,
  upsertCustomerSchema,
  parseOrThrow,
} from '@/lib/validation/schemas';

const validSale = {
  client_sale_id: 'b3f1a2c4-d5e6-47a8-9b0c-1d2e3f4a5b6c',
  shift_id: '11111111-1111-4111-8111-111111111111',
  items: [{ product_id: '22222222-2222-4222-8222-222222222222', qty: 2 }],
  payment_method: 'CASH' as const,
};

describe('sale submission cannot carry pricing', () => {
  it('accepts a well-formed sale', () => {
    const parsed = parseOrThrow(createSaleSchema, validSale);
    expect(parsed.items[0].qty).toBe(2);
    expect(parsed.discount).toBe(0);
  });

  it('strips a client-supplied unit price and grand total', () => {
    const tampered = {
      ...validSale,
      items: [
        {
          product_id: '22222222-2222-4222-8222-222222222222',
          qty: 1,
          unit_price: 1,
          line_total: 1,
        },
      ],
      grand_total: 1,
      subtotal: 1,
      total_cgst: 0,
      total_sgst: 0,
    };

    const parsed = parseOrThrow(createSaleSchema, tampered) as Record<string, unknown>;

    // None of the money fields survive parsing — the server computes them all.
    expect(parsed.grand_total).toBeUndefined();
    expect(parsed.subtotal).toBeUndefined();
    expect(parsed.total_cgst).toBeUndefined();
    expect((parsed.items as Array<Record<string, unknown>>)[0].unit_price).toBeUndefined();
    expect((parsed.items as Array<Record<string, unknown>>)[0].line_total).toBeUndefined();
  });

  it('rejects an empty cart', () => {
    expect(() => parseOrThrow(createSaleSchema, { ...validSale, items: [] })).toThrow();
  });

  it('rejects zero, negative and fractional quantities', () => {
    for (const qty of [0, -1, 1.5]) {
      expect(() =>
        parseOrThrow(createSaleSchema, {
          ...validSale,
          items: [{ product_id: '22222222-2222-4222-8222-222222222222', qty }],
        })
      ).toThrow();
    }
  });

  it('rejects an unknown payment method', () => {
    expect(() =>
      parseOrThrow(createSaleSchema, { ...validSale, payment_method: 'CRYPTO' })
    ).toThrow();
  });

  it('rejects a negative discount', () => {
    expect(() => parseOrThrow(createSaleSchema, { ...validSale, discount: -100 })).toThrow();
  });

  it('rejects a missing or too-short idempotency key', () => {
    expect(() => parseOrThrow(createSaleSchema, { ...validSale, client_sale_id: 'x' })).toThrow();
    const { client_sale_id, ...withoutKey } = validSale;
    void client_sale_id;
    expect(() => parseOrThrow(createSaleSchema, withoutKey)).toThrow();
  });

  it('rejects a malformed customer phone but allows none at all', () => {
    expect(() =>
      parseOrThrow(createSaleSchema, { ...validSale, customer_phone: '12345' })
    ).toThrow();
    expect(() =>
      parseOrThrow(createSaleSchema, { ...validSale, customer_phone: '1234567890' })
    ).toThrow(); // must start 6–9
    expect(parseOrThrow(createSaleSchema, { ...validSale, customer_phone: '9876543210' })
      .customer_phone).toBe('9876543210');
    // Checkout must never depend on a phone number.
    expect(parseOrThrow(createSaleSchema, validSale).customer_phone).toBeUndefined();
  });
});

describe('product creation never accepts a selling price', () => {
  const validProduct = {
    name: 'Test Item',
    barcode: 'ABC-12345',
    category: 'Electronics' as const,
    gst_rate: 18,
  };

  it('accepts a valid product', () => {
    const parsed = parseOrThrow(createProductSchema, validProduct);
    expect(parsed.gst_rate).toBe(18);
    expect(parsed.stock_qty).toBe(0);
  });

  it('drops a client-supplied price', () => {
    const parsed = parseOrThrow(createProductSchema, {
      ...validProduct,
      price: 1,
    }) as Record<string, unknown>;
    expect(parsed.price).toBeUndefined();
  });

  it('keeps cost_price, which is a separate legitimate field', () => {
    const parsed = parseOrThrow(createProductSchema, { ...validProduct, cost_price: 55.5 });
    expect(parsed.cost_price).toBe(55.5);
  });

  it('rejects an unsupported GST rate', () => {
    expect(() => parseOrThrow(createProductSchema, { ...validProduct, gst_rate: 28 })).toThrow();
    expect(() => parseOrThrow(createProductSchema, { ...validProduct, gst_rate: 0 })).toThrow();
  });

  it('rejects a barcode with characters that could break a query filter', () => {
    for (const barcode of ['abc,def', 'abc(def)', 'a b c', '']) {
      expect(() => parseOrThrow(createProductSchema, { ...validProduct, barcode })).toThrow();
    }
  });

  it('rejects a malformed HSN code but allows an empty one', () => {
    expect(() => parseOrThrow(createProductSchema, { ...validProduct, hsn_code: 'abc' })).toThrow();
    expect(() => parseOrThrow(createProductSchema, { ...validProduct, hsn_code: '12' })).toThrow();
    expect(parseOrThrow(createProductSchema, { ...validProduct, hsn_code: '' }).hsn_code).toBe('');
    expect(parseOrThrow(createProductSchema, { ...validProduct, hsn_code: '8518' }).hsn_code).toBe(
      '8518'
    );
  });
});

describe('stock adjustments', () => {
  const base = {
    product_id: '22222222-2222-4222-8222-222222222222',
    delta: 10,
    movement_type: 'MANUAL_ADJUSTMENT' as const,
    reason: 'Recount after audit',
  };

  it('accepts a valid adjustment in both directions', () => {
    expect(parseOrThrow(stockAdjustmentSchema, base).delta).toBe(10);
    expect(parseOrThrow(stockAdjustmentSchema, { ...base, delta: -5 }).delta).toBe(-5);
  });

  it('rejects a zero or fractional adjustment', () => {
    expect(() => parseOrThrow(stockAdjustmentSchema, { ...base, delta: 0 })).toThrow();
    expect(() => parseOrThrow(stockAdjustmentSchema, { ...base, delta: 1.5 })).toThrow();
  });

  it('requires a meaningful reason', () => {
    expect(() => parseOrThrow(stockAdjustmentSchema, { ...base, reason: '' })).toThrow();
    expect(() => parseOrThrow(stockAdjustmentSchema, { ...base, reason: 'x' })).toThrow();
  });

  it('rejects SALE and RETURN, which may only come from the sale flow', () => {
    expect(() =>
      parseOrThrow(stockAdjustmentSchema, { ...base, movement_type: 'SALE' })
    ).toThrow();
    expect(() =>
      parseOrThrow(stockAdjustmentSchema, { ...base, movement_type: 'RETURN' })
    ).toThrow();
  });
});

describe('void and return require a reason', () => {
  it('rejects a void with no reason', () => {
    expect(() => parseOrThrow(voidSaleSchema, {})).toThrow();
    expect(() => parseOrThrow(voidSaleSchema, { reason: 'x' })).toThrow();
    expect(parseOrThrow(voidSaleSchema, { reason: 'Wrong item scanned' }).restock).toBe(true);
  });

  it('rejects a return with no items or no reason', () => {
    const base = {
      sale_id: '11111111-1111-4111-8111-111111111111',
      items: [{ sale_item_id: '22222222-2222-4222-8222-222222222222', qty: 1 }],
      reason: 'Customer changed mind',
      refund_method: 'CASH' as const,
    };
    expect(parseOrThrow(createReturnSchema, base).items).toHaveLength(1);
    expect(() => parseOrThrow(createReturnSchema, { ...base, items: [] })).toThrow();
    expect(() => parseOrThrow(createReturnSchema, { ...base, reason: '' })).toThrow();
    expect(() =>
      parseOrThrow(createReturnSchema, { ...base, refund_method: 'BITCOIN' })
    ).toThrow();
  });
});

describe('shift close', () => {
  it('accepts a valid close', () => {
    const parsed = parseOrThrow(closeShiftSchema, {
      shift_id: '11111111-1111-4111-8111-111111111111',
      closing_cash: 12500.5,
    });
    expect(parsed.closing_cash).toBe(12500.5);
  });

  it('rejects a negative counted amount', () => {
    expect(() =>
      parseOrThrow(closeShiftSchema, {
        shift_id: '11111111-1111-4111-8111-111111111111',
        closing_cash: -1,
      })
    ).toThrow();
  });
});

describe('staff and login input', () => {
  it('requires a 4–6 digit PIN', () => {
    expect(() => parseOrThrow(pinLoginSchema, { staffCode: 'RAVI01', pin: '123' })).toThrow();
    expect(() => parseOrThrow(pinLoginSchema, { staffCode: 'RAVI01', pin: 'abcd' })).toThrow();
    expect(parseOrThrow(pinLoginSchema, { staffCode: 'RAVI01', pin: '1234' }).pin).toBe('1234');
  });

  it('requires a staff code', () => {
    expect(() => parseOrThrow(pinLoginSchema, { staffCode: '', pin: '1234' })).toThrow();
  });

  it('rejects an invalid role', () => {
    expect(() =>
      parseOrThrow(createStaffSchema, {
        name: 'Test',
        role: 'SUPERUSER',
        staff_code: 'TEST01',
      })
    ).toThrow();
  });

  it('rejects a short password', () => {
    expect(() =>
      parseOrThrow(createStaffSchema, {
        name: 'Test',
        role: 'CASHIER',
        staff_code: 'TEST01',
        password: 'short',
      })
    ).toThrow();
  });
});

describe('customer capture', () => {
  it('accepts a valid Indian mobile number', () => {
    expect(parseOrThrow(upsertCustomerSchema, { phone: '9876543210' }).phone).toBe('9876543210');
  });

  it('rejects malformed numbers', () => {
    for (const phone of ['123', '12345678901', '1234567890', 'abcdefghij']) {
      expect(() => parseOrThrow(upsertCustomerSchema, { phone })).toThrow();
    }
  });
});

describe('validation errors are field-addressable', () => {
  it('attaches a field map the UI can render inline', () => {
    try {
      parseOrThrow(createSaleSchema, { ...validSale, payment_method: 'NOPE' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const err = error as Error & {
        isValidationError: boolean;
        fieldErrors: Record<string, string>;
      };
      expect(err.isValidationError).toBe(true);
      expect(err.fieldErrors).toHaveProperty('payment_method');
    }
  });
});
