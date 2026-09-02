// ═══════════════════════════════════════
// POS Store (Zustand)
// ═══════════════════════════════════════
// Cart, shift, held bills and session state for the billing screen.
//
// IMPORTANT: the figures this store computes are the CASHIER'S VIEW. They
// drive what is shown on screen. The authoritative money is always what the
// server returns from create_sale() — the POS displays the server's totals on
// the receipt, never its own.

'use client';

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { CartItem, HeldBill, Shift, PaymentMethod, Product, UserRole } from '@/types';
import { calculateGST, calculateLineGST, calculateCartTotals } from '@/lib/backend/gst';
import { resolveSellingPrice } from '@/lib/config/pricing';
import {
  saveHeldBill as persistHeldBill,
  getHeldBills as loadHeldBills,
  removeHeldBill as deleteHeldBill,
} from '@/lib/database/dexie';

export interface AddToCartResult {
  ok: boolean;
  reason?: 'INSUFFICIENT_STOCK' | 'INACTIVE';
  message?: string;
}

interface POSState {
  // ─ Cart ─
  cart: CartItem[];
  discount: number;
  discountReason: string;

  // ─ Shift ─
  activeShift: Shift | null;

  // ─ Held bills ─
  heldBills: HeldBill[];

  // ─ Session ─
  cashierId: string | null;
  cashierName: string | null;
  cashierRole: UserRole | null;

  // ─ Payment / UI ─
  selectedPayment: PaymentMethod;
  isProcessing: boolean;

  // ─ Cart actions ─
  addToCart: (product: Product) => AddToCartResult;
  setQty: (cartItemId: string, qty: number) => AddToCartResult;
  removeFromCart: (cartItemId: string) => void;
  clearCart: () => void;
  setDiscount: (discount: number, reason?: string) => void;
  /** Refresh cached stock after a catalogue reload so warnings stay accurate. */
  syncStockLevels: (products: Product[]) => void;

  // ─ Shift ─
  setActiveShift: (shift: Shift | null) => void;

  // ─ Held bills ─
  hydrateHeldBills: () => Promise<void>;
  holdBill: (options?: { note?: string; phone?: string }) => Promise<HeldBill | null>;
  recallBill: (billId: string) => Promise<boolean>;
  discardHeldBill: (billId: string) => Promise<void>;

  // ─ Session ─
  setCashier: (id: string, name: string, role: UserRole) => void;
  clearSession: () => void;

  // ─ Payment ─
  setPaymentMethod: (method: PaymentMethod) => void;
  setProcessing: (processing: boolean) => void;

  // ─ Computed ─
  getCartTotals: () => {
    subtotal: number;
    totalCGST: number;
    totalSGST: number;
    totalTax: number;
    discount: number;
    grandTotal: number;
    itemCount: number;
    lineCount: number;
  };
  /** Lines whose quantity now exceeds known stock. */
  getStockIssues: () => Array<{ item: CartItem; available: number }>;
}

/** Total units of one product currently in the cart. */
function qtyInCart(cart: CartItem[], productId: string): number {
  return cart
    .filter((i) => i.product_id === productId)
    .reduce((sum, i) => sum + i.qty, 0);
}

