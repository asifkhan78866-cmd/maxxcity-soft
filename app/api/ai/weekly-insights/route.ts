// ═══════════════════════════════════════
// Weekly Insights API (Claude)
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';
import { generateWeeklyInsights, buildWeeklyContext, fetchSalesContext } from '@/lib/ai';

export async function GET() {
  try {
    const ctx = await fetchSalesContext();
    const contextStr = buildWeeklyContext(ctx);

    if (!process.env.OPENROUTER_API_KEY) {
      // Demo response if no key
      return NextResponse.json({
        success: true,
        data: {
          week_summary: 'This week showed a healthy 12% revenue increase compared to last week, driven by a strong Thursday.',
          revenue_vs_target: { actual: ctx.thisWeekVsLast.this_week, target: 100000, variance_pct: ((ctx.thisWeekVsLast.this_week - 100000) / 100000) * 100 },
          top_insight: 'Electronics category continues to dominate, but Kitchen is growing fast.',
          opportunities: ['Run a Thursday bundle', 'Clear out dead stock in Toys'],
          watch_items: ['Low stock on Type-C cables', 'Check cash handling accuracy'],
          next_thursday_prep: 'Ensure Kitchen items are fully stocked.',
          next_sunday_tip: 'Schedule extra staff for peak hours 5pm-8pm.',
          inventory_alert: 'Restock top 3 electronics before weekend.',
        },
      });
    }

    const insights = await generateWeeklyInsights(contextStr);
    return NextResponse.json({ success: true, data: insights });
  } catch (error) {
    console.error('Weekly insights error:', error);
    return NextResponse.json({ success: false, error: 'Failed to generate insights' }, { status: 500 });
  }
}
