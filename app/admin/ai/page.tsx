'use client';

// ═══════════════════════════════════════
// AI Insights
// ═══════════════════════════════════════
// Everything here is driven by real store data. When a feature is not
// configured (no API key) or there is nothing to analyse, the page says so
// rather than showing invented numbers.
//
// The forecast labels every day with the basis it was produced from —
// observed, estimated or assumed — so an estimate is never mistaken for a
// measurement.

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatINR } from '@/lib/money';
import { DEFAULT_PRODUCT_PRICE } from '@/lib/config/pricing';
import { api, ApiClientError } from '@/lib/api-client';
import {
  Brain,
  Send,
  Sparkles,
  TrendingUp,
  Lightbulb,
  AlertTriangle,
  Package,
  Loader2,
  MessageSquare,
  Info,
} from 'lucide-react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
} from 'recharts';
import { toast } from 'sonner';

interface ForecastDay {
  date: string;
  day_name: string;
  predicted_revenue: number;
  confidence_low: number;
  confidence_high: number;
  basis: 'observed' | 'estimated' | 'assumed';
  sample_days: number;
  is_shandy: boolean;
  is_peak: boolean;
  festival_boost: string | null;
}

interface InventoryRecommendation {
  product_id: string;
  name: string;
  category: string;
  velocity: number;
  days_of_stock: number;
  status: 'REORDER_NOW' | 'REORDER_SOON' | 'SLOW_MOVER' | 'DEAD_STOCK' | 'HEALTHY';
  current_stock: number;
}

interface WeeklyInsights {
  week_summary: string;
  top_insight: string;
  opportunities: string[];
  watch_items: string[];
  next_thursday_prep: string;
  next_sunday_tip: string;
  inventory_alert: string;
  basedOnDays: number;
}

