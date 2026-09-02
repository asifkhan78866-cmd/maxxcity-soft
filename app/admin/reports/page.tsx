'use client';

// ═══════════════════════════════════════
// Reports & Analytics
// ═══════════════════════════════════════
// All sections are queried live from the database. Where a figure cannot be
// computed honestly — gross margin without supplier costs — the page says so
// rather than substituting an estimate.

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Download, BarChart3, PieChart as PieIcon, Loader2, Info } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { toast } from 'sonner';
import { formatINR } from '@/lib/money';
import { api } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';

interface FullReport {
  meta: { period: string; from: string; to: string };
  kpis: { revenue: number; transactions: number; itemsSold: number; avgBasket: number };
  categories: Array<{ category: string; revenue: number; qty: number }>;
  payments: Array<{ method: string; amount: number; count: number; percentage: number }>;
  gst: Array<{
    rate: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    totalTax: number;
  }>;
  cashiers: Array<{
    cashierId: string;
    cashierName: string;
    transactions: number;
    itemsSold: number;
    revenue: number;
    avgBasket: number;
    cashSales: number;
    upiSales: number;
    cardSales: number;
    voids: number;
    returns: number;
    shiftVariance: number;
    shiftsWorked: number;
  }>;
  margin: {
    revenueTotal: number;
    revenueWithCost: number;
    costOfGoods: number;
    grossMargin: number;
    grossMarginPct: number | null;
    coveragePct: number;
    isComplete: boolean;
  };
  voids: {
    voidCount: number;
    voidValue: number;
    returnCount: number;
    refundValue: number;
  };
}

const PAYMENT_COLORS: Record<string, string> = {
  CASH: '#1B5E20',
  UPI: '#E8A000',
  CARD: '#2196F3',
};

