'use client';

// ═══════════════════════════════════════
// Purchases & Suppliers
// ═══════════════════════════════════════
// Procurement works in SUPPLIER COST, which is a separate figure from the ₹99
// customer selling price. Receiving goods raises stock through the ledger and
// records the cost against the product, which is what makes real margin
// reporting possible.

import { useState, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Truck, PackageCheck, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@/lib/money';
import { api, ApiClientError } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';
import { useSession } from '@/lib/hooks/use-session';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import type { Product, Supplier, PurchaseOrder, PurchaseOrderItem } from '@/types';

interface PORow extends PurchaseOrder {
  purchase_order_items: PurchaseOrderItem[];
  suppliers?: { name?: string } | null;
}

interface DraftLine {
  product_id: string;
  qty_ordered: string;
  unit_cost: string;
}

const PO_STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  DRAFT: 'secondary',
  ORDERED: 'default',
  RECEIVED: 'secondary',
  CANCELLED: 'destructive',
};

export default function PurchasesPage() {
  const { can } = useSession();

  const fetchProcurement = useCallback(async () => {
    const [orders, suppliers, products] = await Promise.all([
      api.get<PORow[]>('/api/purchase-orders'),
      api.get<Supplier[]>('/api/suppliers'),
      api.get<Product[]>('/api/products'),
    ]);
    return { orders, suppliers, products };
  }, []);

  const { data, error: loadError, loading, refresh } = useAsyncData(fetchProcurement);
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const suppliers = useMemo(() => data?.suppliers ?? [], [data]);
  const products = useMemo(() => data?.products ?? [], [data]);

  const [busy, setBusy] = useState(false);

  const [showCreatePO, setShowCreatePO] = useState(false);
  const [poSupplier, setPoSupplier] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ product_id: '', qty_ordered: '', unit_cost: '' }]);

  const [showSupplier, setShowSupplier] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_person: '', phone: '' });

  const [receiveTarget, setReceiveTarget] = useState<PORow | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});

  const draftTotal = lines.reduce(
    (sum, l) => sum + (Number(l.qty_ordered) || 0) * (Number(l.unit_cost) || 0),
    0
  );

  const createPO = async () => {
    const items = lines
      .filter((l) => l.product_id && Number(l.qty_ordered) > 0)
      .map((l) => ({
        product_id: l.product_id,
        qty_ordered: Number(l.qty_ordered),
        unit_cost: Number(l.unit_cost) || 0,
      }));

    if (!poSupplier || items.length === 0) {
      toast.error('Choose a supplier and add at least one line');
      return;
    }

    setBusy(true);
    try {
      await api.post('/api/purchase-orders', {
        supplier_id: poSupplier,
        items,
        notes: poNotes || null,
      });
      toast.success('Purchase order created');
      setShowCreatePO(false);
      setLines([{ product_id: '', qty_ordered: '', unit_cost: '' }]);
      setPoSupplier('');
      setPoNotes('');
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const createSupplier = async () => {
    setBusy(true);
    try {
      await api.post('/api/suppliers', {
        name: supplierForm.name,
        contact_person: supplierForm.contact_person || null,
        phone: supplierForm.phone || null,
      });
      toast.success('Supplier added');
      setShowSupplier(false);
      setSupplierForm({ name: '', contact_person: '', phone: '' });
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const receiveGoods = async () => {
    if (!receiveTarget) return;
    const items = Object.entries(receiveQty)
      .filter(([, qty]) => qty > 0)
      .map(([po_item_id, qty_received]) => ({ po_item_id, qty_received }));

    if (items.length === 0) {
      toast.error('Enter the quantities received');
      return;
    }

    setBusy(true);
    try {
      const result = await api.post<{ units_received: number; fully_received: boolean }>(
        `/api/purchase-orders/${receiveTarget.id}/receive`,
        { items }
      );
      toast.success(
        `${result.units_received} unit(s) received into stock${result.fully_received ? ' — order complete' : ''}`
      );
      setReceiveTarget(null);
      setReceiveQty({});
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchases &amp; Suppliers</h1>
          <p className="text-muted-foreground text-sm">
            Purchase cost is separate from the ₹{DEFAULT_PRODUCT_PRICE} selling price
          </p>
        </div>
        {can('purchase.manage') && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowSupplier(true)}>
              <Plus className="w-4 h-4" /> Supplier
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreatePO(true)}>
              <Plus className="w-4 h-4" /> Purchase Order
            </Button>
          </div>
        )}
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders" className="gap-1.5">
            <Truck className="w-4 h-4" /> Purchase Orders
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="gap-1.5">
            <PackageCheck className="w-4 h-4" /> Suppliers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders" className="mt-4">
          <Card>
            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <p className="text-center text-sm text-destructive py-16">{loadError}</p>
            ) : orders.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                No purchase orders yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>PO Number</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-center">Lines</TableHead>
                    <TableHead className="text-center">Ordered / Received</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((po) => {
                    const ordered = (po.purchase_order_items ?? []).reduce(
                      (s, i) => s + i.qty_ordered,
                      0
                    );
                    const received = (po.purchase_order_items ?? []).reduce(
                      (s, i) => s + i.qty_received,
                      0
                    );
                    return (
                      <TableRow key={po.id}>
                        <TableCell className="font-mono text-xs">{po.po_number ?? '—'}</TableCell>
                        <TableCell>{po.suppliers?.name ?? '—'}</TableCell>
                        <TableCell className="text-center">
                          {(po.purchase_order_items ?? []).length}
                        </TableCell>
                        <TableCell className="text-center">
                          {received} / {ordered}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatINR(Number(po.total_cost))}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={PO_STATUS_VARIANT[po.status] ?? 'default'} className="text-xs">
                            {po.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(po.created_at).toLocaleDateString('en-IN')}
                        </TableCell>
                        <TableCell className="text-center">
                          {can('purchase.receive') && po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => {
                                setReceiveTarget(po);
                                setReceiveQty({});
                              }}
                            >
                              Receive
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <Card>
            {suppliers.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                No suppliers recorded yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>GSTIN</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.contact_person ?? '—'}</TableCell>
                      <TableCell>{s.phone ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{s.gstin ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* ─── Create PO ─── */}
      <Dialog open={showCreatePO} onOpenChange={setShowCreatePO}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>
              Enter what you pay the supplier per unit. This cost is stored separately from the
              ₹{DEFAULT_PRODUCT_PRICE} you charge the customer and drives the margin report.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="po-supplier">Supplier *</Label>
                <Select value={poSupplier} onValueChange={(v) => setPoSupplier(v ?? '')}>
                  <SelectTrigger id="po-supplier" className="mt-1">
                    <SelectValue placeholder="Choose a supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="po-notes">Notes</Label>
                <Input
                  id="po-notes"
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto">
              {lines.map((line, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_120px_40px] gap-2 items-end">
                  <div>
                    {idx === 0 && <Label className="text-xs">Product</Label>}
                    <Select
                      value={line.product_id}
                      onValueChange={(v) => {
                        const next = [...lines];
                        next[idx] = { ...next[idx], product_id: v ?? '' };
                        // Pre-fill with the last known cost for this product.
                        const product = products.find((p) => p.id === v);
                        if (product?.cost_price != null && !next[idx].unit_cost) {
                          next[idx].unit_cost = String(product.cost_price);
                        }
                        setLines(next);
                      }}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Choose a product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    {idx === 0 && <Label className="text-xs">Qty</Label>}
                    <Input
                      type="number"
                      min={1}
                      value={line.qty_ordered}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...next[idx], qty_ordered: e.target.value };
                        setLines(next);
                      }}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    {idx === 0 && <Label className="text-xs">Unit cost (₹)</Label>}
                    <Input
                      type="number"
                      value={line.unit_cost}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx] = { ...next[idx], unit_cost: e.target.value };
                        setLines(next);
                      }}
                      className="mt-1"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive mb-0.5"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLines([...lines, { product_id: '', qty_ordered: '', unit_cost: '' }])}
              >
                <Plus className="w-4 h-4 mr-1" /> Add line
              </Button>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Total at cost</p>
                <p className="text-xl font-bold">{formatINR(draftTotal)}</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreatePO(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createPO()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Add supplier ─── */}
      <Dialog open={showSupplier} onOpenChange={setShowSupplier}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="sup-name">Name *</Label>
              <Input
                id="sup-name"
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="sup-contact">Contact person</Label>
              <Input
                id="sup-contact"
                value={supplierForm.contact_person}
                onChange={(e) =>
                  setSupplierForm({ ...supplierForm, contact_person: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="sup-phone">Phone</Label>
              <Input
                id="sup-phone"
                value={supplierForm.phone}
                onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSupplier(false)}>
              Cancel
            </Button>
            <Button onClick={() => void createSupplier()} disabled={busy || !supplierForm.name}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Receive goods ─── */}
      <Dialog open={!!receiveTarget} onOpenChange={() => setReceiveTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receive against {receiveTarget?.po_number}</DialogTitle>
            <DialogDescription>
              Stock is raised through the ledger and the supplier cost is recorded on each
              product.
            </DialogDescription>
          </DialogHeader>
          {receiveTarget && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-center">Ordered</TableHead>
                  <TableHead className="text-center">Already received</TableHead>
                  <TableHead className="text-right">Unit cost</TableHead>
                  <TableHead className="text-center">Receiving now</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receiveTarget.purchase_order_items ?? []).map((item) => {
                  const outstanding = item.qty_ordered - item.qty_received;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell className="text-center">{item.qty_ordered}</TableCell>
                      <TableCell className="text-center">{item.qty_received}</TableCell>
                      <TableCell className="text-right">
                        {formatINR(Number(item.unit_cost))}
                      </TableCell>
                      <TableCell className="text-center">
                        <Input
                          type="number"
                          min={0}
                          max={outstanding}
                          disabled={outstanding <= 0}
                          value={receiveQty[item.id] ?? ''}
                          onChange={(e) =>
                            setReceiveQty({
                              ...receiveQty,
                              [item.id]: Math.max(
                                0,
                                Math.min(outstanding, Number(e.target.value) || 0)
                              ),
                            })
                          }
                          className="w-24 mx-auto text-center"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void receiveGoods()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Receive into Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