const BASIS_BADGE: Record<ForecastDay['basis'], { label: string; className: string }> = {
  observed: { label: 'Observed', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  estimated: { label: 'Estimated', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  assumed: { label: 'Assumed', className: 'bg-muted text-muted-foreground' },
};

const STATUS_COLOR: Record<InventoryRecommendation['status'], string> = {
  REORDER_NOW: 'bg-destructive/10 text-destructive border-destructive/20',
  REORDER_SOON: 'bg-amber-100 text-amber-800 border-amber-200',
  SLOW_MOVER: 'bg-blue-100 text-blue-800 border-blue-200',
  DEAD_STOCK: 'bg-muted text-muted-foreground',
  HEALTHY: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export default function AIPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const [forecast, setForecast] = useState<ForecastDay[] | null>(null);
  const [forecastNote, setForecastNote] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);

  const [insights, setInsights] = useState<WeeklyInsights | null>(null);
  const [insightsError, setInsightsError] = useState('');
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [recommendations, setRecommendations] = useState<InventoryRecommendation[] | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [inventoryNote, setInventoryNote] = useState('');
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const askQuestion = useCallback(async () => {
    if (!query.trim()) return;
    const question = query;
    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setQuery('');
    setChatLoading(true);

    try {
      const result = await api.post<{ answer: string }>('/api/ai/query', { question });
      setMessages((prev) => [...prev, { role: 'ai', content: result.answer }]);
    } catch (error) {
      const err = error as ApiClientError;
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content:
            err.code === 'AI_NOT_CONFIGURED'
              ? 'The AI assistant is not configured on this deployment. Ask an administrator to add GROQ_API_KEY.'
              : `Could not answer that: ${err.message}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [query]);

  const loadForecast = useCallback(async () => {
    setForecastLoading(true);
    try {
      const result = await api.get<{ forecast: ForecastDay[]; disclaimer: string }>(
        '/api/ai/forecast'
      );
      setForecast(result.forecast);
      setForecastNote(result.disclaimer);
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setForecastLoading(false);
    }
  }, []);

  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    setInsightsError('');
    try {
      setInsights(await api.get<WeeklyInsights>('/api/ai/weekly-insights'));
    } catch (error) {
      const err = error as ApiClientError;
      setInsights(null);
      setInsightsError(err.message);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  const loadInventory = useCallback(async () => {
    setInventoryLoading(true);
    try {
      const result = await api.get<{
        recommendations: InventoryRecommendation[];
        ai_commentary: string | null;
        note?: string;
      }>('/api/ai/inventory-recommendations');
      setRecommendations(result.recommendations);
      setCommentary(result.ai_commentary);
      setInventoryNote(result.note ?? '');
    } catch (error) {
      toast.error((error as ApiClientError).message);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-[1500px]">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Brain className="w-6 h-6 text-primary" /> AI Insights
        </h1>
        <p className="text-muted-foreground text-sm">
          Analysis of real MaxxCity data — flat ₹{DEFAULT_PRODUCT_PRICE} selling price, Thursday
          shandy, Sunday peak
        </p>
      </div>

      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat" className="gap-1.5">
            <MessageSquare className="w-4 h-4" /> Ask
          </TabsTrigger>
          <TabsTrigger value="forecast" className="gap-1.5" onClick={() => void loadForecast()}>
            <TrendingUp className="w-4 h-4" /> Forecast
          </TabsTrigger>
          <TabsTrigger value="weekly" className="gap-1.5" onClick={() => void loadInsights()}>
            <Sparkles className="w-4 h-4" /> Weekly Review
          </TabsTrigger>
          <TabsTrigger value="inventory" className="gap-1.5" onClick={() => void loadInventory()}>
            <Package className="w-4 h-4" /> Inventory
          </TabsTrigger>
        </TabsList>

        {/* ─── Chat ─── */}
        <TabsContent value="chat" className="mt-4">
          <Card className="flex flex-col h-[600px]">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ask about your store</CardTitle>
            </CardHeader>
            <ScrollArea className="flex-1 px-6">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
                  <Lightbulb className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm max-w-sm">
                    Ask anything about sales, stock or trading patterns. Answers are grounded in
                    your actual transaction data.
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {[
                      'What sold best this week?',
                      'How did Thursday compare to other days?',
                      'What should I restock first?',
                    ].map((q) => (
                      <Button
                        key={q}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => setQuery(q)}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-4 py-2">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${
                          m.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted'
                        }`}
                      >
                        {m.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg px-4 py-2.5">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
            <CardContent className="pt-3 border-t">
              <div className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !chatLoading) void askQuestion();
                  }}
                  placeholder="Ask a question…"
                  disabled={chatLoading}
                />
                <Button onClick={() => void askQuestion()} disabled={chatLoading || !query.trim()}>
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Forecast ─── */}
        <TabsContent value="forecast" className="mt-4 space-y-4">
          {forecastNote && (
            <div className="flex items-start gap-2 text-sm bg-muted/40 border rounded-md p-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">{forecastNote}</p>
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">14-Day Revenue Forecast</CardTitle>
            </CardHeader>
            <CardContent>
              {forecastLoading ? (
                <div className="h-[320px] flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !forecast ? (
                <div className="h-[320px] flex items-center justify-center">
                  <Button onClick={() => void loadForecast()}>Generate forecast</Button>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d: string) =>
                        new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })
                      }
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => [
                        formatINR(Number(value ?? 0)),
                        String(name ?? ''),
                      ]}
                    />
                    <Area
                      dataKey="confidence_high"
                      stroke="none"
                      fill="#1B5E20"
                      fillOpacity={0.08}
                      name="Upper estimate"
                    />
                    <Line
                      type="monotone"
                      dataKey="predicted_revenue"
                      stroke="#1B5E20"
                      strokeWidth={3}
                      dot={{ r: 3 }}
                      name="Predicted"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {forecast && (
            <Card>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
                  {forecast.slice(0, 7).map((day) => (
                    <div
                      key={day.date}
                      className={`p-3 rounded-lg border text-center ${
                        day.is_shandy
                          ? 'border-maxx-gold/40 bg-maxx-gold/5'
                          : day.is_peak
                            ? 'border-primary/30 bg-primary/5'
                            : ''
                      }`}
                    >
                      <p className="text-xs text-muted-foreground">{day.day_name.slice(0, 3)}</p>
                      <p className="font-bold text-sm mt-1">
                        {formatINR(day.predicted_revenue)}
                      </p>
                      {/* The basis is always visible — never a bare number. */}
                      <Badge
                        variant="outline"
                        className={`text-[9px] mt-1.5 ${BASIS_BADGE[day.basis].className}`}
                      >
                        {BASIS_BADGE[day.basis].label}
                      </Badge>
                      {day.festival_boost && (
                        <p className="text-[9px] text-maxx-gold mt-1">{day.festival_boost}</p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Weekly review ─── */}
        <TabsContent value="weekly" className="mt-4">
          {insightsLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : insightsError ? (
            <Card className="p-8 text-center">
              <AlertTriangle className="w-8 h-8 mx-auto text-amber-600 mb-3" />
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{insightsError}</p>
            </Card>
          ) : !insights ? (
            <Card className="p-12 text-center">
              <Button onClick={() => void loadInsights()}>Generate weekly review</Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">This Week</CardTitle>
                  <p className="text-[11px] text-muted-foreground">
                    Based on {insights.basedOnDays} day(s) of recorded sales
                  </p>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{insights.week_summary}</p>
                  <p className="text-sm font-medium mt-3 text-primary">{insights.top_insight}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" /> Opportunities
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {insights.opportunities.map((o, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-primary">•</span> {o}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-destructive" /> Watch
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm">
                    {insights.watch_items.map((w, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-destructive">•</span> {w}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-maxx-gold/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Thursday (Shandy) Prep</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{insights.next_thursday_prep}</p>
                </CardContent>
              </Card>

              <Card className="border-primary/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Sunday (Peak) Tip</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{insights.next_sunday_tip}</p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ─── Inventory ─── */}
        <TabsContent value="inventory" className="mt-4 space-y-4">
          {inventoryNote && (
            <div className="flex items-start gap-2 text-sm bg-muted/40 border rounded-md p-3">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">{inventoryNote}</p>
            </div>
          )}

          {commentary && (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm">{commentary}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Restock Priorities</CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Recommendations only — nothing is ordered automatically.
              </p>
            </CardHeader>
            <CardContent>
              {inventoryLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : !recommendations ? (
                <div className="flex justify-center py-12">
                  <Button onClick={() => void loadInventory()}>Analyse inventory</Button>
                </div>
              ) : recommendations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No products to analyse yet.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[520px] overflow-y-auto">
                  {recommendations.slice(0, 60).map((r) => (
                    <div
                      key={r.product_id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-lg border"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.current_stock} in stock · {r.velocity}/day ·{' '}
                          {r.days_of_stock >= 999 ? 'no recent sales' : `${r.days_of_stock} days left`}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${STATUS_COLOR[r.status]}`}>
                        {r.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
