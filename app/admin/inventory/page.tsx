'use client';

// ═══════════════════════════════════════
// Inventory Management
// ═══════════════════════════════════════
// Real Supabase data throughout — no static catalogue.
//
// Stock is never edited directly: every change goes through the adjustment
// dialog, which calls adjust_stock() and leaves a stock_movements entry with
// before/after quantities and a reason. Price is not editable — it is the
// centralised flat selling price.

import { useState, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Package,
  Plus,
  Edit,
  AlertTriangle,
  Filter,
  History,
  Loader2,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@/lib/money';
import { api, ApiClientError } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';
import { useSession } from '@/lib/hooks/use-session';
import { DEFAULT_PRODUCT_PRICE, VALID_GST_RATES } from '@/lib/config/pricing';
import type { Product, StockMovement } from '@/types';

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

const MOVEMENT_TYPES = [
  { value: 'PURCHASE', label: 'Purchase / goods received' },
  { value: 'MANUAL_ADJUSTMENT', label: 'Manual correction' },
  { value: 'DAMAGE', label: 'Damaged' },
  { value: 'LOSS', label: 'Lost / shrinkage' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'OPENING_STOCK', label: 'Opening stock' },
];

interface InventorySummary {
  totalSkus: number;
  totalUnits: number;
  retailValue: number;
  costValue: number;
  costCoverage: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export default function InventoryPage() {
  const { can } = useSession();

  const fetchInventory = useCallback(async () => {
    const [productList, report] = await Promise.all([
      api.get<Product[]>('/api/products?include_inactive=true'),
      api
        .get<{ inventory: InventorySummary }>('/api/reports?section=inventory')
        // A manager without reports access still gets the product table; the
        // summary cards simply show a dash.
        .catch(() => null),
    ]);
    return { products: productList, summary: report?.inventory ?? null };
  }, []);

  const { data, error: loadError, loading, refresh } = useAsyncData(fetchInventory);
  const products = useMemo(() => data?.products ?? [], [data]);
  const summary = data?.summary ?? null;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [showLowStock, setShowLowStock] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    barcode: '',
    category: 'Others',
    hsn_code: '',
    gst_rate: '12',
    cost_price: '',
    stock_qty: '0',
    low_stock_threshold: '20',
  });

  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustType, setAdjustType] = useState('MANUAL_ADJUSTMENT');
  const [adjustReason, setAdjustReason] = useState('');

  const [historyTarget, setHistoryTarget] = useState<Product | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  const filtered = products.filter((p) => {
    if (category !== 'All' && p.category !== category) return false;
    if (showLowStock && p.stock_qty > p.low_stock_threshold) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.barcode.toLowerCase().includes(q);
  });

  const handleAdd = async () => {
    setSaving(true);
    try {
      await api.post('/api/products', {
        name: form.name,
        barcode: form.barcode,
        category: form.category,
        hsn_code: form.hsn_code,
        gst_rate: Number(form.gst_rate),
        cost_price: form.cost_price ? Number(form.cost_price) : null,
        stock_qty: Number(form.stock_qty || 0),
        low_stock_threshold: Number(form.low_stock_threshold || 20),
        is_active: true,
      });
      toast.success(`${form.name} added at ₹${DEFAULT_PRODUCT_PRICE}`);
      setShowAdd(false);
      setForm({
        name: '',
        barcode: '',
        category: 'Others',
        hsn_code: '',
        gst_rate: '12',
        cost_price: '',
        stock_qty: '0',
        low_stock_threshold: '20',
      });
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAdjust = async () => {
    if (!adjustTarget) return;
    const delta = Number(adjustDelta);
    if (!Number.isInteger(delta) || delta === 0) {
      toast.error('Enter a non-zero whole number (use a minus sign to remove stock)');
      return;
    }
    setSaving(true);
    try {
      const result = await api.post<{ before_qty: number; after_qty: number }>(
        '/api/inventory/adjust',
        {
          product_id: adjustTarget.id,
          delta,
          movement_type: adjustType,
          reason: adjustReason,
        }
      );
      toast.success(
        `${adjustTarget.name}: ${result.before_qty} → ${result.after_qty}`
      );
      setAdjustTarget(null);
      setAdjustDelta('');
      setAdjustReason('');
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (product: Product) => {
    setHistoryTarget(product);
    setMovementsLoading(true);
    try {
      const result = await api.get<{ movements: StockMovement[] }>(
        `/api/inventory/movements?product_id=${product.id}&limit=100`
      );
      setMovements(result.movements);
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setMovementsLoading(false);
    }
  };

  const toggleActive = async (product: Product) => {
    try {
      await api.patch(`/api/products/${product.id}`, { is_active: !product.is_active });
      toast.success(`${product.name} ${product.is_active ? 'deactivated' : 'reactivated'}`);
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory Management</h1>
          <p className="text-muted-foreground text-sm">
            {loading ? 'Loading…' : `${filtered.length} of ${products.length} products shown`}
          </p>
        </div>
        {can('product.create') && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" /> Add Product
          </Button>
        )}
      </div>

      {/* Summary — all figures from real queries */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Active SKUs</p>
          <p className="text-2xl font-bold mt-1">{summary?.totalSkus ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Units in Stock</p>
          <p className="text-2xl font-bold mt-1">{summary?.totalUnits ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Retail Value</p>
          <p className="text-2xl font-bold mt-1">
            {summary ? formatINR(summary.retailValue) : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            at ₹{DEFAULT_PRODUCT_PRICE}/unit
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Cost Value</p>
          <p className="text-2xl font-bold mt-1">
            {summary ? formatINR(summary.costValue) : '—'}
          </p>
          {/* Says plainly how much of the catalogue this covers, rather than
              presenting a partial figure as complete. */}
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {summary ? `${summary.costCoverage}% of SKUs have supplier cost` : ''}
          </p>
        </Card>
        <Card className="p-4 border-destructive/20">
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive" /> Low / Out
          </p>
          <p className="text-2xl font-bold mt-1 text-destructive">
            {summary ? `${summary.lowStockCount} / ${summary.outOfStockCount}` : '—'}
          </p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search name or barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={category} onValueChange={(v) => setCategory(v ?? 'All')}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant={showLowStock ? 'destructive' : 'outline'}
          className="gap-1 text-xs h-9"
          onClick={() => setShowLowStock(!showLowStock)}
        >
          <Filter className="w-3 h-3" /> Low stock only
        </Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-sm text-destructive py-16">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">
            No products match these filters.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Barcode</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>HSN</TableHead>
                <TableHead className="text-center">GST</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow
                  key={product.id}
                  className={
                    !product.is_active
                      ? 'opacity-50'
                      : product.stock_qty <= product.low_stock_threshold
                        ? 'bg-destructive/5'
                        : ''
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="font-medium">{product.name}</span>
                      {!product.is_active && (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{product.barcode}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {product.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{product.hsn_code || '—'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="text-xs">
                      {product.gst_rate}%
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatINR(product.price)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {product.cost_price != null ? formatINR(product.cost_price) : '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={
                        product.stock_qty <= 0
                          ? 'destructive'
                          : product.stock_qty <= product.low_stock_threshold
                            ? 'destructive'
                            : 'default'
                      }
                      className="min-w-[3rem]"
                    >
                      {product.stock_qty}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      {can('inventory.adjust') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="Adjust stock"
                          onClick={() => {
                            setAdjustTarget(product);
                            setAdjustDelta('');
                            setAdjustReason('');
                            setAdjustType('MANUAL_ADJUSTMENT');
                          }}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        title="Stock movement history"
                        onClick={() => void openHistory(product)}
                      >
                        <History className="w-3.5 h-3.5" />
                      </Button>
                      {can('product.deactivate') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => void toggleActive(product)}
                        >
                          {product.is_active ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* ─── Add product ─── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
            <DialogDescription>
              The selling price is fixed at ₹{DEFAULT_PRODUCT_PRICE} for every product. Supplier
              cost is separate and is used only for margin reporting.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2">
              <Label htmlFor="p-name">Product name *</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="p-barcode">Barcode *</Label>
              <Input
                id="p-barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="p-category">Category *</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v ?? 'Others' })}
              >
                <SelectTrigger id="p-category" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-hsn">HSN code</Label>
              <Input
                id="p-hsn"
                value={form.hsn_code}
                onChange={(e) => setForm({ ...form, hsn_code: e.target.value })}
                placeholder="4–8 digits"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="p-gst">GST rate *</Label>
              <Select
                value={form.gst_rate}
                onValueChange={(v) => setForm({ ...form, gst_rate: v ?? '12' })}
              >
                <SelectTrigger id="p-gst" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VALID_GST_RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="p-cost">Supplier cost (₹)</Label>
              <Input
                id="p-cost"
                type="number"
                value={form.cost_price}
                onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                placeholder="Leave blank if unknown"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="p-stock">Opening stock</Label>
              <Input
                id="p-stock"
                type="number"
                value={form.stock_qty}
                onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="p-threshold">Low stock threshold</Label>
              <Input
                id="p-threshold"
                type="number"
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                className="mt-1"
              />
            </div>
            <div className="col-span-2 bg-muted/40 rounded-md p-2.5 text-sm flex justify-between">
              <span className="text-muted-foreground">Selling price</span>
              <span className="font-bold">₹{DEFAULT_PRODUCT_PRICE} (fixed)</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleAdd()} disabled={saving || !form.name || !form.barcode}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Stock adjustment ─── */}
      <Dialog open={!!adjustTarget} onOpenChange={() => setAdjustTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              {adjustTarget?.name} — currently {adjustTarget?.stock_qty} in stock. Every
              adjustment is recorded in the stock ledger with your name and reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="adj-delta">Change (+ to add, − to remove) *</Label>
              <Input
                id="adj-delta"
                type="number"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                placeholder="e.g. 50 or -10"
                className="mt-1 text-lg font-bold"
                autoFocus
              />
              {adjustTarget && adjustDelta && Number(adjustDelta) !== 0 && (
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  {Number(adjustDelta) > 0 ? (
                    <ArrowUp className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <ArrowDown className="w-3 h-3 text-destructive" />
                  )}
                  {adjustTarget.stock_qty} → {adjustTarget.stock_qty + Number(adjustDelta)}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="adj-type">Reason type *</Label>
              <Select value={adjustType} onValueChange={(v) => setAdjustType(v ?? 'MANUAL_ADJUSTMENT')}>
                <SelectTrigger id="adj-type" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="adj-reason">Reason *</Label>
              <Input
                id="adj-reason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="What happened?"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleAdjust()}
              disabled={saving || !adjustDelta || adjustReason.trim().length < 3}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Movement history ─── */}
      <Dialog open={!!historyTarget} onOpenChange={() => setHistoryTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Stock History — {historyTarget?.name}</DialogTitle>
            <DialogDescription>
              Complete audit trail of every movement for this product.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {movementsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : movements.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No movements recorded yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Change</TableHead>
                    <TableHead className="text-center">Before → After</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {new Date(m.created_at).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {m.movement_type}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold ${m.quantity > 0 ? 'text-emerald-600' : 'text-destructive'}`}
                      >
                        {m.quantity > 0 ? '+' : ''}
                        {m.quantity}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {m.before_qty} → {m.after_qty}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">
                        {m.reason ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
