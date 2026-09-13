// ═══════════════════════════════════════
// Stock never blocks the ₹99 counter item
// ═══════════════════════════════════════
// Business rule: the quick-add product counts stock down with every sale but
// must NEVER stop a bill — not at zero, not below it. It is flagged
// allow_negative_stock, and the cart must honour that flag everywhere the
// server does (create_sale already skips its stock check for it).
//
// Products WITHOUT the flag keep the normal guard, so nothing else loosens.

import { describe, it, expect, beforeEach } from 'vitest';
import { usePOSStore } from '@/store/pos.store';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import type { Product } from '@/types';

function product(overrides: Partial<Product>): Product {
  return {
    id: '00b54f3f-fbd9-460a-88a6-e9808ac882ae',
    name: 'MaxxCity Product 99rs',
    barcode: 'MAXXCITY-99',
    category: 'Others',
    hsn_code: '6211',
    gst_rate: 5,
    price: DEFAULT_PRODUCT_PRICE,
    stock_qty: 0,
    low_stock_threshold: 20,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const counterItem = product({ stock_qty: 0, allow_negative_stock: true });
const normalItem = product({
  id: '243aa974-6822-4bc6-9808-d88f4e1a079b',
  name: 'Regression Test Item',
  barcode: 'REGTEST-001',
  stock_qty: 0,
  allow_negative_stock: false,
});

beforeEach(() => usePOSStore.getState().clearCart());

describe('a product allowed to sell past zero', () => {
  it('can be added at zero stock, again and again', () => {
    for (let i = 0; i < 5; i++) {
      expect(usePOSStore.getState().addToCart(counterItem).ok).toBe(true);
    }
    expect(usePOSStore.getState().cart[0].qty).toBe(5);
  });

  it('can be set to any quantity', () => {
    const store = usePOSStore.getState();
    store.addToCart(counterItem);
    const line = usePOSStore.getState().cart[0];
    expect(usePOSStore.getState().setQty(line.id, 250).ok).toBe(true);
    expect(usePOSStore.getState().cart[0].qty).toBe(250);
  });

  it('is never reported as a stock issue, so checkout is never blocked', () => {
    const store = usePOSStore.getState();
    store.addToCart(counterItem);
    store.addToCart(counterItem);
    expect(usePOSStore.getState().getStockIssues()).toEqual([]);
  });

  it('still bills at the flat price', () => {
    usePOSStore.getState().addToCart(counterItem);
    usePOSStore.getState().addToCart(counterItem);
    expect(usePOSStore.getState().getCartTotals().grandTotal).toBe(DEFAULT_PRODUCT_PRICE * 2);
  });
});

describe('an ordinary product keeps the stock guard', () => {
  it('cannot be added at zero stock', () => {
    const result = usePOSStore.getState().addToCart(normalItem);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_STOCK');
  });

  it('cannot be raised past the stock it has', () => {
    const limited = { ...normalItem, stock_qty: 2 };
    usePOSStore.getState().addToCart(limited);
    const line = usePOSStore.getState().cart[0];
    expect(usePOSStore.getState().setQty(line.id, 3).ok).toBe(false);
    expect(usePOSStore.getState().setQty(line.id, 2).ok).toBe(true);
  });
});
