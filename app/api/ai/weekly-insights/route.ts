// ═══════════════════════════════════════
// Weekly Insights (Claude via OpenRouter)
// ═══════════════════════════════════════
// No fabricated fallback: without a provider key the endpoint reports that
// the feature is unconfigured rather than inventing a week's performance.

import { withPermission, ok, fail } from '@/lib/auth/guard';
import { generateWeeklyInsights, buildWeeklyContext, fetchSalesContext } from '@/lib/ai';

export const GET = withPermission(
  'ai.read',
  async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      return fail(
        'Weekly insights are not configured. Add OPENROUTER_API_KEY to the environment to enable them.',
        503,
        'AI_NOT_CONFIGURED'
      );
    }

    const ctx = await fetchSalesContext();

    if (ctx.dailySummary30d.length === 0) {
      return fail(
        'There are no completed sales yet, so there is nothing to analyse this week.',
        409,
        'NO_DATA'
      );
    }

    const insights = await generateWeeklyInsights(buildWeeklyContext(ctx));
    return ok({ ...insights, basedOnDays: ctx.dailySummary30d.length });
  },
  'ai/weekly-insights'
);
