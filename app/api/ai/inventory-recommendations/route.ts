// ═══════════════════════════════════════
// Inventory Optimizer API
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';
import { analyzeInventory, fetchInventoryData, generateInventoryCommentary } from '@/lib/ai';

export async function GET() {
  try {
    const { products, salesByProduct } = await fetchInventoryData();
    const { recommendations, contextString } = analyzeInventory(products, salesByProduct);

    if (!process.env.OPENROUTER_API_KEY) {
      // Demo response if no key
      return NextResponse.json({
        success: true,
        data: {
          recommendations,
          ai_commentary: 'Inventory is generally healthy. Prioritize restocking electronics.',
          priority_actions: ['Restock Wireless Earbuds Pro', 'Check USB Cables'],
          promotion_suggestions: ['Bundle Slow Mover Toys with Fast Mover Stationery'],
        },
      });
    }

    const commentary = await generateInventoryCommentary(contextString);

    return NextResponse.json({
      success: true,
      data: {
        recommendations,
        ...commentary,
      },
    });
  } catch (error) {
    console.error('Inventory optimizer error:', error);
    return NextResponse.json({ success: false, error: 'Failed to optimize inventory' }, { status: 500 });
  }
}
