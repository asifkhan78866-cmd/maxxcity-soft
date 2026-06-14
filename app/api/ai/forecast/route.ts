// ═══════════════════════════════════════
// Demand Forecast API
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';
import { generateForecast, fetchSalesContext } from '@/lib/ai';

export async function GET() {
  try {
    const ctx = await fetchSalesContext();
    
    // Fallback data if DB is empty
    let dailySales = ctx.dailySummary30d;
    if (dailySales.length === 0) {
      dailySales = Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (30 - i));
        return {
          date: d.toISOString().slice(0, 10),
          revenue: 14000 + (Math.random() * 4000 - 2000),
          items: 100,
          transactions: 100,
        };
      });
    }

    const forecast = generateForecast(dailySales);

    return NextResponse.json({ success: true, data: forecast });
  } catch (error) {
    console.error('Forecast error:', error);
    return NextResponse.json({ success: false, error: 'Failed to generate forecast' }, { status: 500 });
  }
}
