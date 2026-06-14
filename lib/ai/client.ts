// ═══════════════════════════════════════
// AI Client Library (Groq + OpenRouter/Claude)
// ═══════════════════════════════════════

import Groq from 'groq-sdk';
import type { SalesContext } from './context';

// ─── Groq Client ───

export function createGroqClient(): Groq {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// ─── System Prompts ───

const QUERY_SYSTEM_PROMPT = `You are an expert retail analyst for MaxxCity Mall, a 6,000 sq ft variety store in Adilabad, Telangana.
Every product sells at ₹149. The store has 6 departments: Electronics, Kitchen, Fashion, Toys, Stationery, Care.
Thursday has higher footfall (local shandy market day). Sunday is peak day.
You have access to real sales data injected below.
Answer concisely in 2-3 sentences. Format numbers in Indian rupee format (₹).
Always mention actionable next steps.
If a chart would help, include chart_type in your response: "bar", "line", "pie", or null.`;

const WEEKLY_INSIGHTS_PROMPT = `You are a senior retail business consultant analysing weekly performance for MaxxCity Mall, Adilabad.
The store sells everything at ₹149. You have deep knowledge of Indian tier-3 city retail patterns, local festival calendars, and the shandy market effect on Thursdays.
Generate insights that are specific, actionable, and calibrated for a small-city store owner.

Return your response as strict JSON with this exact structure:
{
  "week_summary": "2-3 sentence overview",
  "revenue_vs_target": { "actual": 0, "target": 0, "variance_pct": 0 },
  "top_insight": "Single most important finding",
  "opportunities": ["3 specific actions to take this week"],
  "watch_items": ["2 things to watch or fix"],
  "next_thursday_prep": "Specific Thursday shandy day prep advice",
  "next_sunday_tip": "Specific Sunday peak day tip",
  "inventory_alert": "Most urgent restocking action"
}`;

const INVENTORY_PROMPT = `You are a supply chain analyst for MaxxCity Mall, a ₹149 variety store in Adilabad.
Given the inventory situation below, provide a prioritised restock list and flag dead stock for promotion.
Return strict JSON:
{
  "ai_commentary": "2-3 sentence summary of inventory health",
  "priority_actions": ["top 3 immediate actions"],
  "promotion_suggestions": ["suggestions for slow/dead stock clearance"]
}`;

// ─── Build Context String ───

export function buildQueryContext(ctx: SalesContext): string {
  return `${QUERY_SYSTEM_PROMPT}

═══ LIVE STORE DATA ═══

TODAY (${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}):
Revenue: ₹${ctx.todayStats.revenue.toLocaleString('en-IN')} | Transactions: ${ctx.todayStats.transactions} | Items Sold: ${ctx.todayStats.items}

HOURLY SALES TODAY:
${ctx.todayHourlySales.map(h => `  ${h.hour}:00 → ₹${h.revenue.toLocaleString('en-IN')} (${h.transactions} txns)`).join('\n') || '  No sales yet today'}

THIS WEEK vs LAST WEEK:
  This week: ₹${ctx.thisWeekVsLast.this_week.toLocaleString('en-IN')}
  Last week: ₹${ctx.thisWeekVsLast.last_week.toLocaleString('en-IN')}
  Change: ${ctx.thisWeekVsLast.change_pct > 0 ? '+' : ''}${ctx.thisWeekVsLast.change_pct}%

TOP 20 PRODUCTS (last 30 days):
${ctx.topProducts20.map((p, i) => `  ${i + 1}. ${p.product_name} — ${p.qty_sold} sold (₹${p.revenue.toLocaleString('en-IN')})`).join('\n') || '  No product data'}

LOW STOCK ALERTS:
${ctx.lowStockItems.map(p => `  ⚠️ ${p.name}: ${p.stock_qty} left (threshold: ${p.low_stock_threshold})`).join('\n') || '  All stock levels healthy'}

DAILY SALES (last 30 days):
${ctx.dailySummary30d.slice(-14).map(d => `  ${d.date}: ₹${d.revenue.toLocaleString('en-IN')} (${d.transactions} txns, ${d.items} items)`).join('\n') || '  No historical data'}`;
}

export function buildWeeklyContext(ctx: SalesContext): string {
  return `${WEEKLY_INSIGHTS_PROMPT}

═══ FULL WEEK DATA ═══

DAILY BREAKDOWN (last 7 days):
${ctx.dailySummary30d.slice(-7).map(d => `  ${d.date} (${new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}): ₹${d.revenue.toLocaleString('en-IN')} — ${d.transactions} txns, ${d.items} items`).join('\n') || '  No data for last 7 days'}

TOP PRODUCTS:
${ctx.topProducts20.slice(0, 10).map((p, i) => `  ${i + 1}. ${p.product_name}: ${p.qty_sold} units (₹${p.revenue.toLocaleString('en-IN')})`).join('\n')}

WEEK-OVER-WEEK:
  This week revenue: ₹${ctx.thisWeekVsLast.this_week.toLocaleString('en-IN')}
  Last week revenue: ₹${ctx.thisWeekVsLast.last_week.toLocaleString('en-IN')}
  Change: ${ctx.thisWeekVsLast.change_pct > 0 ? '+' : ''}${ctx.thisWeekVsLast.change_pct}%

INVENTORY ALERTS:
${ctx.lowStockItems.map(p => `  ⚠️ ${p.name}: ${p.stock_qty}/${p.low_stock_threshold}`).join('\n') || '  All stock healthy'}

Target weekly revenue: ₹1,00,000 (based on ₹14,000/day average)`;
}

// ─── Groq Query (Realtime) ───

export async function queryGroq(
  question: string,
  context: string
): Promise<{ answer: string; data: object | null; chart_type: string | null }> {
  const groq = createGroqClient();

  const response = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: context + '\n\nIMPORTANT: If a visual chart would help answer this question, end your response with [CHART:bar], [CHART:line], or [CHART:pie]. Otherwise omit.' },
      { role: 'user', content: question },
    ],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    max_tokens: 1024,
  });

  const raw = response.choices[0]?.message?.content || 'Unable to generate a response.';

  // Extract chart type hint
  const chartMatch = raw.match(/\[CHART:(bar|line|pie)\]/i);
  const chart_type = chartMatch ? chartMatch[1].toLowerCase() : null;
  const answer = raw.replace(/\[CHART:\w+\]/gi, '').trim();

  return { answer, data: null, chart_type };
}

