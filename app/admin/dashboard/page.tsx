'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatINR } from '@/lib/gst';
import { toast } from 'sonner';
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
  ArrowUpRight,
  Database,
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

const weeklyHeatmap = [
  { day: 'Mon', sales: 12500, intensity: 0.55 },
  { day: 'Tue', sales: 11800, intensity: 0.50 },
  { day: 'Wed', sales: 13200, intensity: 0.60 },
  { day: 'Thu', sales: 18700, intensity: 0.95 },
  { day: 'Fri', sales: 14100, intensity: 0.65 },
  { day: 'Sat', sales: 15500, intensity: 0.75 },
  { day: 'Sun', sales: 17200, intensity: 0.85 },
];

const lowStockItems = [
  { name: 'Ceramic Mug Set', stock: 8, threshold: 20 },
  { name: 'USB Type-C Cable', stock: 15, threshold: 20 },
  { name: 'LED Desk Lamp Mini', stock: 25, threshold: 20 },
];

const recentActivity = [
  { action: 'Shift opened', user: 'Priya', detail: 'Opening cash ₹5,000', time: '1 hr ago' },
  { action: 'Stock updated', user: 'Syed', detail: 'Earbuds +50 units', time: '2 hrs ago' },
];

const isThursday = new Date().getDay() === 4;

