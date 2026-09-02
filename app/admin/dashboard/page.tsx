'use client';

// ═══════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════
// Every number on this page comes from /api/reports, which derives it from
// real sales, shift and product rows. There is no seeded heatmap, no invented
// "vs yesterday" percentage and no placeholder activity feed.

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/money';
import { api } from '@/lib/api-client';
import { useAsyncData } from '@/lib/hooks/use-async-data';
import { useSession } from '@/lib/hooks/use-session';
import {
  TrendingUp,
  TrendingDown,
  IndianRupee,
  ShoppingBag,
  Receipt,
  Target,
  Package,
  AlertTriangle,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DashboardData {
  kpis: {
    revenue: number;
    transactions: number;
    itemsSold: number;
    avgBasket: number;
    revenueChange: number;
    transactionsChange: number;
    itemsChange: number;
    basketChange: number;
  };
  hourly: Array<{ hour: number; label: string; revenue: number; transactions: number }>;
  topProducts: Array<{ product_id: string; product_name: string; qty: number; revenue: number }>;
  inventory: {
    totalSkus: number;
    totalUnits: number;
    lowStockCount: number;
    outOfStockCount: number;
    lowStockItems: Array<{
      id: string;
      name: string;
      stock_qty: number;
      low_stock_threshold: number;
    }>;
  };
  weekday: Array<{
    day: string;
    averageRevenue: number;
    sampleDays: number;
    isShandy: boolean;
    isPeak: boolean;
  }>;
}

export default function DashboardPage() {
  const { user } = useSession();
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('today');

  const fetchDashboard = useCallback(
    () => api.get<DashboardData>(`/api/reports?section=dashboard&period=${period}`),
    [period]
  );

  const { data, error, loading, refresh } = useAsyncData(fetchDashboard);

  const isThursday = new Date().getDay() === 4;
  const kpis = data?.kpis;

  const kpiCards = [
    {
      title: 'Revenue',
      value: kpis ? formatINR(kpis.revenue) : '—',
      change: kpis?.revenueChange ?? 0,
      icon: IndianRupee,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      title: 'Items Sold',
      value: kpis ? String(kpis.itemsSold) : '—',
      change: kpis?.itemsChange ?? 0,
      icon: ShoppingBag,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Transactions',
      value: kpis ? String(kpis.transactions) : '—',
      change: kpis?.transactionsChange ?? 0,
      icon: Receipt,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'Avg Basket',
      value: kpis ? formatINR(kpis.avgBasket) : '—',
      change: kpis?.basketChange ?? 0,
      icon: Target,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ];

  const maxWeekday = Math.max(1, ...(data?.weekday ?? []).map((d) => d.averageRevenue));
  const maxProductRevenue = Math.max(1, ...(data?.topProducts ?? []).map((p) => p.revenue));

  return (
    <div className="p-6 space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {user ? `Welcome back, ${user.name}.` : ''} Live store overview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['today', 'week', 'month'] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={period === p ? 'default' : 'ghost'}
                className="h-8 text-xs capitalize"
                onClick={() => setPeriod(p)}
              >
                {p}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          {isThursday && (
            <Badge className="bg-maxx-gold text-black font-semibold text-sm px-3 py-1">
              Shandy Day — expect higher footfall
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            <Clock className="w-3 h-3 mr-1" />
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              day: 'numeric',
              month: 'short',
            })}
          </Badge>
        </div>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-3">
          {error}
        </div>
      )}

      {/* ─── KPIs ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <Card key={kpi.title} className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.title}</p>
                  <p className="text-2xl font-bold mt-1">{loading ? '…' : kpi.value}</p>
                  <div className="flex items-center gap-1 mt-2">
                    {kpi.change >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                    )}
                    <span
                      className={`text-xs font-medium ${kpi.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}
                    >
                      {kpi.change > 0 ? '+' : ''}
                      {kpi.change}% vs previous {period}
                    </span>
                  </div>
                </div>
                <div className={`${kpi.bg} p-2.5 rounded-xl`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
            </CardContent>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/20 to-primary/5" />
          </Card>
        ))}
      </div>

      {/* ─── Charts ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sales by Hour</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-[280px] flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (data?.hourly ?? []).every((h) => h.revenue === 0) ? (
              <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">
                No sales recorded in this period yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data?.hourly ?? []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(value: unknown) => [formatINR(Number(value ?? 0)), 'Revenue']}
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#1B5E20"
                    strokeWidth={3}
                    dot={{ fill: '#1B5E20', r: 3 }}
                    activeDot={{ r: 6, fill: '#E8A000' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Observed weekday pattern — the real average, with its sample size. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Weekday Pattern</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Average revenue observed this month
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.weekday ?? []).map((d) => (
                <div key={d.day} className="flex items-center gap-3">
                  <span className="w-8 text-xs font-medium text-muted-foreground">{d.day}</span>
                  <div className="flex-1 h-8 rounded-md relative overflow-hidden bg-muted">
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{
                        width: `${(d.averageRevenue / maxWeekday) * 100}%`,
                        background: d.isShandy
                          ? 'linear-gradient(90deg, #E8A000, #FFB300)'
                          : d.isPeak
                            ? 'linear-gradient(90deg, #1B5E20, #4CAF50)'
                            : 'rgba(27, 94, 32, 0.45)',
                      }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">
                      {d.sampleDays === 0 ? 'no data' : formatINR(d.averageRevenue)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              Thursday = shandy day · Sunday = peak
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Bottom row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Top Products</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (data?.topProducts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No products sold in this period.
                </p>
              ) : (
                data!.topProducts.map((product, i) => (
                  <div key={product.product_id} className="flex items-center gap-3">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        i < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm truncate">{product.product_name}</p>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {product.qty} sold
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60"
                          style={{ width: `${(product.revenue / maxProductRevenue) * 100}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-semibold shrink-0 w-20 text-right">
                      {formatINR(product.revenue)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-destructive/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Low Stock
              {data && (
                <Badge variant="destructive" className="ml-auto text-[10px]">
                  {data.inventory.lowStockCount}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (data?.inventory.lowStockItems ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                All stock levels are healthy.
              </p>
            ) : (
              data!.inventory.lowStockItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/5 border border-destructive/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="w-4 h-4 text-destructive shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.stock_qty} left · threshold {item.low_stock_threshold}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