// ─── OpenRouter (Claude via OpenRouter) ───

export async function callOpenRouter(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number = 2048,
  temperature: number = 0.3
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://maxxcitymall.com',
      'X-Title': 'MaxxCity Mall POS',
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─── Weekly Insights (Claude via OpenRouter) ───

export interface WeeklyInsights {
  week_summary: string;
  revenue_vs_target: { actual: number; target: number; variance_pct: number };
  top_insight: string;
  opportunities: string[];
  watch_items: string[];
  next_thursday_prep: string;
  next_sunday_tip: string;
  inventory_alert: string;
}

export async function generateWeeklyInsights(context: string): Promise<WeeklyInsights> {
  const text = await callOpenRouter(
    'anthropic/claude-sonnet-4-20250514',
    [{ role: 'user', content: context }],
    2048,
    0.3
  );

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  return {
    week_summary: text.slice(0, 500),
    revenue_vs_target: { actual: 0, target: 100000, variance_pct: 0 },
    top_insight: 'Unable to parse structured insights. Review raw response.',
    opportunities: ['Review top products', 'Stock up before Thursday', 'Run weekend promotions'],
    watch_items: ['Check low stock items', 'Monitor cash variance'],
    next_thursday_prep: 'Pre-stock Kitchen and Fashion categories',
    next_sunday_tip: 'Ensure all staff scheduled for peak hours',
    inventory_alert: 'Check low stock alerts in inventory panel',
  };
}

// ─── Inventory AI Commentary (Claude via OpenRouter) ───

export async function generateInventoryCommentary(inventoryContext: string): Promise<{
  ai_commentary: string;
  priority_actions: string[];
  promotion_suggestions: string[];
}> {
  const text = await callOpenRouter(
    'anthropic/claude-sonnet-4-20250514',
    [{ role: 'user', content: `${INVENTORY_PROMPT}\n\n${inventoryContext}` }],
    1024,
    0.3
  );

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}

  return {
    ai_commentary: text.slice(0, 300),
    priority_actions: ['Review reorder list', 'Clear dead stock', 'Check lead times'],
    promotion_suggestions: ['Bundle slow movers with bestsellers'],
  };
}

// Legacy re-exports for backward compatibility
export function buildSalesContext(salesData: {
  recentSales: unknown[];
  topProducts: unknown[];
  todayStats: { revenue: number; transactions: number; items: number };
  weeklyPattern: unknown[];
}): string {
  return buildQueryContext({
    dailySummary30d: [],
    topProducts20: (salesData.topProducts as any[]).map(p => ({ product_name: p.product_name, qty_sold: p.qty_sold || 0, revenue: (p.qty_sold || 0) * 149 })),
    lowStockItems: [],
    thisWeekVsLast: { this_week: 0, last_week: 0, change_pct: 0 },
    todayHourlySales: [],
    todayStats: salesData.todayStats,
  });
}
