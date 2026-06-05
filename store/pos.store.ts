// ═══════════════════════════════════════
// POS Zustand Store
// ═══════════════════════════════════════
// Manages cart state, active shift, held bills, and cashier session

'use client';

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { CartItem, HeldBill, Shift, PaymentMethod, Product } from '@/types';
import { calculateGST, calculateLineGST } from '@/lib/gst';

interface POSState {
  // Cart
  cart: CartItem[];
  discount: number;

  // Shift
  activeShift: Shift | null;

  // Held bills
  heldBills: HeldBill[];

  // Cashier
  cashierId: string | null;
  cashierName: string | null;

  // Payment
  selectedPayment: PaymentMethod;

  // UI
  isPaymentDialogOpen: boolean;
  isShiftDialogOpen: boolean;
  isHeldBillsOpen: boolean;
  isProcessing: boolean;

  // Actions — Cart
  addToCart: (product: Product) => void;
  removeFromCart: (cartItemId: string) => void;
  updateQty: (cartItemId: string, qty: number) => void;
  clearCart: () => void;
  setDiscount: (discount: number) => void;

  // Actions — Shift
  setActiveShift: (shift: Shift | null) => void;

  // Actions — Hold/Recall
  holdBill: (note?: string) => void;
  recallBill: (billId: string) => void;
  removeHeldBill: (billId: string) => void;

  // Actions — Cashier
  setCashier: (id: string, name: string) => void;
  clearCashier: () => void;

  // Actions — Payment
  setPaymentMethod: (method: PaymentMethod) => void;
  setPaymentDialogOpen: (open: boolean) => void;
  setShiftDialogOpen: (open: boolean) => void;
  setHeldBillsOpen: (open: boolean) => void;
  setProcessing: (processing: boolean) => void;

  // Computed
  getCartTotals: () => {
    subtotal: number;
    totalCGST: number;
    totalSGST: number;
    totalTax: number;
    grandTotal: number;
    itemCount: number;
  };
}

export const usePOSStore = create<POSState>((set, get) => ({
  // Initial state
  cart: [],
  discount: 0,
  activeShift: null,
  heldBills: [],
  cashierId: null,
  cashierName: null,
  selectedPayment: 'CASH',
  isPaymentDialogOpen: false,
  isShiftDialogOpen: false,
  isHeldBillsOpen: false,
  isProcessing: false,

  // ─── Cart Actions ───

  addToCart: (product: Product) => {
    set((state) => {
      // Check if product already in cart
      const existing = state.cart.find((item) => item.product_id === product.id);

      if (existing) {
        // Increment qty
        return {
          cart: state.cart.map((item) => {
            if (item.product_id === product.id) {
              const newQty = item.qty + 1;
              const lineCalc = calculateLineGST(product.price, product.gst_rate, newQty);
              return {
                ...item,
                qty: newQty,
                base_price: lineCalc.base_price,
                tax_amount: lineCalc.tax_amount,
                cgst: lineCalc.cgst,
                sgst: lineCalc.sgst,
                line_total: lineCalc.line_total,
              };
            }
            return item;
          }),
        };
      }

      // Add new item
      const gstCalc = calculateGST(product.price, product.gst_rate);
      const newItem: CartItem = {
        id: uuidv4(),
        product_id: product.id,
        product_name: product.name,
        barcode: product.barcode,
        hsn_code: product.hsn_code,
        category: product.category,
        gst_rate: product.gst_rate,
        qty: 1,
        unit_price: product.price,
        base_price: gstCalc.base_price,
        tax_amount: gstCalc.gst_amount,
        cgst: gstCalc.cgst,
        sgst: gstCalc.sgst,
        line_total: product.price,
      };

      return { cart: [...state.cart, newItem] };
    });
  },

  removeFromCart: (cartItemId: string) => {
    set((state) => ({
      cart: state.cart.filter((item) => item.id !== cartItemId),
    }));
  },

  updateQty: (cartItemId: string, qty: number) => {
    if (qty < 1) return;
    set((state) => ({
      cart: state.cart.map((item) => {
        if (item.id === cartItemId) {
          const lineCalc = calculateLineGST(item.unit_price, item.gst_rate, qty);
          return {
            ...item,
            qty,
            base_price: lineCalc.base_price,
            tax_amount: lineCalc.tax_amount,
            cgst: lineCalc.cgst,
            sgst: lineCalc.sgst,
            line_total: lineCalc.line_total,
          };
        }
        return item;
      }),
    }));
  },

  clearCart: () => set({ cart: [], discount: 0 }),

  setDiscount: (discount: number) => set({ discount }),

  // ─── Shift Actions ───

  setActiveShift: (shift: Shift | null) => set({ activeShift: shift }),

  // ─── Hold/Recall Actions ───

  holdBill: (note?: string) => {
    const { cart, heldBills, clearCart } = get();
    if (cart.length === 0) return;

    const heldBill: HeldBill = {
      id: uuidv4(),
      items: [...cart],
      held_at: new Date().toISOString(),
      customer_note: note,
    };

    set({ heldBills: [...heldBills, heldBill] });
    clearCart();
  },

  recallBill: (billId: string) => {
    const { heldBills } = get();
    const bill = heldBills.find((b) => b.id === billId);
    if (!bill) return;

    set({
      cart: [...bill.items],
      heldBills: heldBills.filter((b) => b.id !== billId),
    });
  },

  removeHeldBill: (billId: string) => {
    set((state) => ({
      heldBills: state.heldBills.filter((b) => b.id !== billId),
    }));
  },

  // ─── Cashier Actions ───

  setCashier: (id: string, name: string) =>
    set({ cashierId: id, cashierName: name }),

  clearCashier: () =>
    set({ cashierId: null, cashierName: null, cart: [], activeShift: null }),

  // ─── Payment Actions ───

  setPaymentMethod: (method: PaymentMethod) => set({ selectedPayment: method }),
  setPaymentDialogOpen: (open: boolean) => set({ isPaymentDialogOpen: open }),
  setShiftDialogOpen: (open: boolean) => set({ isShiftDialogOpen: open }),
  setHeldBillsOpen: (open: boolean) => set({ isHeldBillsOpen: open }),
  setProcessing: (processing: boolean) => set({ isProcessing: processing }),

  // ─── Computed ───

  getCartTotals: () => {
    const { cart, discount } = get();
    let subtotal = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalTax = 0;
    let grandTotal = 0;
    let itemCount = 0;

    for (const item of cart) {
      subtotal += item.base_price;
      totalCGST += item.cgst;
      totalSGST += item.sgst;
      totalTax += item.tax_amount;
      grandTotal += item.line_total;
      itemCount += item.qty;
    }

    grandTotal = Math.max(0, grandTotal - discount);

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      totalCGST: Math.round(totalCGST * 100) / 100,
      totalSGST: Math.round(totalSGST * 100) / 100,
      totalTax: Math.round(totalTax * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
      itemCount,
    };
  },
}));
