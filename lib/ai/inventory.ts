// ═══════════════════════════════════════
// AI Inventory Optimizer Engine
// ═══════════════════════════════════════
// Analyzes sales velocity, days of stock, and categorizes products.

import type { ProductRowLite } from './types';

export interface InventoryRecommendation {
  product_id: string;
  name: string;
  category: string;
  velocity: number;      // units sold per day
  days_of_stock: number; // estimated days until stockout
  status: 'REORDER_NOW' | 'REORDER_SOON' | 'SLOW_MOVER' | 'DEAD_STOCK' | 'HEALTHY';
  current_stock: number;
}

export function analyzeInventory(
  products: ProductRowLite[],
  /** product_id → units sold in the last 30 days */
  salesByProduct: Record<string, number>
): {
  recommendations: InventoryRecommendation[];
  contextString: string;
} {
  const recommendations: InventoryRecommendation[] = [];

  products.forEach(p => {
    const unitsSoldLast30 = salesByProduct[p.id] || 0;
    const velocity = unitsSoldLast30 / 30; // units per day
    const daysOfStock = velocity > 0 ? Math.round(p.stock_qty / velocity) : 999;
    
    let status: InventoryRecommendation['status'] = 'HEALTHY';
    
    if (unitsSoldLast30 === 0) {
      status = 'DEAD_STOCK';
    } else if (velocity < 0.2) { // less than 1 per 5 days
      status = 'SLOW_MOVER';
    } else if (daysOfStock < 7) {
      status = 'REORDER_NOW';
    } else if (daysOfStock >= 7 && daysOfStock <= 14) {
      status = 'REORDER_SOON';
    }

    recommendations.push({
      product_id: p.id,
      name: p.name,
      category: p.category ?? 'Others',
      velocity: Number(velocity.toFixed(2)),
      days_of_stock: daysOfStock,
      status,
      current_stock: p.stock_qty,
    });
  });

  // Sort by urgency: REORDER_NOW first, then SOON, then DEAD, SLOW, HEALTHY
  const statusWeight = { REORDER_NOW: 1, REORDER_SOON: 2, DEAD_STOCK: 3, SLOW_MOVER: 4, HEALTHY: 5 };
  recommendations.sort((a, b) => statusWeight[a.status] - statusWeight[b.status]);

  // Build a concise context string to feed to Claude
  const critical = recommendations.filter(r => r.status === 'REORDER_NOW' || r.status === 'REORDER_SOON');
  const dead = recommendations.filter(r => r.status === 'DEAD_STOCK' || r.status === 'SLOW_MOVER');
  
  let contextString = `Current Inventory Status:\n\n`;
  contextString += `CRITICAL RESTOCK NEEDED:\n`;
  critical.slice(0, 15).forEach(r => {
    contextString += `- ${r.name}: ${r.current_stock} left. Sells ${r.velocity}/day. Stock out in ${r.days_of_stock} days.\n`;
  });
  if (critical.length === 0) contextString += `- None\n`;

  contextString += `\nSLOW & DEAD STOCK (Needs Promotion):\n`;
  dead.slice(0, 15).forEach(r => {
    contextString += `- ${r.name}: ${r.current_stock} left. Sold ${Math.round(r.velocity * 30)} in last 30 days.\n`;
  });
  if (dead.length === 0) contextString += `- None\n`;

  return { recommendations, contextString };
}
