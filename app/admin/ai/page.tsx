'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatINR } from '@/lib/gst';
import {
  Brain,
  Send,
  Sparkles,
  TrendingUp,
  Lightbulb,
  AlertTriangle,
  Package,
  Loader2,
  BarChart3,
  MessageSquare,
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
import { toast } from 'sonner';

const forecastData = [
  { day: 'Mon', predicted: 13200, confidence: 85, shandy: false },
  { day: 'Tue', predicted: 12100, confidence: 82, shandy: false },
  { day: 'Wed', predicted: 13800, confidence: 80, shandy: false },
  { day: 'Thu', predicted: 18500, confidence: 90, shandy: true },
  { day: 'Fri', predicted: 14200, confidence: 83, shandy: false },
  { day: 'Sat', predicted: 15800, confidence: 86, shandy: false },
  { day: 'Sun', predicted: 17400, confidence: 88, shandy: false },
];

const staleProducts = [
  { name: 'Hair Clips Combo', days: 45, stock: 120 },
  { name: 'Handkerchief Set (3pc)', days: 38, stock: 50 },
  { name: 'Notebook A5 Pack', days: 32, stock: 90 },
];

export default function AIPage() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai'; content: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<{ title: string; description: string; suggestions: string[] } | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const handleQuery = async () => {
    if (!query.trim()) return;

    const userMessage = query;
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setQuery('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: 'ai', content: data.data?.answer || 'Unable to generate response.' }]);
    } catch {
      setMessages((prev) => [...prev, { role: 'ai', content: 'Sorry, something went wrong.' }]);
    } finally {
      setLoading(false);
    }
  };

  const loadInsights = async () => {
    setInsightLoading(true);
    try {
      const res = await fetch('/api/ai/weekly-insights', { method: 'GET' });
      const data = await res.json();
      if (data.success) {
        // Map the new structure to what the UI currently expects
        // (weekly_insights returns week_summary, opportunities, etc.)
        setInsight({
          title: 'Weekly Performance Review',
          description: data.data.week_summary || data.data.top_insight,
          suggestions: data.data.opportunities || [],
        });
      }
    } catch {
      toast.error('Failed to load insights');
    } finally {
      setInsightLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="w-7 h-7 text-primary" />
            AI Analytics Engine
          </h1>
          <p className="text-muted-foreground text-sm">
            Powered by Groq (llama-3.3-70b) & Anthropic Claude
          </p>
        </div>
        <Button
          variant="outline"
          onClick={loadInsights}
          disabled={insightLoading}
          className="gap-1.5"
        >
          {insightLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Generate Weekly Insights
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── AI Chat Panel ─── */}
        <div className="lg:col-span-2">
          <Card className="h-[600px] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Ask Anything About Your Store
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col p-0">
              {/* Messages */}
              <ScrollArea className="flex-1 px-4">
                {messages.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">Ask me about your sales data</p>
                    <p className="text-sm mt-1">Try: &quot;What were my top products last Thursday?&quot;</p>
                    <div className="flex flex-wrap gap-2 justify-center mt-4">
                      {['Top selling products?', 'Thursday shandy analysis', 'Revenue this week'].map((q) => (
                        <Button
                          key={q}
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() => { setQuery(q); }}
                        >
                          {q}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-4 pb-4">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-primary-foreground rounded-br-md'
                            : 'bg-muted rounded-bl-md'
                        }`}
                      >
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">Thinking...</span>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              {/* Input */}
              <div className="p-4 border-t">
                <div className="flex gap-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask about sales, products, trends..."
                    onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                    disabled={loading}
                  />
                  <Button onClick={handleQuery} disabled={loading || !query.trim()} size="icon">
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── Right Panel ─── */}
        <div className="space-y-6">
          {/* Weekly Insight Card */}
          {insight && (
            <Card className="border-primary/20 fade-in">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-maxx-gold" />
                  Weekly Insight
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <h3 className="font-semibold">{insight.title}</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{insight.description}</p>
                <Separator />
                <div className="space-y-2">
                  {insight.suggestions.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Lightbulb className="w-4 h-4 text-maxx-gold shrink-0 mt-0.5" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 7-Day Forecast */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                7-Day Revenue Forecast
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: any) => [formatINR(value as number), 'Predicted']} />
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    stroke="#1B5E20"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={(props) => {
                      const { cx, cy, payload } = props;
                      return (
                        <circle
                          cx={cx}
                          cy={cy}
                          r={payload.shandy ? 6 : 4}
                          fill={payload.shandy ? '#E8A000' : '#1B5E20'}
                          stroke="white"
                          strokeWidth={2}
                        />
                      );
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted-foreground text-center mt-2">
                🟡 Thursday = Shandy Day forecast (+25%)
              </p>
            </CardContent>
          </Card>

          {/* Stale Products Intelligence */}
          <Card className="border-amber-200/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-500" />
                Inventory Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">
                Products with no sales in 30+ days
              </p>
              <div className="space-y-2">
                {staleProducts.map((p) => (
                  <div key={p.name} className="flex items-center justify-between p-2 rounded-lg bg-amber-50 border border-amber-100">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.days} days • {p.stock} units</p>
                    </div>
                    <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Stale
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