export default function DashboardPage() {
  const [topPeriod, setTopPeriod] = useState<'week' | 'month'>('week');
  const [isLoading, setIsLoading] = useState(true);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [isSeeding, setIsSeeding] = useState(false);

  useEffect(() => {
    fetchSalesData();
  }, []);

  const fetchSalesData = async () => {
    try {
      const res = await fetch('/api/sales?period=today');
      const json = await res.json();
      if (json.success) {
        setSalesData(json.data);
      }
    } catch (error) {
      console.error('Failed to fetch sales data', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeedDatabase = async () => {
    setIsSeeding(true);
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        toast.success('Database seeded successfully! Now fetch products on POS page.');
      } else {
        toast.error('Failed to seed: ' + json.error);
      }
    } catch (error) {
      toast.error('Error seeding database.');
    } finally {
      setIsSeeding(false);
    }
  };

  // Calculate KPIs dynamically
  const todayRevenue = salesData.reduce((sum, sale) => sum + sale.grand_total, 0);
  const transactions = salesData.length;
  const itemsSold = salesData.reduce((sum, sale) => sum + (sale.sale_items?.reduce((s: number, item: any) => s + item.qty, 0) || 0), 0);
  const avgBasket = transactions > 0 ? todayRevenue / transactions : 0;

  // Format hourly data dynamically based on sales
  const hourlyDataMap: Record<string, { hour: string; revenue: number; transactions: number }> = {};
  
  // Initialize map for working hours (9 AM - 6 PM)
  for (let i = 9; i <= 18; i++) {
    const ampm = i >= 12 ? 'PM' : 'AM';
    const hourStr = `${i > 12 ? i - 12 : i}${ampm}`;
    hourlyDataMap[hourStr] = { hour: hourStr, revenue: 0, transactions: 0 };
  }

  salesData.forEach(sale => {
    const d = new Date(sale.created_at);
    let h = d.getHours();
    if (h >= 9 && h <= 18) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const hourStr = `${h > 12 ? h - 12 : h}${ampm}`;
      if (hourlyDataMap[hourStr]) {
        hourlyDataMap[hourStr].revenue += sale.grand_total;
        hourlyDataMap[hourStr].transactions += 1;
      }
    }
  });

  const hourlyData = Object.values(hourlyDataMap);

  // Top products calculation
  const productAggs: Record<string, { name: string; qty: number; revenue: number }> = {};
  salesData.forEach(sale => {
    sale.sale_items?.forEach((item: any) => {
      if (!productAggs[item.product_name]) {
        productAggs[item.product_name] = { name: item.product_name, qty: 0, revenue: 0 };
      }
      productAggs[item.product_name].qty += item.qty;
      productAggs[item.product_name].revenue += item.line_total;
    });
  });

  const topProducts = Object.values(productAggs)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);
    
  const maxRevenue = topProducts.length > 0 ? Math.max(...topProducts.map((p) => p.revenue)) : 100;

  return (
    <div className="p-6 space-y-6 max-w-[1600px]">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Welcome back, Syed! Here&apos;s your store overview.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={handleSeedDatabase} disabled={isSeeding}>
            <Database className="w-4 h-4 mr-2" />
            {isSeeding ? 'Seeding...' : 'Seed DB'}
          </Button>
          {isThursday && (
            <Badge className="bg-maxx-gold text-black font-semibold text-sm px-3 py-1 animate-pulse">
              🎯 Shandy Day — Target +25%
            </Badge>
          )}
          <Badge variant="outline" className="text-xs">
            <Clock className="w-3 h-3 mr-1" />
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
          </Badge>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            title: "Today's Revenue",
            value: formatINR(todayRevenue),
            change: 0,
            icon: IndianRupee,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50',
          },
          {
            title: 'Items Sold',
            value: itemsSold.toString(),
            change: 0,
            icon: ShoppingBag,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
          },
          {
            title: 'Transactions',
            value: transactions.toString(),
            change: 0,
            icon: Receipt,
            color: 'text-purple-600',
            bg: 'bg-purple-50',
          },
          {
            title: 'Avg Basket Value',
            value: formatINR(avgBasket),
            change: 0,
            icon: Target,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
          },
        ].map((kpi) => (
          <Card key={kpi.title} className="relative overflow-hidden group hover:shadow-lg transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{kpi.title}</p>
                  <p className="text-2xl font-bold mt-1">{isLoading ? '...' : kpi.value}</p>
                  <div className="flex items-center gap-1 mt-2">
                    {kpi.change >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                    )}
                    <span className={`text-xs font-medium ${kpi.change >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {kpi.change > 0 ? '+' : ''}{kpi.change}% vs yesterday
                    </span>
                  </div>
                </div>
                <div className={`${kpi.bg} p-2.5 rounded-xl`}>
                  <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                </div>
              </div>
            </CardContent>
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/20 to-primary/5 group-hover:from-primary/40 group-hover:to-primary/10 transition-all" />
          </Card>
        ))}
      </div>

      {/* ─── Charts Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Hourly Sales Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hourly Sales Today</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: 12,
                  }}
                  formatter={(value: any) => [formatINR(value as number), 'Revenue']}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="#1B5E20"
                  strokeWidth={3}
                  dot={{ fill: '#1B5E20', r: 4 }}
                  activeDot={{ r: 6, fill: '#E8A000' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Weekly Heatmap */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Weekly Pattern</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {weeklyHeatmap.map((d) => (
                <div key={d.day} className="flex items-center gap-3">
                  <span className="w-8 text-xs font-medium text-muted-foreground">{d.day}</span>
                  <div className="flex-1 h-8 rounded-md relative overflow-hidden bg-muted">
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{
                        width: `${d.intensity * 100}%`,
                        background: d.day === 'Thu'
                          ? 'linear-gradient(90deg, #E8A000, #FFB300)'
                          : d.day === 'Sun'
                            ? 'linear-gradient(90deg, #1B5E20, #4CAF50)'
                            : `rgba(27, 94, 32, ${d.intensity})`,
                      }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium">
                      {formatINR(d.sales)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 text-center">
              🟡 Thursday = Shandy Day  •  🟢 Sunday = Peak
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ─── Bottom Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top 10 Products */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Top 10 Products</CardTitle>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={topPeriod === 'week' ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setTopPeriod('week')}
                >
                  Week
                </Button>
                <Button
                  size="sm"
                  variant={topPeriod === 'month' ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setTopPeriod('month')}
                >
                  Month
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No products sold today.</p>
              ) : topProducts.map((product, i) => (
                <div key={product.name} className="flex items-center gap-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i < 3 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm truncate">{product.name}</p>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {product.qty} sold
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-all"
                        style={{ width: `${(product.revenue / maxRevenue) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm font-semibold shrink-0 w-16 text-right">
                    {formatINR(product.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Alerts + Activity */}
        <div className="space-y-4">
          {/* Low Stock Alerts */}
          <Card className="border-destructive/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                Low Stock Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lowStockItems.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-2 rounded-lg bg-destructive/5 border border-destructive/10"
                >
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-destructive" />
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.stock} / {item.threshold} threshold
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                    <ArrowUpRight className="w-3 h-3" />
                    Reorder
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentActivity.map((activity, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{activity.user}</span>{' '}
                      <span className="text-muted-foreground">{activity.action}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{activity.detail}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{activity.time}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
