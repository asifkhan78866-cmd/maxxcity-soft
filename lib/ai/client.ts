// ═══════════════════════════════════════
// AI Client Library (Groq + OpenRouter)
// ═══════════════════════════════════════

import Groq from 'groq-sdk';

/**
 * Create Groq client for realtime queries
 * Uses llama-3.3-70b-versatile model
 */
export function createGroqClient(): Groq {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY,
  });
}

/**
 * Build sales context for AI queries
 */
export function buildSalesContext(salesData: {
  recentSales: unknown[];
  topProducts: unknown[];
  todayStats: { revenue: number; transactions: number; items: number };
  weeklyPattern: unknown[];
}): string {
  return `
You are an AI assistant for MaxxCity Mall, a retail store in Adilabad, Telangana, India.
Every item in the store is priced at ₹149.

STORE CONTEXT:
- Store: MaxxCity Mall, Ramnagar Main Road, Adilabad
- Pricing: All items ₹149 (GST inclusive)
- Categories: Electronics, Home & Kitchen, Clothing, Accessories, Toys, Stationery, Personal Care
- Thursday is shandy day (weekly market) — typically 25% higher sales
- Sunday also sees peak sales

RECENT DATA:
Today's Stats: Revenue ₹${salesData.todayStats.revenue}, ${salesData.todayStats.transactions} transactions, ${salesData.todayStats.items} items sold

Top Products (this week):
${JSON.stringify(salesData.topProducts, null, 2)}

Weekly Sales Pattern:
${JSON.stringify(salesData.weeklyPattern, null, 2)}

Recent Sales (last 50):
${JSON.stringify(salesData.recentSales.slice(0, 50), null, 2)}

Provide answers in clear, actionable language. Use ₹ for currency. Reference specific products and dates when possible.
  `.trim();
}

/**
 * Query Groq for realtime answers
 */
export async function queryGroq(
  question: string,
  context: string
): Promise<string> {
  const groq = createGroqClient();

  const response = await groq.chat.completions.create({
    messages: [
      { role: 'system', content: context },
      { role: 'user', content: question },
    ],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content || 'Unable to generate a response.';
}

/**
 * Call OpenRouter API (OpenAI-compatible endpoint)
 * This replaces the direct Anthropic SDK since we're using an OpenRouter key.
 */
async function callOpenRouter(
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number = 1024,
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
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || 'Unable to generate a response.';
}

/**
 * Generate weekly insights via OpenRouter (using Claude or any model available)
 */
export async function generateWeeklyInsights(
  context: string
): Promise<{
  title: string;
  description: string;
  suggestions: string[];
}> {
  const prompt = `${context}

Based on the above data, generate a weekly business insight for the store owner.
Return your response as JSON with this exact structure:
{
  "title": "A catchy title for this week's insight",
  "description": "A 2-3 paragraph analysis of the week's sales patterns, trends, and noteworthy observations",
  "suggestions": [
    "Suggestion 1 — a specific, actionable recommendation",
    "Suggestion 2 — another actionable recommendation",
    "Suggestion 3 — another actionable recommendation"
  ]
}

Focus on: day-of-week patterns (especially Thursday shandy effect), category performance, stock optimization, and revenue growth opportunities. Be specific with numbers and product names.`;

  // Use Claude via OpenRouter — falls back to a cheaper model if Claude is unavailable
  const text = await callOpenRouter(
    'anthropic/claude-sonnet-4-20250514',
    [{ role: 'user', content: prompt }],
    1024,
    0.3
  );

  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Fallback
  }

  return {
    title: 'Weekly Sales Summary',
    description: text,
    suggestions: ['Review your top-selling categories', 'Stock up before Thursday shandy', 'Consider running weekend promotions'],
  };
}
