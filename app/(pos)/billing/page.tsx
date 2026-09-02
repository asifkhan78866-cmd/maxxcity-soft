'use client';

// ═══════════════════════════════════════
// POS Billing Screen
// ═══════════════════════════════════════
// Three panels, keyboard-first, offline-capable.
//
//   LEFT   — barcode input, search, categories, product grid
//   CENTER — the CASHIER'S cart. Product names are shown here on purpose:
//            this is the internal view, not the customer's receipt.
//   RIGHT  — totals, payment, confirm
//
// The customer's receipt is produced from the sanitized CustomerReceiptData
// DTO (lib/backend/receipt.ts) and shows only TOTAL PRODUCTS and TOTAL AMOUNT.
// No print path on this screen can reach a product name.
//
// Transaction safety:
//   · one idempotency key per basket, so a double-click / F8 twice / a retry
//     after a timeout can never produce two sales
//   · the sale is COMMITTED FIRST, then printed. A printer failure shows
//     "Sale completed — printing failed" with a reprint, never an unrecorded
//     sale or a lost basket
//   · offline sales persist to IndexedDB with a terminal-scoped invoice
//     number and sync later through the idempotent server route

import { useState, useEffect, useRef, useCallback } from 'react';
import { usePOSStore } from '@/store/pos.store';
import { useBarcodeScanner } from '@/lib/barcode';
import { useSession } from '@/lib/hooks/use-session';
import { useOnlineStatus, useTerminalId } from '@/lib/hooks/use-connectivity';
import { api, ApiClientError } from '@/lib/api-client';
import { formatINR } from '@/lib/money';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Scan,
  Search,
  Plus,
  Minus,
  Trash2,
  CreditCard,
  Banknote,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  PauseCircle,
  FileText,
  Printer,
  WifiOff,
  Wifi,
  RefreshCw,
  LogOut,
  Lock,
  Loader2,
} from 'lucide-react';
import type { Product, PaymentMethod, CartItem, Shift } from '@/types';
import {
  buildCustomerReceiptFromCart,
  type CustomerReceiptData,
} from '@/lib/backend/receipt';
import {
  printCustomerReceipt,
  connectPrinter,
  isPrinterConnected,
  isWebSerialSupported,
} from '@/lib/backend/printer';
import {
  cacheProducts,
  getCachedProducts,
  saveOfflineSale,
  getNextOfflineInvoiceNumber,
  type CachedProduct,
} from '@/lib/database/dexie';
import {
  startSyncEngine,
  stopSyncEngine,
  forceSync,
  getPendingCount,
  isOnline,
  type SyncStatus,
} from '@/lib/database/sync';

const CATEGORIES = [
  'All',
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
];

const CAT_COLORS: Record<string, string> = {
  All: 'bg-primary text-primary-foreground',
  Kitchen: 'bg-orange-100 text-orange-800 border-orange-200',
  'Home & Kitchen': 'bg-orange-100 text-orange-800 border-orange-200',
  Care: 'bg-blue-100 text-blue-800 border-blue-200',
  'Personal Care': 'bg-blue-100 text-blue-800 border-blue-200',
  Electronics: 'bg-purple-100 text-purple-800 border-purple-200',
  Fashion: 'bg-pink-100 text-pink-800 border-pink-200',
  Clothing: 'bg-pink-100 text-pink-800 border-pink-200',
  Toys: 'bg-green-100 text-green-800 border-green-200',
  Stationery: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Seasonal: 'bg-red-100 text-red-800 border-red-200',
};

function cachedToProduct(p: CachedProduct): Product {
  return {
    id: p.id,
    name: p.name,
    barcode: p.barcode,
    category: p.category as Product['category'],
    hsn_code: p.hsn_code,
    gst_rate: p.gst_rate as Product['gst_rate'],
    price: p.price,
    stock_qty: p.stock_qty,
    low_stock_threshold: p.low_stock_threshold,
    is_active: p.is_active,
    created_at: '',
    updated_at: '',
  };
}

interface SaleOutcome {
  invoiceNumber: string;
  grandTotal: number;
  totalItems: number;
  offline: boolean;
  printed: boolean;
  printError?: string;
  receipt: CustomerReceiptData;
}

