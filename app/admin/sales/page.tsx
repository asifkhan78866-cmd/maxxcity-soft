'use client';

// ═══════════════════════════════════════
// Sales History
// ═══════════════════════════════════════
// Real database rows with filters, pagination, detail, void, return, reprint
// and formal invoice generation.
//
// PRIVACY: the admin sees full product-level detail here — that is the point
// of the internal view. But "Reprint receipt" fetches the SANITIZED receipt
// DTO from /api/sales/[id]/receipt, so a reprinted customer receipt still
// shows only the total product count and the total amount. The itemised
// document is the formal GST invoice, which is a separate action.

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
  Receipt,
  Eye,
  Ban,
  Undo2,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatINR } from '@/lib/money';
import { api, ApiClientError } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';
import { useSession } from '@/lib/hooks/use-session';
import { printCustomerReceipt } from '@/lib/backend/printer';
import { downloadGSTInvoice, type GSTInvoiceData } from '@/lib/backend/invoice';
import type { CustomerReceiptData } from '@/lib/backend/receipt';
import type { Sale, SaleItem } from '@/types';

interface SaleRow extends Sale {
  cashier_name: string;
}

interface SaleDetail extends Sale {
  sale_items: SaleItem[];
  profiles?: { name?: string } | null;
  customers?: { phone?: string; name?: string } | null;
}

const STATUS_VARIANT: Record<string, 'default' | 'destructive' | 'secondary'> = {
  COMPLETED: 'default',
  VOID: 'destructive',
  RETURNED: 'secondary',
  PARTIALLY_RETURNED: 'secondary',
};

