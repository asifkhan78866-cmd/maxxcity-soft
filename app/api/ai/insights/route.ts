// ═══════════════════════════════════════
// AI Insights API (Claude — Deep Analytics)
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';

export async function POST() {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      // Demo insights
      return NextResponse.json({
        success: true,
        data: {
          title: '📈 Week 23 Performance: Strong Thursday Rebound',
          description: `This week showed a healthy **12% revenue increase** compared to last week, primarily driven by an exceptional Thursday shandy performance (+₹4,200 vs average Thursday).\n\nElectronics category continues to dominate with 32% of total revenue. Notably, the **Wireless Earbuds Pro** has maintained its #1 position for 3 consecutive weeks. Home & Kitchen showed the highest growth rate at +18% week-over-week.\n\nSunday sales remained strong at ₹17,200, confirming the weekend shopping pattern. Staff efficiency improved with average transaction time dropping from 2.1 to 1.8 minutes.`,
          suggestions: [
            '🏷️ Create a "Shandy Thursday Bundle" — pair top Electronics with Home items at a combined discount to increase basket value from current avg ₹445 to ₹600+',
            '📦 Restock USB Type-C Cable (15 units) and Ceramic Mug Set (8 units) before Thursday — both are at critical low stock and are consistent sellers',
            '📱 Start tracking UPI payment share — it grew from 28% to 34% this week. Consider adding a "Pay via UPI" 2% cashback offer to accelerate the shift from cash handling',
          ],
          generated_at: new Date().toISOString(),
        },
      });
    }

    // Production: use Claude
    const { generateWeeklyInsights, buildSalesContext } = await import('@/lib/ai');

    const context = buildSalesContext({
      recentSales: [],
      topProducts: [],
      todayStats: { revenue: 14900, transactions: 100, items: 100 },
      weeklyPattern: [],
    });

    const insights = await generateWeeklyInsights(context);

    return NextResponse.json({
      success: true,
      data: {
        ...insights,
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('AI insights error:', error);
    return NextResponse.json({ success: false, error: 'Failed to generate insights' }, { status: 500 });
  }
}