export const usePOSStore = create<POSState>((set, get) => ({
  cart: [],
  discount: 0,
  discountReason: '',
  activeShift: null,
  heldBills: [],
  cashierId: null,
  cashierName: null,
  cashierRole: null,
  selectedPayment: 'CASH',
  isProcessing: false,

  // ─── Cart ───

  addToCart: (product) => {
    if (!product.is_active) {
      return { ok: false, reason: 'INACTIVE', message: `${product.name} is not available for sale` };
    }

    const state = get();
    const alreadyInCart = qtyInCart(state.cart, product.id);

    // Stock is re-validated server-side at checkout; this is the fast local
    // guard that stops the cashier building an unsellable basket.
    if (!product.allow_negative_stock && alreadyInCart + 1 > product.stock_qty) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_STOCK',
        message: `Only ${product.stock_qty} of ${product.name} in stock`,
      };
    }

    // Price always comes from the central pricing rule, never from a UI field.
    const unitPrice = resolveSellingPrice(product.price);
    const existing = state.cart.find((item) => item.product_id === product.id);

    if (existing) {
      const newQty = existing.qty + 1;
      const line = calculateLineGST(unitPrice, product.gst_rate, newQty);
      set({
        cart: state.cart.map((item) =>
          item.id === existing.id
            ? { ...item, qty: newQty, stock_qty: product.stock_qty, ...line }
            : item
        ),
      });
      return { ok: true };
    }

    const gst = calculateGST(unitPrice, product.gst_rate);
    const newItem: CartItem = {
      id: uuidv4(),
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      hsn_code: product.hsn_code,
      category: product.category,
      gst_rate: product.gst_rate,
      qty: 1,
      unit_price: unitPrice,
      base_price: gst.base_price,
      tax_amount: gst.gst_amount,
      cgst: gst.cgst,
      sgst: gst.sgst,
      line_total: unitPrice,
      stock_qty: product.stock_qty,
    };

    set({ cart: [...state.cart, newItem] });
    return { ok: true };
  },

  setQty: (cartItemId, qty) => {
    const state = get();
    const item = state.cart.find((i) => i.id === cartItemId);
    if (!item) return { ok: false };

    if (qty < 1) {
      get().removeFromCart(cartItemId);
      return { ok: true };
    }

    if (qty > item.stock_qty) {
      return {
        ok: false,
        reason: 'INSUFFICIENT_STOCK',
        message: `Only ${item.stock_qty} of ${item.product_name} in stock`,
      };
    }

    const line = calculateLineGST(item.unit_price, item.gst_rate, qty);
    set({
      cart: state.cart.map((i) => (i.id === cartItemId ? { ...i, qty, ...line } : i)),
    });
    return { ok: true };
  },

  removeFromCart: (cartItemId) =>
    set((state) => ({ cart: state.cart.filter((item) => item.id !== cartItemId) })),

  clearCart: () => set({ cart: [], discount: 0, discountReason: '' }),

  setDiscount: (discount, reason = '') =>
    set({ discount: Math.max(0, discount), discountReason: reason }),

  syncStockLevels: (products) => {
    const byId = new Map(products.map((p) => [p.id, p.stock_qty]));
    set((state) => ({
      cart: state.cart.map((item) => ({
        ...item,
        stock_qty: byId.get(item.product_id) ?? item.stock_qty,
      })),
    }));
  },

  // ─── Shift ───

  setActiveShift: (shift) => set({ activeShift: shift }),

  // ─── Held bills ───
  // Held bills live in IndexedDB, so a reload, a crash or a power cut does not
  // lose a customer's basket.

  hydrateHeldBills: async () => {
    try {
      const stored = await loadHeldBills();
      set({
        heldBills: stored.map((b) => ({
          id: b.id,
          label: b.label,
          items: b.items,
          held_at: b.held_at,
          held_by: b.held_by,
          customer_note: b.customer_note ?? undefined,
          customer_phone: b.customer_phone ?? undefined,
        })),
      });
    } catch (error) {
      console.error('Could not load held bills', error);
    }
  },

  holdBill: async (options = {}) => {
    const { cart, heldBills, cashierId } = get();
    if (cart.length === 0) return null;

    const now = new Date();
    // A distinct label per bill so two customers' baskets are never confused
    // at recall time.
    const label =
      options.phone ||
      options.note ||
      `${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · ${cart.reduce((s, i) => s + i.qty, 0)} item(s)`;

    const bill: HeldBill = {
      id: uuidv4(),
      label,
      items: cart.map((item) => ({ ...item })),
      held_at: now.toISOString(),
      held_by: cashierId,
      customer_note: options.note,
      customer_phone: options.phone,
    };

    await persistHeldBill({
      id: bill.id,
      label,
      items: bill.items,
      customer_phone: options.phone ?? null,
      customer_note: options.note ?? null,
      held_by: cashierId,
      held_at: bill.held_at,
    });

    set({ heldBills: [bill, ...heldBills], cart: [], discount: 0, discountReason: '' });
    return bill;
  },

  recallBill: async (billId) => {
    const { heldBills, cart } = get();
    const bill = heldBills.find((b) => b.id === billId);
    if (!bill) return false;

    // Recalling onto a non-empty cart would silently merge two customers'
    // baskets — hold the current one first instead.
    if (cart.length > 0) {
      await get().holdBill({ note: 'Auto-held on recall' });
    }

    await deleteHeldBill(billId);
    set((state) => ({
      cart: bill.items.map((item) => ({ ...item })),
      heldBills: state.heldBills.filter((b) => b.id !== billId),
    }));
    return true;
  },

  discardHeldBill: async (billId) => {
    await deleteHeldBill(billId);
    set((state) => ({ heldBills: state.heldBills.filter((b) => b.id !== billId) }));
  },

  // ─── Session ───

  setCashier: (id, name, role) => set({ cashierId: id, cashierName: name, cashierRole: role }),

  clearSession: () =>
    set({
      cashierId: null,
      cashierName: null,
      cashierRole: null,
      cart: [],
      discount: 0,
      discountReason: '',
      activeShift: null,
    }),

  // ─── Payment ───

  setPaymentMethod: (method) => set({ selectedPayment: method }),
  setProcessing: (processing) => set({ isProcessing: processing }),

  // ─── Computed ───

  getCartTotals: () => {
    const { cart, discount } = get();
    const totals = calculateCartTotals(cart, discount);
    return {
      subtotal: totals.subtotal,
      totalCGST: totals.total_cgst,
      totalSGST: totals.total_sgst,
      totalTax: totals.total_tax,
      discount: totals.discount,
      grandTotal: totals.grand_total,
      itemCount: totals.item_count,
      lineCount: totals.line_count,
    };
  },

  getStockIssues: () =>
    get()
      .cart.filter((item) => item.qty > item.stock_qty)
      .map((item) => ({ item, available: item.stock_qty })),
}));