export default function SalesPage() {
  const { can } = useSession();

  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState('today');
  const [status, setStatus] = useState('all');
  const [paymentMethod, setPaymentMethod] = useState('all');
  const [invoiceSearch, setInvoiceSearch] = useState('');

  const fetchSales = useCallback(() => {
    const params = new URLSearchParams({ period, page: String(page), page_size: '50' });
    if (status !== 'all') params.set('status', status);
    if (paymentMethod !== 'all') params.set('payment_method', paymentMethod);
    if (invoiceSearch.trim()) params.set('invoice', invoiceSearch.trim());

    return api.get<{
      sales: SaleRow[];
      pagination: { total: number; totalPages: number };
    }>(`/api/sales?${params.toString()}`);
  }, [period, status, paymentMethod, invoiceSearch, page]);

  const { data, error: loadError, loading, refresh } = useAsyncData(fetchSales);
  const sales = useMemo(() => data?.sales ?? [], [data]);
  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;

  /**
   * Any filter change resets to page 1. Done in the handler rather than an
   * effect so the page never fires a throwaway request for page N under the
   * new filter before correcting itself.
   */
  function applyFilter<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [voidTarget, setVoidTarget] = useState<SaleRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);

  const [returnTarget, setReturnTarget] = useState<SaleDetail | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnReason, setReturnReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');

  const openDetail = async (sale: SaleRow, forReturn = false) => {
    setDetailLoading(true);
    try {
      const full = await api.get<SaleDetail>(`/api/sales/${sale.id}`);
      if (forReturn) {
        setReturnTarget(full);
        setReturnQty({});
        setReturnReason('');
      } else {
        setDetail(full);
      }
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setDetailLoading(false);
    }
  };

  /**
   * Reprint the CUSTOMER receipt.
   * The server returns the sanitized DTO — there is no product data in the
   * response, so nothing here could print a product name even by mistake.
   */
  const reprint = async (sale: SaleRow) => {
    try {
      const { receipt } = await api.get<{ receipt: CustomerReceiptData }>(
        `/api/sales/${sale.id}/receipt`
      );
      const result = await printCustomerReceipt(receipt);
      toast[result.ok ? 'success' : 'error'](
        result.ok ? 'Receipt sent to the printer' : (result.error ?? 'Printing failed')
      );
    } catch (error) {
      toast.error((error as ApiClientError).message);
    }
  };

  /** Formal GST tax invoice — a different document, with item-level detail. */
  const generateInvoice = async (sale: SaleRow) => {
    try {
      const data = await api.get<GSTInvoiceData>(`/api/sales/${sale.id}/invoice`);
      downloadGSTInvoice(data);
      toast.success('Tax invoice downloaded');
    } catch (error) {
      toast.error((error as ApiClientError).message);
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setBusy(true);
    try {
      await api.post(`/api/sales/${voidTarget.id}/void`, {
        reason: voidReason,
        restock: true,
      });
      toast.success(`${voidTarget.invoice_number} voided and stock restored`);
      setVoidTarget(null);
      setVoidReason('');
      refresh();
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setBusy(false);
    }
  };

  const handleReturn = async () => {
    if (!returnTarget) return;
    const items = Object.entries(returnQty)
      .filter(([, qty]) => qty > 0)
      .map(([sale_item_id, qty]) => ({ sale_item_id, qty }));

    if (items.length === 0) {
      toast.error('Select at least one item to return');
      return;
    }

    setBusy(true);
    try {
      const result = await api.post<{ return_number: string; refund_amount: number }>(
        '/api/returns',
        {
          sale_id: returnTarget.id,
          items,
          reason: returnReason,
          refund_method: refundMethod,
          restock: true,
        }
      );
      toast.success(
        `${result.return_number} processed — refund ${formatINR(result.refund_amount)}`
      );
      setReturnTarget(null);
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
          <h1 className="text-2xl font-bold">Sales History</h1>
          <p className="text-muted-foreground text-sm">
            {loading ? 'Loading…' : `${total} transaction(s)`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Invoice number…"
            value={invoiceSearch}
            onChange={(e) => applyFilter(setInvoiceSearch)(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={period} onValueChange={(v) => applyFilter(setPeriod)(v ?? 'today')}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="week">Last 7 days</SelectItem>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="quarter">Last 3 months</SelectItem>
            <SelectItem value="year">This year</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => applyFilter(setStatus)(v ?? 'all')}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="VOID">Void</SelectItem>
            <SelectItem value="RETURNED">Returned</SelectItem>
            <SelectItem value="PARTIALLY_RETURNED">Partially returned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={paymentMethod} onValueChange={(v) => applyFilter(setPaymentMethod)(v ?? 'all')}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payments</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="UPI">UPI</SelectItem>
            <SelectItem value="CARD">Card</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <p className="text-center text-sm text-destructive py-16">{loadError}</p>
        ) : sales.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-16">
            No transactions in this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Date &amp; time</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-center">Items</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-center">Payment</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id} className={sale.status === 'VOID' ? 'opacity-60' : ''}>
                  <TableCell className="font-mono text-xs">
                    {sale.invoice_number}
                    {sale.is_offline_origin && (
                      <Badge variant="outline" className="ml-1.5 text-[9px]">
                        offline
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-nowrap">
                    {new Date(sale.created_at).toLocaleString('en-IN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell className="text-sm">{sale.cashier_name}</TableCell>
                  <TableCell className="text-center">{sale.total_items}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatINR(Number(sale.grand_total))}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className="text-xs">
                      {sale.payment_method}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={STATUS_VARIANT[sale.status] ?? 'default'} className="text-xs">
                      {sale.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-center gap-0.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        title="View items"
                        onClick={() => void openDetail(sale)}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        title="Reprint customer receipt (no product names)"
                        onClick={() => void reprint(sale)}
                      >
                        <Receipt className="w-3.5 h-3.5" />
                      </Button>
                      {can('sale.invoice.formal') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="Formal GST tax invoice"
                          onClick={() => void generateInvoice(sale)}
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {can('sale.return') && sale.status !== 'VOID' && sale.status !== 'RETURNED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-amber-600"
                          title="Process return"
                          onClick={() => void openDetail(sale, true)}
                        >
                          <Undo2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {can('sale.void') && sale.status === 'COMPLETED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          title="Void sale"
                          onClick={() => {
                            setVoidTarget(sale);
                            setVoidReason('');
                          }}
                        >
                          <Ban className="w-3.5 h-3.5" />
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

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ─── Detail (internal view — product names ARE shown) ─── */}
      <Dialog open={!!detail} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.invoice_number}</DialogTitle>
            <DialogDescription>
              Internal record. The customer&apos;s receipt for this sale shows only the total
              product count and the total amount.
            </DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Cashier</p>
                  <p className="font-medium">{detail.profiles?.name ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Payment</p>
                  <p className="font-medium">{detail.payment_method}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Customer</p>
                  <p className="font-medium">{detail.customers?.phone ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <p className="font-medium">{detail.status}</p>
                </div>
              </div>

              {detail.void_reason && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm">
                  <span className="font-semibold">Void reason:</span> {detail.void_reason}
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>HSN</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">GST</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.sale_items ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.product_name}
                        {item.qty_returned > 0 && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            {item.qty_returned} returned
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{item.hsn_code || '—'}</TableCell>
                      <TableCell className="text-center">{item.qty}</TableCell>
                      <TableCell className="text-center">{item.gst_rate}%</TableCell>
                      <TableCell className="text-right">
                        {formatINR(Number(item.base_price))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatINR(Number(item.tax_amount))}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatINR(Number(item.line_total))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end">
                <div className="w-64 space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Taxable value</span>
                    <span>{formatINR(Number(detail.subtotal))}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>CGST</span>
                    <span>{formatINR(Number(detail.total_cgst))}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>SGST</span>
                    <span>{formatINR(Number(detail.total_sgst))}</span>
                  </div>
                  {Number(detail.discount) > 0 && (
                    <div className="flex justify-between text-destructive">
                      <span>Discount</span>
                      <span>-{formatINR(Number(detail.discount))}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base pt-1.5 border-t">
                    <span>Total</span>
                    <span>{formatINR(Number(detail.grand_total))}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ─── Void ─── */}
      <Dialog open={!!voidTarget} onOpenChange={() => setVoidTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void {voidTarget?.invoice_number}</DialogTitle>
            <DialogDescription>
              The sale is kept for audit and marked VOID — it is never deleted. Stock is
              returned and the shift totals are corrected.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="void-reason">Reason *</Label>
            <Input
              id="void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Why is this sale being voided?"
              className="mt-1"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleVoid()}
              disabled={busy || voidReason.trim().length < 3}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Void Sale'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Return ─── */}
      <Dialog open={!!returnTarget} onOpenChange={() => setReturnTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Return against {returnTarget?.invoice_number}</DialogTitle>
            <DialogDescription>
              Choose the quantity to return per line. The refund is what was actually
              collected for those units, net of any discount.
            </DialogDescription>
          </DialogHeader>
          {returnTarget && (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-center">Sold</TableHead>
                    <TableHead className="text-center">Already returned</TableHead>
                    <TableHead className="text-center">Return now</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(returnTarget.sale_items ?? []).map((item) => {
                    const remaining = item.qty - item.qty_returned;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-center">{item.qty}</TableCell>
                        <TableCell className="text-center">{item.qty_returned}</TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min={0}
                            max={remaining}
                            disabled={remaining <= 0}
                            value={returnQty[item.id] ?? ''}
                            onChange={(e) => {
                              const v = Math.max(
                                0,
                                Math.min(remaining, Number(e.target.value) || 0)
                              );
                              setReturnQty({ ...returnQty, [item.id]: v });
                            }}
                            className="w-20 mx-auto text-center"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="refund-method">Refund method *</Label>
                  <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v ?? 'CASH')}>
                    <SelectTrigger id="refund-method" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Cash</SelectItem>
                      <SelectItem value="UPI">UPI</SelectItem>
                      <SelectItem value="CARD">Card</SelectItem>
                      <SelectItem value="STORE_CREDIT">Store credit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="return-reason">Reason *</Label>
                  <Input
                    id="return-reason"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    placeholder="Why is it being returned?"
                    className="mt-1"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleReturn()}
              disabled={busy || returnReason.trim().length < 3}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Process Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