export default function POSBillingScreen() {
  const store = usePOSStore();
  const { cart, activeShift, heldBills } = store;
  const { user, loading: sessionLoading, logout } = useSession();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);

  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('CASH');
  const [amountTendered, setAmountTendered] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerLookupState, setCustomerLookupState] = useState<'idle' | 'looking' | 'found' | 'new'>('idle');

  const [isProcessing, setIsProcessing] = useState(false);
  const [outcome, setOutcome] = useState<SaleOutcome | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [pendingSync, setPendingSync] = useState(0);
  const [printerReady, setPrinterReady] = useState(() => isPrinterConnected());

  // Browser-owned values, read through useSyncExternalStore so they stay
  // current without an effect and render identically on the server.
  const online = useOnlineStatus();
  const terminalId = useTerminalId();

  const [showOpenShift, setShowOpenShift] = useState(false);
  const [openingCash, setOpeningCash] = useState('');
  const [showCloseShift, setShowCloseShift] = useState(false);
  const [closingCash, setClosingCash] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [showHeldBills, setShowHeldBills] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  /**
   * Idempotency key for the CURRENT basket.
   *
   * Created when a basket starts and cleared only once the sale is committed.
   * Every retry of the same basket reuses it, so the server recognises the
   * replay and returns the original sale instead of billing twice.
   */
  const clientSaleIdRef = useRef<string>('');

  const totals = store.getCartTotals();
  const stockIssues = store.getStockIssues();

  // ── Session → store ──
  // Zustand is an external store, so writing to it from an effect is exactly
  // what effects are for.
  useEffect(() => {
    if (user) usePOSStore.getState().setCashier(user.id, user.name, user.role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ── Keep the barcode field focused ──
  useEffect(() => {
    barcodeInputRef.current?.focus();
    const interval = setInterval(() => {
      const active = document.activeElement;
      const typingElsewhere =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement | null)?.isContentEditable;
      if (!typingElsewhere && !outcome) barcodeInputRef.current?.focus();
    }, 1500);
    return () => clearInterval(interval);
  }, [outcome]);

  // ── Catalogue: server when online, IndexedDB cache otherwise ──

  /**
   * Fetch the catalogue. Deliberately PURE — it returns data and never touches
   * React state, so it can be driven from a promise chain inside an effect
   * (which is what keeps state out of the effect body) as well as from an
   * event handler.
   */
  const fetchCatalogue = useCallback(async (): Promise<{
    products: Product[];
    source: 'server' | 'cache';
  }> => {
    if (isOnline()) {
      try {
        const products = await api.get<Product[]>('/api/products');
        if (products.length > 0) {
          await cacheProducts(
            products.map((p) => ({
              id: p.id,
              name: p.name,
              barcode: p.barcode,
              category: p.category,
              hsn_code: p.hsn_code,
              gst_rate: p.gst_rate,
              price: p.price,
              stock_qty: p.stock_qty,
              low_stock_threshold: p.low_stock_threshold,
              is_active: p.is_active,
            }))
          );
        }
        return { products, source: 'server' };
      } catch {
        // Server unreachable — fall through to whatever is cached locally
        // rather than leaving the counter with no catalogue.
      }
    }

    const cached = await getCachedProducts();
    return { products: cached.map(cachedToProduct), source: 'cache' };
  }, []);

  /** Reload from an event handler (refresh button, after a sale). */
  const refreshCatalogue = useCallback(
    async (announce = false) => {
      setCatalogueLoading(true);
      try {
        const { products, source } = await fetchCatalogue();
        setAllProducts(products);
        usePOSStore.getState().syncStockLevels(products);
        if (announce) {
          if (source === 'cache') toast.info(`Using the offline catalogue (${products.length} products)`);
          else toast.success(`${products.length} products loaded`);
        }
      } finally {
        setCatalogueLoading(false);
      }
    },
    [fetchCatalogue]
  );

  // Initial load. State settles inside the promise callbacks, never in the
  // effect body itself.
  useEffect(() => {
    let active = true;

    fetchCatalogue()
      .then(({ products }) => {
        if (!active) return;
        setAllProducts(products);
        usePOSStore.getState().syncStockLevels(products);
        if (products.length === 0) {
          toast.error(
            'No product catalogue available. Connect to the internet once to download it.',
            { duration: 10000 }
          );
        }
      })
      .catch((error) => {
        console.error('Could not load the catalogue', error);
      })
      .finally(() => {
        if (active) setCatalogueLoading(false);
      });

    void usePOSStore.getState().hydrateHeldBills();

    return () => {
      active = false;
    };
  }, [fetchCatalogue]);

  // ── Sync engine ──
  // Subscribes to an external system; state only ever changes from its
  // callbacks, never synchronously here.
  useEffect(() => {
    startSyncEngine({
      onStatusChange: setSyncStatus,
      onProgress: (summary) => setPendingSync(summary.pending),
    });

    getPendingCount()
      .then(setPendingSync)
      .catch(() => {});

    return () => stopSyncEngine();
  }, []);

  // ── Active shift ──
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;

    api
      .get<{ shift: Shift | null }>('/api/shifts/current')
      .then(({ shift }) => {
        if (!active) return;
        store.setActiveShift(shift);
        // No open shift means no billing — prompt for one straight away.
        if (!shift) setShowOpenShift(true);
      })
      .catch((error) => {
        // Offline: keep whatever shift state we already had rather than
        // blocking the counter over a failed status check.
        if (error instanceof ApiClientError && error.code === 'NETWORK_ERROR') return;
        console.error('Could not load the active shift', error);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // ── Filtering ──
  const filteredProducts = allProducts.filter((p) => {
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q);
  });

  // ── Cart ──
  const ensureBasketId = useCallback(() => {
    if (!clientSaleIdRef.current) clientSaleIdRef.current = crypto.randomUUID();
  }, []);

  const addProduct = useCallback(
    (product: Product) => {
      ensureBasketId();
      const result = store.addToCart(product);
      if (!result.ok) toast.error(result.message ?? 'Could not add that item');
      return result.ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureBasketId]
  );

  useBarcodeScanner({
    enabled: !outcome && !isProcessing,
    onScan: (barcode) => {
      const product = allProducts.find((p) => p.barcode === barcode);
      if (!product) {
        toast.error(`No product with barcode ${barcode}`);
        return;
      }
      if (addProduct(product)) toast.success(product.name, { duration: 1200 });
    },
  });

  // ── Customer lookup (never blocks checkout) ──
  const lookupCustomer = useCallback(async () => {
    if (customerPhone.length !== 10) {
      setCustomerLookupState('idle');
      return;
    }
    setCustomerLookupState('looking');
    try {
      const { customer } = await api.get<{ customer: { name: string | null } | null }>(
        `/api/customers?phone=${encodeURIComponent(customerPhone)}`
      );
      if (customer) {
        setCustomerName(customer.name ?? '');
        setCustomerLookupState('found');
      } else {
        setCustomerLookupState('new');
      }
    } catch {
      // A lookup failure is not a checkout failure.
      setCustomerLookupState('idle');
    }
  }, [customerPhone]);

  // ── Printing ──
  const doPrint = useCallback(async (receipt: CustomerReceiptData) => {
    const result = await printCustomerReceipt(receipt);
    return result;
  }, []);

  const resetForNextSale = useCallback(() => {
    clientSaleIdRef.current = '';
    store.clearCart();
    setAmountTendered('');
    setCustomerPhone('');
    setCustomerName('');
    setCustomerLookupState('idle');
    setOutcome(null);
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Checkout ──
  const handlePayment = useCallback(async () => {
    if (cart.length === 0 || isProcessing || outcome) return;

    if (!activeShift) {
      toast.error('Open a shift before billing');
      setShowOpenShift(true);
      return;
    }

    if (stockIssues.length > 0) {
      toast.error(
        `Not enough stock: ${stockIssues.map((i) => i.item.product_name).join(', ')}`
      );
      return;
    }

    const tendered = selectedPayment === 'CASH' ? parseFloat(amountTendered || '0') : undefined;
    if (selectedPayment === 'CASH' && (!tendered || tendered < totals.grandTotal)) {
      toast.error('Cash received is less than the bill total');
      return;
    }

    ensureBasketId();
    setIsProcessing(true);

    const payload = {
      client_sale_id: clientSaleIdRef.current,
      shift_id: activeShift.id,
      items: cart.map((item) => ({ product_id: item.product_id, qty: item.qty })),
      payment_method: selectedPayment,
      amount_tendered: tendered ?? null,
      discount: totals.discount,
      discount_reason: store.discountReason || null,
      customer_phone: customerPhone.length === 10 ? customerPhone : null,
      customer_name: customerName || null,
      terminal_id: terminalId,
    };

    try {
      // ── STEP 1: commit the sale. Nothing is printed until this succeeds. ──
      const result = await api.post<{
        invoice_number: string;
        grand_total: number;
        total_items: number;
        total_cgst: number;
        total_sgst: number;
        discount: number;
        duplicate: boolean;
      }>('/api/sales', payload);

      if (result.duplicate) {
        toast.info('That sale was already recorded — showing the original bill.');
      }

      // ── STEP 2: build the SANITIZED receipt from the SERVER'S figures. ──
      const receipt = buildCustomerReceiptFromCart({
        invoiceNumber: result.invoice_number,
        cart,
        cashierName: user?.name ?? 'Cashier',
        paymentMethod: selectedPayment,
        grandTotal: result.grand_total,
        discount: result.discount,
        totalCgst: result.total_cgst,
        totalSgst: result.total_sgst,
        amountTendered: tendered,
      });

      // ── STEP 3: print. A failure here never unmakes the sale. ──
      const print = await doPrint(receipt);

      setOutcome({
        invoiceNumber: result.invoice_number,
        grandTotal: result.grand_total,
        totalItems: result.total_items,
        offline: false,
        printed: print.ok,
        printError: print.ok ? undefined : print.error,
        receipt,
      });

      void refreshCatalogue();
    } catch (error) {
      const apiError = error as ApiClientError;

      // A network failure means the terminal is offline (or the server is
      // unreachable). Bill locally rather than turning the customer away —
      // the same idempotency key makes the later sync safe.
      if (apiError.code === 'NETWORK_ERROR' || !isOnline()) {
        try {
          const invoiceNumber = await getNextOfflineInvoiceNumber(terminalId);

          await saveOfflineSale({
            id: crypto.randomUUID(),
            client_sale_id: clientSaleIdRef.current,
            invoice_number: invoiceNumber,
            terminal_id: terminalId,
            shift_id: activeShift.id,
            cashier_id: user?.id ?? '',
            cashier_name: user?.name ?? 'Cashier',
            items: cart.map((item: CartItem) => ({
              product_id: item.product_id,
              product_name: item.product_name,
              barcode: item.barcode,
              hsn_code: item.hsn_code,
              qty: item.qty,
              unit_price: item.unit_price,
              gst_rate: item.gst_rate,
              base_price: item.base_price,
              tax_amount: item.tax_amount,
              cgst: item.cgst,
              sgst: item.sgst,
              line_total: item.line_total,
            })),
            subtotal: totals.subtotal,
            total_cgst: totals.totalCGST,
            total_sgst: totals.totalSGST,
            total_tax: totals.totalTax,
            discount: totals.discount,
            discount_reason: store.discountReason || null,
            grand_total: totals.grandTotal,
            total_items: totals.itemCount,
            payment_method: selectedPayment,
            amount_tendered: tendered ?? null,
            customer_phone: customerPhone.length === 10 ? customerPhone : null,
            customer_name: customerName || null,
            synced: 0,
            sync_attempts: 0,
            last_sync_error: null,
            server_sale_id: null,
            created_at: new Date().toISOString(),
            synced_at: null,
          });

          const receipt = buildCustomerReceiptFromCart({
            invoiceNumber,
            cart,
            cashierName: user?.name ?? 'Cashier',
            paymentMethod: selectedPayment,
            grandTotal: totals.grandTotal,
            discount: totals.discount,
            totalCgst: totals.totalCGST,
            totalSgst: totals.totalSGST,
            amountTendered: tendered,
          });

          const print = await doPrint(receipt);

          setOutcome({
            invoiceNumber,
            grandTotal: totals.grandTotal,
            totalItems: totals.itemCount,
            offline: true,
            printed: print.ok,
            printError: print.ok ? undefined : print.error,
            receipt,
          });

          setPendingSync((n) => n + 1);
        } catch (offlineError) {
          console.error('Offline save failed', offlineError);
          toast.error(
            'The sale could NOT be saved. Do not hand over the goods — note the details and retry.',
            { duration: 12000 }
          );
        }
      } else {
        // A real business rejection (stock gone, discount not allowed, shift
        // closed). The cart is deliberately kept so the cashier can correct it.
        toast.error(apiError.message, { duration: 8000 });
        if (apiError.code === 'INSUFFICIENT_STOCK') void refreshCatalogue();
      }
    } finally {
      setIsProcessing(false);
    }
  }, [
    cart,
    isProcessing,
    outcome,
    activeShift,
    stockIssues,
    selectedPayment,
    amountTendered,
    totals,
    customerPhone,
    customerName,
    user,
    ensureBasketId,
    doPrint,
    refreshCatalogue,
    terminalId,
    store,
  ]);

  const handleReprint = useCallback(async () => {
    if (!outcome) return;
    const result = await doPrint({ ...outcome.receipt, isReprint: true });
    if (result.ok) {
      toast.success('Receipt sent to the printer');
      setOutcome({ ...outcome, printed: true, printError: undefined });
    } else {
      toast.error(result.error ?? 'Printing failed again');
    }
  }, [outcome, doPrint]);

  // ── Shift open / close ──
  const handleOpenShift = async () => {
    const cash = parseFloat(openingCash || '0');
    if (Number.isNaN(cash) || cash < 0) {
      toast.error('Enter the opening cash amount');
      return;
    }
    setShiftBusy(true);
    try {
      const shift = await api.post<Shift>('/api/shifts', {
        opening_cash: cash,
        terminal_id: terminalId,
      });
      store.setActiveShift(shift);
      setShowOpenShift(false);
      setOpeningCash('');
      toast.success('Shift opened');
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setShiftBusy(false);
    }
  };

  const handleCloseShift = async () => {
    if (!activeShift) return;
    const cash = parseFloat(closingCash || '');
    if (Number.isNaN(cash) || cash < 0) {
      toast.error('Enter the counted cash amount');
      return;
    }
    setShiftBusy(true);
    try {
      const result = await api.post<{ expected_cash: number; discrepancy: number }>(
        '/api/shifts/close',
        { shift_id: activeShift.id, closing_cash: cash, reason: closeReason || null }
      );
      store.setActiveShift(null);
      setShowCloseShift(false);
      setClosingCash('');
      setCloseReason('');
      toast.success(
        `Shift closed. Expected ${formatINR(result.expected_cash)}, counted ${formatINR(cash)}, difference ${formatINR(result.discrepancy)}.`,
        { duration: 10000 }
      );
      setShowOpenShift(true);
    } catch (error) {
      toast.error((error as ApiClientError).message, { duration: 8000 });
    } finally {
      setShiftBusy(false);
    }
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only intercept our own function keys; leave everything else alone so
      // normal typing and browser shortcuts keep working.
      const handled = ['F2', 'F3', 'F4', 'F5', 'F8', 'F10'];
      if (!handled.includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();

      switch (e.key) {
        case 'F2':
          if (outcome) resetForNextSale();
          else {
            store.clearCart();
            clientSaleIdRef.current = '';
            toast.info('New sale');
          }
          break;
        case 'F3':
          void store.holdBill({ phone: customerPhone || undefined }).then((bill) => {
            if (bill) {
              clientSaleIdRef.current = '';
              toast.success(`Bill held: ${bill.label}`);
            }
          });
          break;
        case 'F4':
          setShowHeldBills(true);
          break;
        case 'F5':
          if (outcome) void handleReprint();
          break;
        case 'F8':
          void handlePayment();
          break;
        case 'F10':
          if (activeShift) setShowCloseShift(true);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handlePayment, handleReprint, outcome, activeShift, customerPhone, resetForNextSale, store]);

  const changeDue =
    selectedPayment === 'CASH' && parseFloat(amountTendered || '0') >= totals.grandTotal
      ? parseFloat(amountTendered) - totals.grandTotal
      : null;

  const confirmDisabled =
    cart.length === 0 ||
    isProcessing ||
    !!outcome ||
    !activeShift ||
    stockIssues.length > 0 ||
    (selectedPayment === 'CASH' && parseFloat(amountTendered || '0') < totals.grandTotal);

  if (sessionLoading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      {/* ══════════ STATUS BAR ══════════ */}
      <div className="h-10 border-b border-border bg-card px-4 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-primary">MaxxCity POS</span>
          <Badge variant="outline" className="text-[10px] font-mono">
            {terminalId || '…'}
          </Badge>
          {activeShift ? (
            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]">
              Shift open · opened{' '}
              {new Date(activeShift.opened_at).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-[10px] gap-1">
              <Lock className="w-3 h-3" /> No open shift
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-3">
          {online ? (
            <span className="flex items-center gap-1 text-emerald-600">
              <Wifi className="w-3.5 h-3.5" /> Online
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-600 font-semibold">
              <WifiOff className="w-3.5 h-3.5" /> Offline — billing continues
            </span>
          )}

          {pendingSync > 0 && (
            <button
              onClick={() => void forceSync()}
              className="flex items-center gap-1 text-amber-700 hover:underline"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
              {pendingSync} awaiting sync
            </button>
          )}

          {isWebSerialSupported() && (
            <button
              onClick={async () => {
                const connected = await connectPrinter();
                setPrinterReady(connected);
                toast[connected ? 'success' : 'error'](
                  connected ? 'Thermal printer connected' : 'Could not connect to the printer'
                );
              }}
              className={`flex items-center gap-1 hover:underline ${printerReady ? 'text-emerald-600' : 'text-muted-foreground'}`}
            >
              <Printer className="w-3.5 h-3.5" />
              {printerReady ? 'Printer ready' : 'Connect printer'}
            </button>
          )}

          <span className="text-muted-foreground">
            {user?.name} · {user?.role}
          </span>
          <button onClick={() => void logout()} className="text-muted-foreground hover:text-destructive">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ══════════ LEFT — PRODUCT DISCOVERY ══════════ */}
        <div className="w-[30%] border-r border-border flex flex-col bg-card shrink-0">
          <div className="p-3 border-b border-border space-y-3">
            <div className="relative">
              <Scan className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary" />
              <Input
                ref={barcodeInputRef}
                placeholder="Scan barcode…"
                className="pl-10 h-12 bg-primary/5 border-primary/20 font-bold"
                data-barcode-input="true"
                aria-label="Barcode scanner input"
              />
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or barcode…"
                className="pl-9 h-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="border-b border-border p-2">
            <ScrollArea className="w-full whitespace-nowrap">
              <div className="flex w-max space-x-2 px-1 pb-2">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                      selectedCategory === cat
                        ? CAT_COLORS[cat] || 'bg-primary text-white'
                        : 'bg-transparent text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <ScrollBar orientation="horizontal" className="h-1.5" />
            </ScrollArea>
          </div>

          <ScrollArea className="flex-1 p-3">
            {catalogueLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProducts.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-12">
                No products match this filter.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {filteredProducts.map((p) => {
                  const outOfStock = p.stock_qty <= 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      disabled={outOfStock}
                      className={`flex flex-col items-start p-2 rounded-lg border text-left bg-background transition-all ${
                        outOfStock
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:border-primary/50 hover:bg-primary/5'
                      }`}
                    >
                      <span className="text-xs font-semibold leading-tight line-clamp-2 min-h-[2rem]">
                        {p.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground mt-1 truncate w-full">
                        {p.barcode}
                      </span>
                      <div className="mt-2 flex items-center justify-between w-full gap-1">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1 bg-maxx-gold/20 text-maxx-gold border-maxx-gold/30"
                        >
                          ₹{DEFAULT_PRODUCT_PRICE}
                        </Badge>
                        <span
                          className={`text-[9px] font-bold ${
                            outOfStock
                              ? 'text-destructive'
                              : p.stock_qty <= p.low_stock_threshold
                                ? 'text-orange-600'
                                : 'text-muted-foreground'
                          }`}
                        >
                          {outOfStock ? 'OUT' : `${p.stock_qty} left`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ══════════ CENTER — CASHIER CART (internal view) ══════════ */}
        <div className="w-[42%] flex flex-col bg-background shrink-0 border-r border-border">
          <div className="h-12 border-b border-border px-4 flex items-center justify-between bg-card text-sm">
            <span className="font-bold">Current Bill</span>
            <span className="text-muted-foreground text-xs" suppressHydrationWarning>
              {new Date().toLocaleDateString('en-IN')}
            </span>
          </div>

          <div className="grid grid-cols-[28px_1fr_100px_60px_78px_36px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase">
            <div>#</div>
            <div>Product</div>
            <div className="text-center">Qty</div>
            <div className="text-right">Price</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          <ScrollArea className="flex-1">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground py-28">
                <QrCode className="w-24 h-24 mb-4 opacity-20" />
                <p className="text-xl font-semibold">Scan a product to begin</p>
                <p className="text-sm mt-2">Every item ₹{DEFAULT_PRODUCT_PRICE}</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {cart.map((item, idx) => {
                  const short = item.qty > item.stock_qty;
                  return (
                    <div
                      key={item.id}
                      className={`grid grid-cols-[28px_1fr_100px_60px_78px_36px] gap-2 px-4 py-3 items-center text-sm ${
                        short ? 'bg-destructive/5' : ''
                      }`}
                    >
                      <div className="font-medium text-muted-foreground">{idx + 1}</div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{item.product_name}</div>
                        {short && (
                          <div className="flex items-center gap-1 text-[10px] text-destructive mt-0.5 font-semibold">
                            <AlertTriangle className="w-3 h-3" />
                            Only {item.stock_qty} in stock
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6 rounded-full"
                          aria-label={`Reduce ${item.product_name}`}
                          onClick={() => store.setQty(item.id, item.qty - 1)}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-7 text-center font-bold">{item.qty}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-6 w-6 rounded-full"
                          aria-label={`Add another ${item.product_name}`}
                          onClick={() => {
                            const r = store.setQty(item.id, item.qty + 1);
                            if (!r.ok) toast.error(r.message ?? 'Not enough stock');
                          }}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="text-right text-muted-foreground">{item.unit_price}</div>
                      <div className="text-right font-bold">{formatINR(item.line_total)}</div>
                      <div className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                          aria-label={`Remove ${item.product_name}`}
                          onClick={() => store.removeFromCart(item.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* The two figures the cashier must always see before confirming. */}
          <div className="border-t-2 border-primary/20 bg-primary/5 px-6 py-3 flex items-center justify-between shrink-0">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Total Products
              </div>
              <div className="text-2xl font-black">{totals.itemCount}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                Total Amount
              </div>
              <div className="text-3xl font-black text-primary">{formatINR(totals.grandTotal)}</div>
            </div>
          </div>

          <div className="p-2.5 border-t border-border bg-muted/20 flex items-center justify-between gap-2 shrink-0">
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 font-semibold text-xs"
                disabled={cart.length === 0}
                onClick={() =>
                  void store.holdBill({ phone: customerPhone || undefined }).then((b) => {
                    if (b) {
                      clientSaleIdRef.current = '';
                      toast.success(`Held: ${b.label}`);
                    }
                  })
                }
              >
                <PauseCircle className="w-4 h-4" /> Hold (F3)
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 font-semibold text-xs"
                onClick={() => setShowHeldBills(true)}
              >
                <FileText className="w-4 h-4" /> Held ({heldBills.length}) · F4
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 font-semibold text-xs"
                onClick={() => {
                  store.clearCart();
                  clientSaleIdRef.current = '';
                }}
              >
                New Sale (F2)
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive text-xs hover:bg-destructive/10"
              disabled={!activeShift}
              onClick={() => setShowCloseShift(true)}
            >
              Close Shift (F10)
            </Button>
          </div>
        </div>

        {/* ══════════ RIGHT — PAYMENT ══════════ */}
        <div className="w-[28%] flex flex-col bg-muted/10 shrink-0 overflow-y-auto">
          <div className="p-4">
            <Card className="p-4 shadow-sm border-primary/10">
              <h3 className="font-bold text-sm mb-3">Bill Summary</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Taxable value</span>
                  <span>{formatINR(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>CGST</span>
                  <span>{formatINR(totals.totalCGST)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>SGST</span>
                  <span>{formatINR(totals.totalSGST)}</span>
                </div>
                {totals.discount > 0 && (
                  <div className="flex justify-between text-destructive font-medium">
                    <span>Discount</span>
                    <span>-{formatINR(totals.discount)}</span>
                  </div>
                )}
              </div>
              <Separator className="my-3" />
              <div className="flex justify-between items-baseline">
                <span className="font-bold">TOTAL</span>
                <span className="font-black text-3xl text-primary">
                  {formatINR(totals.grandTotal)}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 text-right">
                {totals.itemCount} product(s) · price inclusive of GST
              </p>
            </Card>
          </div>

          <div className="px-4 pb-4">
            <label
              htmlFor="customer-phone"
              className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block"
            >
              Customer Phone (optional)
            </label>
            <div className="flex gap-2">
              <div className="flex items-center px-3 bg-muted rounded-md border text-sm text-muted-foreground">
                +91
              </div>
              <Input
                id="customer-phone"
                placeholder="10-digit number"
                maxLength={10}
                inputMode="numeric"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, ''))}
                onBlur={() => void lookupCustomer()}
                className="font-bold"
              />
            </div>
            {customerLookupState === 'found' && (
              <p className="text-xs text-primary font-medium mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> {customerName || 'Returning customer'}
              </p>
            )}
            {customerLookupState === 'new' && (
              <Input
                placeholder="Customer name (optional)"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1.5 h-8 text-sm"
              />
            )}
          </div>

          <div className="px-4 flex-1 flex flex-col">
            <div className="grid grid-cols-3 gap-2 mb-4">
              {(
                [
                  { m: 'CASH' as const, icon: Banknote, cls: 'bg-primary' },
                  { m: 'UPI' as const, icon: Smartphone, cls: 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' },
                  { m: 'CARD' as const, icon: CreditCard, cls: 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600' },
                ]
              ).map(({ m, icon: Icon, cls }) => (
                <Button
                  key={m}
                  variant={selectedPayment === m ? 'default' : 'outline'}
                  className={`h-12 flex flex-col gap-1 ${selectedPayment === m ? cls : ''}`}
                  onClick={() => setSelectedPayment(m)}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-[10px]">{m}</span>
                </Button>
              ))}
            </div>

            <div className="flex-1">
              {selectedPayment === 'CASH' && (
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="tendered"
                      className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block"
                    >
                      Cash Received
                    </label>
                    <Input
                      id="tendered"
                      type="number"
                      inputMode="decimal"
                      placeholder="Amount given by customer"
                      className="h-12 text-lg font-bold"
                      value={amountTendered}
                      onChange={(e) => setAmountTendered(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[100, 200, 500, 2000].map((note) => (
                      <Button
                        key={note}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() =>
                          setAmountTendered(String((parseFloat(amountTendered || '0') || 0) + note))
                        }
                      >
                        +{note}
                      </Button>
                    ))}
                  </div>
                  {changeDue !== null && (
                    <div className="bg-green-100 border border-green-200 p-3 rounded-lg flex justify-between items-center text-green-800">
                      <span className="font-semibold text-sm">Change:</span>
                      <span className="font-bold text-xl">{formatINR(changeDue)}</span>
                    </div>
                  )}
                </div>
              )}

              {selectedPayment === 'UPI' && (
                <div className="flex flex-col items-center justify-center space-y-3 pt-2">
                  <div className="w-32 h-32 bg-white p-2 rounded-xl border-2 border-blue-100 shadow-sm flex items-center justify-center">
                    <QrCode className="w-full h-full text-blue-600" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-sm text-blue-900">
                      Collect {formatINR(totals.grandTotal)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {process.env.NEXT_PUBLIC_STORE_UPI_ID || 'UPI ID not configured'}
                    </p>
                  </div>
                  {/* Honest about what the button means: no provider is wired up,
                      so confirming records the cashier's own confirmation. */}
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 leading-relaxed">
                    No UPI provider is connected. Check the payment on your own UPI app
                    before confirming — this button records that <em>you</em> verified it.
                  </div>
                </div>
              )}

              {selectedPayment === 'CARD' && (
                <div className="space-y-3">
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 leading-relaxed">
                    No card terminal is integrated. Complete the payment on the card
                    machine, then confirm here — this button records that the terminal
                    approved it.
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 pb-4 mt-auto space-y-2">
              {!activeShift && (
                <Button variant="outline" className="w-full" onClick={() => setShowOpenShift(true)}>
                  Open a shift to start billing
                </Button>
              )}
              <Button
                id="btn-confirm-payment"
                className={`w-full h-16 text-lg font-bold shadow-lg transition-all ${
                  selectedPayment === 'UPI'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : selectedPayment === 'CARD'
                      ? 'bg-purple-600 hover:bg-purple-700'
                      : 'bg-primary hover:bg-primary/90'
                }`}
                disabled={confirmDisabled}
                onClick={() => void handlePayment()}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Recording sale…
                  </>
                ) : (
                  `Confirm ${selectedPayment} · ${formatINR(totals.grandTotal)} (F8)`
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ══════════ SALE OUTCOME ══════════ */}
      {outcome && (
        <div className="fixed inset-0 bg-background/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="p-8 max-w-md w-full flex flex-col items-center border-primary/20 shadow-2xl">
            <div
              className={`w-20 h-20 rounded-full flex items-center justify-center mb-5 ${
                outcome.printed ? 'bg-green-100' : 'bg-amber-100'
              }`}
            >
              {outcome.printed ? (
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              ) : (
                <Printer className="w-10 h-10 text-amber-600" />
              )}
            </div>

            <h2 className="text-2xl font-black mb-1 text-center">
              {outcome.printed ? 'Sale Completed' : 'Sale Completed — Printing Failed'}
            </h2>
            <p className="text-muted-foreground text-sm mb-4 font-mono">{outcome.invoiceNumber}</p>

            <div className="w-full bg-muted/40 rounded-lg p-4 space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Products</span>
                <span className="font-bold">{outcome.totalItems}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground text-sm">Total Amount</span>
                <span className="font-black text-xl text-primary">
                  {formatINR(outcome.grandTotal)}
                </span>
              </div>
            </div>

            {outcome.offline && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5 mb-3 text-center">
                Saved on this terminal. It will sync automatically when the connection returns —
                the bill is recorded either way.
              </p>
            )}

            {!outcome.printed && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2.5 mb-3 text-center">
                The sale is recorded. {outcome.printError} You can reprint below.
              </p>
            )}

            <div className="flex gap-2 w-full">
              <Button variant="outline" className="flex-1 gap-2" onClick={() => void handleReprint()}>
                <Printer className="w-4 h-4" /> Reprint (F5)
              </Button>
              <Button className="flex-1" onClick={resetForNextSale}>
                New Sale (F2)
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ══════════ OPEN SHIFT ══════════ */}
      <Dialog open={showOpenShift} onOpenChange={(open) => activeShift && setShowOpenShift(open)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Open Shift</DialogTitle>
            <DialogDescription>
              Count the cash in the drawer and enter it. Closing reconciles against this figure.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="opening-cash">Opening cash (₹)</Label>
            <Input
              id="opening-cash"
              type="number"
              inputMode="decimal"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              className="mt-1 h-11 text-lg font-bold"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button onClick={() => void handleOpenShift()} disabled={shiftBusy} className="w-full">
              {shiftBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Open Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ CLOSE SHIFT ══════════ */}
      <Dialog open={showCloseShift} onOpenChange={setShowCloseShift}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Close Shift</DialogTitle>
            <DialogDescription>
              Count the drawer and enter the actual amount. The system compares it with what it
              expects.
            </DialogDescription>
          </DialogHeader>
          {activeShift && (
            <div className="text-sm space-y-1.5 bg-muted/40 rounded-lg p-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Opening cash</span>
                <span>{formatINR(Number(activeShift.opening_cash))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cash sales</span>
                <span>{formatINR(Number(activeShift.cash_sales_total))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">UPI / Card</span>
                <span>
                  {formatINR(
                    Number(activeShift.upi_sales_total) + Number(activeShift.card_sales_total)
                  )}
                </span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold">
                <span>Expected cash</span>
                <span>{formatINR(Number(activeShift.expected_cash ?? 0))}</span>
              </div>
            </div>
          )}
          <div className="space-y-3 py-1">
            <div>
              <Label htmlFor="closing-cash">Counted cash (₹)</Label>
              <Input
                id="closing-cash"
                type="number"
                inputMode="decimal"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
                className="mt-1 h-11 text-lg font-bold"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="close-reason">Reason for any difference</Label>
              <Input
                id="close-reason"
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="Required if the difference is over ₹50"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCloseShift(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCloseShift()} disabled={shiftBusy}>
              {shiftBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Close Shift'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══════════ HELD BILLS ══════════ */}
      <Dialog open={showHeldBills} onOpenChange={setShowHeldBills}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Held Bills</DialogTitle>
            <DialogDescription>
              Each held bill is labelled so two customers&apos; baskets are never mixed up.
              Recalling while a bill is open holds the current one first.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2 py-2">
            {heldBills.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No held bills.</p>
            ) : (
              heldBills.map((bill) => (
                <div
                  key={bill.id}
                  className="flex items-center justify-between border rounded-lg p-3 gap-3"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{bill.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {bill.items.reduce((s, i) => s + i.qty, 0)} item(s) ·{' '}
                      {new Date(bill.held_at).toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() =>
                        void store.recallBill(bill.id).then((okRecall) => {
                          if (okRecall) {
                            clientSaleIdRef.current = crypto.randomUUID();
                            setShowHeldBills(false);
                          }
                        })
                      }
                    >
                      Recall
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => void store.discardHeldBill(bill.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