export default function ReportsPage() {
  const [period, setPeriod] = useState('month');

  const fetchReport = useCallback(
    () => api.get<FullReport>(`/api/reports?section=full&period=${period}`),
    [period]
  );

  const { data: report, error, loading } = useAsyncData(fetchReport);

  /** Client-side CSV export of the figures currently on screen. */
  const exportCsv = () => {
    if (!report) return;
    const lines: string[] = [];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

    lines.push(`MaxxCity Mall — Report (${report.meta.from} to ${report.meta.to})`);
    lines.push('');
    lines.push('Summary');
    lines.push('Metric,Value');
    lines.push(`Revenue,${report.kpis.revenue}`);
    lines.push(`Transactions,${report.kpis.transactions}`);
    lines.push(`Items sold,${report.kpis.itemsSold}`);
    lines.push(`Average basket,${report.kpis.avgBasket}`);
    lines.push('');
    lines.push('Revenue by category');
    lines.push('Category,Revenue,Units');
    report.categories.forEach((c) => lines.push(`${esc(c.category)},${c.revenue},${c.qty}`));
    lines.push('');
    lines.push('GST summary');
    lines.push('Rate,Taxable value,CGST,SGST,Total tax');
    report.gst.forEach((g) =>
      lines.push(`${g.rate}%,${g.taxableValue},${g.cgst},${g.sgst},${g.totalTax}`)
    );
    lines.push('');
    lines.push('Cashier performance');
    lines.push('Cashier,Transactions,Items,Revenue,Avg basket,Cash,UPI,Card,Voids,Returns,Shift variance');
    report.cashiers.forEach((c) =>
      lines.push(
        [
          esc(c.cashierName),
          c.transactions,
          c.itemsSold,
          c.revenue,
          c.avgBasket,
          c.cashSales,
          c.upiSales,
          c.cardSales,
          c.voids,
          c.returns,
          c.shiftVariance,
        ].join(',')
      )
    );

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maxxcity-report-${report.meta.from.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  if (loading) {
    return (
      <div className="p-6 flex justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-4">
          {error}
        </div>
      </div>
    );
  }

  const gstTotals = (report?.gst ?? []).reduce(
    (acc, g) => ({
      taxable: acc.taxable + g.taxableValue,
      cgst: acc.cgst + g.cgst,
      sgst: acc.sgst + g.sgst,
      total: acc.total + g.totalTax,
    }),
    { taxable: 0, cgst: 0, sgst: 0, total: 0 }
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Reports &amp; Analytics</h1>
          <p className="text-muted-foreground text-sm">
            {report
              ? `${new Date(report.meta.from).toLocaleDateString('en-IN')} – ${new Date(report.meta.to).toLocaleDateString('en-IN')}`
              : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v ?? 'month')}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="quarter">Last 3 months</SelectItem>
              <SelectItem value="year">This year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
        </div>
      </div>

      {/* ─── Headline ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Revenue</p>
          <p className="text-2xl font-bold mt-1">{formatINR(report?.kpis.revenue ?? 0)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Transactions</p>
          <p className="text-2xl font-bold mt-1">{report?.kpis.transactions ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Items Sold</p>
          <p className="text-2xl font-bold mt-1">{report?.kpis.itemsSold ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Average Basket</p>
          <p className="text-2xl font-bold mt-1">{formatINR(report?.kpis.avgBasket ?? 0)}</p>
        </Card>
      </div>

      {/* ─── Margin ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Gross Margin</CardTitle>
        </CardHeader>
        <CardContent>
          {report && report.margin.coveragePct === 0 ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/40 rounded-md p-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <p>
                No supplier costs have been recorded yet, so margin cannot be calculated. Add a
                cost price to products (or receive stock against a purchase order) and this will
                populate automatically. Margin is ₹99 minus actual purchase cost — it is never
                estimated here.
              </p>
            </div>
          ) : (
            report && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Revenue (with known cost)</p>
                    <p className="text-lg font-bold">{formatINR(report.margin.revenueWithCost)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cost of goods</p>
                    <p className="text-lg font-bold">{formatINR(report.margin.costOfGoods)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Gross margin</p>
                    <p className="text-lg font-bold text-primary">
                      {formatINR(report.margin.grossMargin)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Margin %</p>
                    <p className="text-lg font-bold">
                      {report.margin.grossMarginPct != null
                        ? `${report.margin.grossMarginPct}%`
                        : '—'}
                    </p>
                  </div>
                </div>
                {!report.margin.isComplete && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                    Covers {report.margin.coveragePct}% of revenue in this period — the rest is
                    from products with no recorded supplier cost and is excluded rather than
                    guessed.
                  </p>
                )}
              </div>
            )
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── Category ─── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Revenue by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(report?.categories ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-16">
                No sales in this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={report!.categories} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`}
                  />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip
                    formatter={(value: unknown) => [formatINR(Number(value ?? 0)), 'Revenue']}
                  />
                  <Bar dataKey="revenue" fill="#1B5E20" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ─── Payments ─── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieIcon className="w-4 h-4" /> Payment Methods
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(report?.payments ?? []).every((p) => p.amount === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-16">
                No payments in this period.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={(report?.payments ?? []).filter((p) => p.amount > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="amount"
                    nameKey="method"
                    label={(entry) =>
                      `${(entry as unknown as { method: string; percentage: number }).method}: ${(entry as unknown as { percentage: number }).percentage}%`
                    }
                  >
                    {(report?.payments ?? []).map((entry) => (
                      <Cell key={entry.method} fill={PAYMENT_COLORS[entry.method] ?? '#888'} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip
                    formatter={(value: unknown) => formatINR(Number(value ?? 0))}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ─── GST ─── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GST Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {(report?.gst ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">
                No taxable sales in this period.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rate</TableHead>
                    <TableHead className="text-right">Taxable value</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">Total tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report!.gst.map((row) => (
                    <TableRow key={row.rate}>
                      <TableCell className="font-medium">{row.rate}%</TableCell>
                      <TableCell className="text-right">{formatINR(row.taxableValue)}</TableCell>
                      <TableCell className="text-right">{formatINR(row.cgst)}</TableCell>
                      <TableCell className="text-right">{formatINR(row.sgst)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatINR(row.totalTax)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-muted/50">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{formatINR(gstTotals.taxable)}</TableCell>
                    <TableCell className="text-right">{formatINR(gstTotals.cgst)}</TableCell>
                    <TableCell className="text-right">{formatINR(gstTotals.sgst)}</TableCell>
                    <TableCell className="text-right">{formatINR(gstTotals.total)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* ─── Voids & returns ─── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Voids &amp; Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/10">
                <p className="text-sm text-muted-foreground">Voided sales</p>
                <p className="text-2xl font-bold text-destructive mt-1">
                  {report?.voids.voidCount ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatINR(report?.voids.voidValue ?? 0)} reversed
                </p>
              </div>
              <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm text-muted-foreground">Returns</p>
                <p className="text-2xl font-bold text-amber-700 mt-1">
                  {report?.voids.returnCount ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatINR(report?.voids.refundValue ?? 0)} refunded
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Cashier performance ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cashier Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {(report?.cashiers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              No cashier activity in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-center">Shifts</TableHead>
                  <TableHead className="text-center">Txns</TableHead>
                  <TableHead className="text-center">Items</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg basket</TableHead>
                  <TableHead className="text-right">Cash</TableHead>
                  <TableHead className="text-right">UPI</TableHead>
                  <TableHead className="text-right">Card</TableHead>
                  <TableHead className="text-center">Voids</TableHead>
                  <TableHead className="text-center">Returns</TableHead>
                  <TableHead className="text-right">Shift variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report!.cashiers.map((c) => (
                  <TableRow key={c.cashierId}>
                    <TableCell className="font-medium">{c.cashierName}</TableCell>
                    <TableCell className="text-center">{c.shiftsWorked}</TableCell>
                    <TableCell className="text-center">{c.transactions}</TableCell>
                    <TableCell className="text-center">{c.itemsSold}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatINR(c.revenue)}
                    </TableCell>
                    <TableCell className="text-right">{formatINR(c.avgBasket)}</TableCell>
                    <TableCell className="text-right text-sm">{formatINR(c.cashSales)}</TableCell>
                    <TableCell className="text-right text-sm">{formatINR(c.upiSales)}</TableCell>
                    <TableCell className="text-right text-sm">{formatINR(c.cardSales)}</TableCell>
                    <TableCell className="text-center">
                      {c.voids > 0 ? (
                        <Badge variant="destructive" className="text-[10px]">
                          {c.voids}
                        </Badge>
                      ) : (
                        '0'
                      )}
                    </TableCell>
                    <TableCell className="text-center">{c.returns}</TableCell>
                    <TableCell
                      className={`text-right font-medium ${
                        Math.abs(c.shiftVariance) > 50 ? 'text-destructive' : 'text-emerald-600'
                      }`}
                    >
                      {c.shiftVariance >= 0 ? '+' : ''}
                      {formatINR(c.shiftVariance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
