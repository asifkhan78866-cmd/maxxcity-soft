// ═══════════════════════════════════════
// Inventory Optimizer
// ═══════════════════════════════════════
// The velocity / days-of-stock analysis is pure arithmetic over real stock
// and sales rows, so it works with or without an AI key. Only the narrative
// commentary needs a provider — and its absence is reported honestly rather
// than filled in with an invented summary.
//
// Recommendations are advisory. Nothing here places an order; a human decides.

import { withPermission, ok } from '@/lib/auth/guard';
import { analyzeInventory, fetchInventoryData, generateInventoryCommentary } from '@/lib/ai';

export const GET = withPermission(
  'inventory.read',
  async () => {
    const { products, salesByProduct } = await fetchInventoryData();
    const { recommendations, contextString } = analyzeInventory(products, salesByProduct);

    if (!process.env.OPENROUTER_API_KEY) {
      return ok({
        recommendations,
        ai_commentary: null,
        priority_actions: [],
        promotion_suggestions: [],
        commentaryAvailable: false,
        note: 'Restock analysis below is computed from real stock and sales data. AI commentary is unavailable because OPENROUTER_API_KEY is not configured.',
        requiresApproval: true,
      });
    }

    const commentary = await generateInventoryCommentary(contextString);

    return ok({
      recommendations,
      ...commentary,
      commentaryAvailable: true,
      requiresApproval: true,
      note: 'These are recommendations only. No purchase is placed automatically.',
    });
  },
  'ai/inventory-recommendations'
);
