// ═══════════════════════════════════════
// lib/ai — AI Client Library Index
// ═══════════════════════════════════════

export { queryGroq, generateWeeklyInsights, generateInventoryCommentary, createGroqClient, buildQueryContext, buildWeeklyContext } from './client';
export { fetchSalesContext, fetchInventoryData, fetchShiftAnomalyData, type SalesContext } from './context';
export { generateForecast, type ForecastDay } from './forecast';
export { detectShiftAnomalies, detectInventoryAnomalies, type AnomalyAlert } from './anomalies';
export { analyzeInventory, type InventoryRecommendation } from './inventory';
