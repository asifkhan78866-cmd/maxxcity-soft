'use client';

import { useState, useEffect, useRef } from 'react';
import { usePOSStore } from '@/store/pos.store';
import { useBarcodeScanner } from '@/lib/barcode';
import { formatINR } from '@/lib/gst';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import {
  Scan,
  Search,
  ShoppingCart,
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
} from 'lucide-react';
import type { Product, PaymentMethod, CartItem } from '@/types';
import { generateReceiptText, printReceiptBrowser, type ReceiptData } from '@/lib/printer';
import { generateGSTSummary } from '@/lib/gst';
import { db, saveOfflineSale, cacheProducts } from '@/lib/dexie';
import { forceSync, isOnline } from '@/lib/sync';

const CATEGORIES = ['All', 'Kitchen', 'Care', 'Electronics', 'Fashion', 'Toys', 'Stationery', 'Seasonal'];

const CAT_COLORS: Record<string, string> = {
  All: 'bg-primary text-primary-foreground',
  Kitchen: 'bg-orange-100 text-orange-800 border-orange-200',
  Care: 'bg-blue-100 text-blue-800 border-blue-200',
  Electronics: 'bg-purple-100 text-purple-800 border-purple-200',
  Fashion: 'bg-pink-100 text-pink-800 border-pink-200',
  Toys: 'bg-green-100 text-green-800 border-green-200',
  Stationery: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Seasonal: 'bg-red-100 text-red-800 border-red-200',
};

