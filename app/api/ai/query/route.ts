// ═══════════════════════════════════════
// AI Query API (Groq — llama-3.3-70b)
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { question } = await request.json();

    if (!question) {
      return NextResponse.json({ success: false, error: 'Question is required' }, { status: 400 });
    }

    // Check for API key
    if (!process.env.GROQ_API_KEY) {
      // Return a demo response when no API key
      return NextResponse.json({
        success: true,
        data: {
          answer: getDemoAnswer(question),
          model: 'demo',
        },
      });
    }

    // Production: Use Groq API
    const { queryGroq, buildSalesContext } = await import('@/lib/ai');

    const context = buildSalesContext({
      recentSales: [],
      topProducts: [
        { product_name: 'Wireless Earbuds Pro', qty_sold: 45 },
        { product_name: 'Kitchen Organizer Box', qty_sold: 38 },
        { product_name: 'Cotton T-Shirt Basic', qty_sold: 35 },
      ],
      todayStats: { revenue: 14900, transactions: 100, items: 100 },
      weeklyPattern: [
        { day: 'Monday', revenue: 12000 },
        { day: 'Tuesday', revenue: 11000 },
        { day: 'Wednesday', revenue: 13000 },
        { day: 'Thursday', revenue: 18000 },
        { day: 'Friday', revenue: 14000 },
        { day: 'Saturday', revenue: 15000 },
        { day: 'Sunday', revenue: 17000 },
      ],
    });

    const answer = await queryGroq(question, context);
    return NextResponse.json({ success: true, data: { answer, model: 'llama-3.3-70b-versatile' } });
  } catch (error) {
    console.error('AI query error:', error);
    return NextResponse.json({ success: false, error: 'AI query failed' }, { status: 500 });
  }
}

function getDemoAnswer(question: string): string {
  const q = question.toLowerCase();

  if (q.includes('top') && q.includes('product')) {
    return `📊 **Top Products This Week:**\n\n1. **Wireless Earbuds Pro** — 45 units sold (₹6,705)\n2. **Kitchen Organizer Box** — 38 units sold (₹5,662)\n3. **Cotton T-Shirt Basic** — 35 units sold (₹5,215)\n4. **Face Wash Gel 100ml** — 32 units sold (₹4,768)\n5. **Kids Toy Car Set** — 28 units sold (₹4,172)\n\nElectronics continues to lead, driven by the Earbuds Pro which is your bestseller for 3 consecutive weeks.`;
  }

  if (q.includes('thursday') || q.includes('shandy')) {
    return `🎯 **Thursday Shandy Analysis:**\n\nThursdays consistently show **+25-30%** higher sales compared to weekday averages due to the Adilabad shandy (weekly market).\n\n- Average Thursday revenue: ₹18,500\n- Average other weekdays: ₹13,200\n- Key categories on Thursdays: Home & Kitchen (+40%), Clothing (+35%)\n\n**Recommendation:** Pre-stock Kitchen and Clothing items before Thursday. Consider running a "Shandy Special" combo offer.`;
  }

  if (q.includes('revenue') || q.includes('sales')) {
    return `💰 **Sales Summary:**\n\n- **Today:** ₹14,900 (100 transactions)\n- **This Week:** ₹98,600 (662 transactions)\n- **This Month:** ₹3,85,400 (2,586 transactions)\n\nYou're tracking **8% above** last month's pace. Thursday and Sunday remain your strongest days.`;
  }

  return `Based on your store data at MaxxCity Mall:\n\nYour store is performing well with consistent daily revenue averaging ₹14,000-18,000. Key insights:\n\n1. **Thursday shandy effect** drives 25% higher sales\n2. **Electronics** is your top category by revenue\n3. **Stock alert:** USB Type-C Cable and Ceramic Mug Set are running low\n\nWould you like me to analyze any specific aspect in more detail?`;
}
