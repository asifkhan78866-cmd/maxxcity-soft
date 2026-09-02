// ═══════════════════════════════════════
// Demand Forecast
// ═══════════════════════════════════════
// Built from real sales history only. The previous version generated random
// revenue when the database was empty — that is removed, because a forecast
// derived from noise is worse than no forecast at all. With no history the
// response is explicitly flagged as assumption-based.

import { withPermission, ok } from '@/lib/auth/guard';
import { generateForecast, fetchSalesContext } from '@/lib/ai';

export const GET = withPermission(
  'ai.read',
  async () => {
    const ctx = await fetchSalesContext();
    const forecast = generateForecast(ctx.dailySummary30d);

    return ok({
      forecast: forecast.days,
      historyDays: forecast.historyDays,
      usesAssumptions: forecast.usesAssumptions,
      disclaimer: forecast.disclaimer,
    });
  },
  'ai/forecast'
);