export default function POSBillingScreen() {
  const store = usePOSStore();
  const { cart, cashierName } = store;
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // Real Data States
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  
  // Payment State
  const [selectedPayment, setSelectedPayment] = useState<PaymentMethod>('CASH');
  const [amountTendered, setAmountTendered] = useState<string>('');
  const [cardLast4, setCardLast4] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastInvoice, setLastInvoice] = useState('');

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const totals = store.getCartTotals();

  // Ensure barcode is always focused
  useEffect(() => {
    barcodeInputRef.current?.focus();
    const interval = setInterval(() => {
      if (document.activeElement?.tagName !== 'INPUT') {
        barcodeInputRef.current?.focus();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch products on mount (Sync online to IndexedDB, then load IndexedDB to UI)
  useEffect(() => {
    const loadProducts = async () => {
      try {
        if (isOnline()) {
          const res = await fetch('/api/products');
          const json = await res.json();
          if (json.success && json.data) {
            await cacheProducts(json.data);
          }
        }
        // Load from Dexie cache
        const cached = await db.cachedProducts.toArray();
        setAllProducts(cached as any as Product[]);
        setFilteredProducts(cached as any as Product[]);
      } catch (error) {
        console.error('Failed to load products', error);
        toast.error('Failed to load product catalog');
      }
    };
    loadProducts();
  }, []);

  // Handle Search & Filter
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      let filtered = allProducts;
      if (selectedCategory !== 'All') {
        filtered = filtered.filter((p) => p.category === selectedCategory);
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(
          (p) => p.name.toLowerCase().includes(q) || p.barcode.includes(q)
        );
      }
      setFilteredProducts(filtered);
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedCategory, allProducts]);

  // Barcode Scanner Hook
  useBarcodeScanner({
    onScan: (barcode) => {
      const product = allProducts.find((p) => p.barcode === barcode);
      if (product) {
        store.addToCart(product);
        toast.success(`Scanned: ${product.name}`);
      } else {
        toast.error(`Product not found: ${barcode}`);
      }
    },
  });

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); store.clearCart(); toast.info('New Sale'); }
      if (e.key === 'F3') { e.preventDefault(); store.holdBill(); toast.info('Bill held'); }
      if (e.key === 'F5') { e.preventDefault(); handlePrint(); }
      if (e.key === 'F8') { e.preventDefault(); document.getElementById('btn-confirm-payment')?.click(); }
      if (e.key === 'F10') { e.preventDefault(); toast.info('Close Shift Action'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, selectedPayment]);

  // Simulate customer lookup
  const handlePhoneBlur = () => {
    if (customerPhone.length === 10) {
      if (customerPhone === '9876543210') setCustomerName('Ramesh Kumar');
      else setCustomerName('');
    }
  };

  const handlePrint = () => {
    if (cart.length === 0 && !lastInvoice) return;
    const inv = lastInvoice || `MCM/2025/PREVIEW`;
    const receiptData: ReceiptData = {
      storeName: 'MaxxCity Mall',
      storeAddress: 'Ramnagar Main Road, Adilabad',
      storeGSTIN: '36ABCDE1234F1Z5',
      storePhone: '',
      invoiceNumber: inv,
      date: new Date().toLocaleDateString('en-IN'),
      time: new Date().toLocaleTimeString('en-IN'),
      cashierName: cashierName || 'Cashier',
      items: cart.map((item: CartItem) => ({
        name: item.product_name,
        qty: item.qty,
        price: item.unit_price,
        total: item.line_total,
      })),
      subtotal: totals.subtotal,
      cgst: totals.totalCGST,
      sgst: totals.totalSGST,
      totalTax: totals.totalTax,
      discount: 0,
      grandTotal: totals.grandTotal,
      paymentMethod: selectedPayment,
      gstSummary: generateGSTSummary(cart).map((g) => ({
        rate: g.rate,
        taxable: g.taxable_value,
        cgst: g.cgst,
        sgst: g.sgst,
      })),
    };
    printReceiptBrowser(receiptData);
  };

  const handlePayment = async () => {
    if (cart.length === 0) return;
    setIsProcessing(true);

    try {
      const invoiceNumber = `MCM/${new Date().getFullYear()}/${String(Date.now()).slice(-6)}`;
      
      const offlineSale = {
        invoice_number: invoiceNumber,
        shift_id: 'shift-123', // Hardcoded until Shift logic is fully integrated
        cashier_id: 'cashier-001',
        cashier_name: cashierName || 'Cashier',
        subtotal: totals.subtotal,
        total_cgst: totals.totalCGST,
        total_sgst: totals.totalSGST,
        total_tax: totals.totalTax,
        discount: 0,
        grand_total: totals.grandTotal,
        payment_method: selectedPayment,
        payment_status: 'COMPLETED',
        status: 'COMPLETED',
        synced: false,
        created_at: new Date().toISOString(),
        items: cart.map((item) => ({
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
      };

      await saveOfflineSale(offlineSale as any);
      
      // Trigger background sync immediately if online
      if (isOnline()) {
        forceSync();
      }

      setLastInvoice(invoiceNumber);
      setShowSuccess(true);
      handlePrint();

      setTimeout(() => {
        store.clearCart();
        setShowSuccess(false);
        setAmountTendered('');
        setCardLast4('');
        setCustomerPhone('');
        setCustomerName('');
        barcodeInputRef.current?.focus();
      }, 2000);
    } catch (error) {
      console.error('Payment failed', error);
      toast.error('Payment processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="h-screen w-full flex overflow-hidden bg-background">
      {/* ========================================================= */}
      {/* LEFT PANEL (30%) - PRODUCT DISCOVERY */}
      {/* ========================================================= */}
      <div className="w-[30%] border-r border-border flex flex-col bg-card shrink-0">
        <div className="p-3 border-b border-border space-y-3">
          <div className="relative">
            <Scan className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary" />
            <Input
              ref={barcodeInputRef}
              placeholder="Barcode Input (Auto-focused)..."
              className="pl-10 h-12 bg-primary/5 border-primary/20 font-bold"
              data-barcode-input="true"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
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
                    selectedCategory === cat ? CAT_COLORS[cat] || 'bg-primary text-white' : 'bg-transparent text-muted-foreground hover:bg-muted'
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
          <div className="grid grid-cols-3 gap-2">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => store.addToCart(p)}
                className="flex flex-col items-start p-2 rounded-lg border hover:border-primary/50 hover:bg-primary/5 transition-all text-left bg-background relative overflow-hidden"
              >
                <span className="text-xs font-semibold leading-tight line-clamp-2 min-h-[2rem]">
                  {p.name}
                </span>
                <span className="text-[10px] text-muted-foreground mt-1 truncate w-full">
                  {p.barcode}
                </span>
                <div className="mt-2 flex items-center justify-between w-full">
                  <Badge variant="secondary" className="text-[10px] px-1 bg-maxx-gold/20 text-maxx-gold border-maxx-gold/30">
                    ₹149
                  </Badge>
                  {p.stock_qty < p.low_stock_threshold && (
                    <span className="text-[9px] text-destructive font-bold">{p.stock_qty} left</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ========================================================= */}
      {/* CENTER PANEL (42%) - CART */}
      {/* ========================================================= */}
      <div className="w-[42%] flex flex-col bg-background shrink-0 border-r border-border">
        {/* Header */}
        <div className="h-14 border-b border-border px-4 flex items-center justify-between bg-card text-sm">
          <div>
            <span className="font-bold">Bill #MCM/2025/---</span>
            <span className="text-muted-foreground ml-3 text-xs" suppressHydrationWarning>
              {new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
          <div className="text-muted-foreground text-xs flex items-center gap-1">
            Cashier: <span className="font-medium text-foreground">{cashierName}</span>
          </div>
        </div>

        {/* Cart Table */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Table Header */}
          <div className="grid grid-cols-[30px_1fr_90px_60px_70px_40px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase">
            <div>#</div>
            <div>Product Name</div>
            <div className="text-center">Qty</div>
            <div className="text-right">Price</div>
            <div className="text-right">Total</div>
            <div></div>
          </div>
          
          <ScrollArea className="flex-1">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground py-32">
                <QrCode className="w-24 h-24 mb-4 opacity-20" />
                <p className="text-xl font-semibold">Scan a product to begin</p>
                <p className="text-sm mt-2">Always ₹149 per item</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {cart.map((item, idx) => {
                  const product = allProducts.find(p => p.id === item.product_id);
                  const isLowStock = product && product.stock_qty < item.qty;
                  
                  return (
                    <div key={item.id} className={`grid grid-cols-[30px_1fr_90px_60px_70px_40px] gap-2 px-4 py-3 items-center text-sm ${isLowStock ? 'bg-orange-50/50' : ''}`}>
                      <div className="font-medium text-muted-foreground">{idx + 1}</div>
                      <div className="font-semibold truncate">
                        {item.product_name}
                        {isLowStock && (
                          <div className="flex items-center gap-1 text-[10px] text-orange-600 mt-0.5">
                            <AlertTriangle className="w-3 h-3" />
                            Stock: {product.stock_qty}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => item.qty > 1 ? store.updateQty(item.id, item.qty - 1) : store.removeFromCart(item.id)}><Minus className="w-3 h-3"/></Button>
                        <span className="w-6 text-center font-bold">{item.qty}</span>
                        <Button variant="outline" size="icon" className="h-6 w-6 rounded-full" onClick={() => store.updateQty(item.id, item.qty + 1)}><Plus className="w-3 h-3"/></Button>
                      </div>
                      <div className="text-right text-muted-foreground">149</div>
                      <div className="text-right font-bold">{formatINR(item.line_total)}</div>
                      <div className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => store.removeFromCart(item.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Footer */}
        <div className="h-14 border-t border-border bg-card flex items-center justify-between px-6 shrink-0">
          <div className="font-semibold text-muted-foreground">Items: <span className="text-foreground">{totals.itemCount}</span></div>
          <div className="font-bold text-lg">Subtotal: <span className="text-primary">{formatINR(totals.subtotal)}</span></div>
        </div>

        {/* Toolbar */}
        <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between gap-2 shrink-0">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 font-semibold text-xs" onClick={() => store.holdBill()}><PauseCircle className="w-4 h-4" /> Hold Bill (F3)</Button>
            <Button variant="outline" size="sm" className="gap-1.5 font-semibold text-xs" onClick={() => store.clearCart()}><FileText className="w-4 h-4" /> New Sale (F2)</Button>
          </div>
          <Button variant="ghost" size="sm" className="text-destructive text-xs hover:bg-destructive/10" onClick={() => store.clearCart()}>Clear Cart</Button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* RIGHT PANEL (28%) - PAYMENT */}
      {/* ========================================================= */}
      <div className="w-[28%] flex flex-col bg-muted/10 shrink-0">
        {/* Bill Summary Card */}
        <div className="p-4">
          <Card className="p-4 shadow-sm border-primary/10">
            <h3 className="font-bold text-sm mb-3">Bill Summary</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatINR(totals.subtotal)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>CGST (Avg 6%)</span><span>{formatINR(totals.totalCGST)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>SGST (Avg 6%)</span><span>{formatINR(totals.totalSGST)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Discount</span><span>₹ 0.00</span></div>
            </div>
            <Separator className="my-3" />
            <div className="flex justify-between items-center">
              <span className="font-bold text-lg">TOTAL</span>
              <span className="font-black text-3xl text-primary">{formatINR(totals.grandTotal)}</span>
            </div>
          </Card>
        </div>

        {/* Customer Info */}
        <div className="px-4 pb-4">
          <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Customer Phone (Optional)</label>
          <div className="flex gap-2">
            <div className="flex items-center px-3 bg-muted rounded-md border text-sm text-muted-foreground">+91</div>
            <Input 
              placeholder="10-digit number" 
              maxLength={10} 
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, ''))}
              onBlur={handlePhoneBlur}
              className="font-bold"
            />
          </div>
          {customerName && <p className="text-xs text-primary font-medium mt-1.5 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> {customerName}</p>}
        </div>

        {/* Payment Methods */}
        <div className="px-4 flex-1 flex flex-col">
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Button variant={selectedPayment === 'CASH' ? 'default' : 'outline'} className={`h-12 flex flex-col gap-1 ${selectedPayment === 'CASH' ? 'bg-primary' : ''}`} onClick={() => setSelectedPayment('CASH')}>
              <Banknote className="w-4 h-4" /> <span className="text-[10px]">CASH</span>
            </Button>
            <Button variant={selectedPayment === 'UPI' ? 'default' : 'outline'} className={`h-12 flex flex-col gap-1 ${selectedPayment === 'UPI' ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600' : ''}`} onClick={() => setSelectedPayment('UPI')}>
              <Smartphone className="w-4 h-4" /> <span className="text-[10px]">UPI</span>
            </Button>
            <Button variant={selectedPayment === 'CARD' ? 'default' : 'outline'} className={`h-12 flex flex-col gap-1 ${selectedPayment === 'CARD' ? 'bg-purple-600 hover:bg-purple-700 text-white border-purple-600' : ''}`} onClick={() => setSelectedPayment('CARD')}>
              <CreditCard className="w-4 h-4" /> <span className="text-[10px]">CARD</span>
            </Button>
          </div>

          {/* Payment Specific Flow */}
          <div className="flex-1">
            {selectedPayment === 'CASH' && (
              <div className="space-y-4 animate-in fade-in">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Amount Tendered</label>
                  <Input 
                    type="number" 
                    placeholder="Enter amount given" 
                    className="h-12 text-lg font-bold"
                    value={amountTendered}
                    onChange={(e) => setAmountTendered(e.target.value)}
                  />
                </div>
                {parseFloat(amountTendered) >= totals.grandTotal && (
                  <div className="bg-green-100 border border-green-200 p-3 rounded-lg flex justify-between items-center text-green-800">
                    <span className="font-semibold text-sm">Change:</span>
                    <span className="font-bold text-xl">₹ {(parseFloat(amountTendered) - totals.grandTotal).toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            {selectedPayment === 'UPI' && (
              <div className="flex flex-col items-center justify-center space-y-3 pt-2 animate-in fade-in">
                <div className="w-32 h-32 bg-white p-2 rounded-xl border-2 border-blue-100 shadow-sm flex items-center justify-center">
                  <QrCode className="w-full h-full text-blue-600" />
                </div>
                <div className="text-center">
                  <p className="font-bold text-sm text-blue-900">Scan to pay {formatINR(totals.grandTotal)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">UPI ID: maxxcitymall@upi</p>
                </div>
              </div>
            )}

            {selectedPayment === 'CARD' && (
              <div className="space-y-4 animate-in fade-in">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase mb-1.5 block">Card Last 4 Digits</label>
                  <Input 
                    placeholder="****" 
                    maxLength={4}
                    className="h-12 text-lg font-bold tracking-[0.5em] text-center"
                    value={cardLast4}
                    onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ''))}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Confirm Button */}
          <div className="pt-4 pb-4 mt-auto">
            <Button 
              id="btn-confirm-payment"
              className={`w-full h-16 text-lg font-bold shadow-lg transition-all ${selectedPayment === 'UPI' ? 'bg-blue-600 hover:bg-blue-700' : selectedPayment === 'CARD' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-primary hover:bg-primary/90'}`}
              disabled={cart.length === 0 || isProcessing || (selectedPayment === 'CASH' && parseFloat(amountTendered || '0') < totals.grandTotal)}
              onClick={handlePayment}
            >
              {isProcessing ? 'Processing...' : selectedPayment === 'UPI' ? 'Mark as Received (F8)' : 'Confirm Payment (F8)'}
            </Button>
          </div>
        </div>
      </div>

      {/* Success Overlay */}
      {showSuccess && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
          <div className="bg-card p-8 rounded-2xl shadow-2xl flex flex-col items-center border border-primary/20">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-3xl font-black mb-2 text-foreground">Payment Successful!</h2>
            <p className="text-muted-foreground text-lg mb-4">Invoice: {lastInvoice}</p>
            <div className="flex items-center gap-2 text-sm bg-primary/10 text-primary px-4 py-2 rounded-full font-semibold">
              <FileText className="w-4 h-4" /> Receipt Printing...
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
