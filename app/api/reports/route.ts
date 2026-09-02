// ═══════════════════════════════════════
// Reports API
// ═══════════════════════════════════════
// One endpoint, several report sections. Every figure comes from a real
// database query — see lib/reports/queries.ts.
//
//   ?section=dashboard | sales | inventory | cashiers | gst | margin | voids

import { withPermission, ok, fail } from '@/lib/auth/guard';
import { reportQuerySchema, parseOrThrow } from '@/lib/validation/schemas';
import { resolvePeriod } from '@/lib/reports/period';
import {
  getKPIs,
  getHourlySales,
  getDailySales,
  getWeekdayPattern,
  getTopProducts,
  getCategoryBreakdown,
  getPaymentBreakdown,
  getGSTSummary,
  getCashierPerformance,
  getInventorySummary,
  getMarginReport,
  getVoidsAndReturns,
} from '@/lib/reports/queries';

export const GET = withPermission(
  'reports.read',
  async (request) => {
    const url = new URL(request.url);
    const section = url.searchParams.get('section') ?? 'dashboard';
    const query = parseOrThrow(
      reportQuerySchema,
      Object.fromEntries(url.searchParams.entries())
    );
    const range = resolvePeriod(query.period, query.from, query.to);
    const meta = { period: query.period, from: range.from.toISOString(), to: range.to.toISOString() };

    switch (section) {
      case 'dashboard': {
        const [kpis, hourly, topProducts, inventory, weekday] = await Promise.all([
          getKPIs(range),
          getHourlySales(range),
          getTopProducts(range, 10),
          getInventorySummary(),
          // The weekday pattern needs more than one day to mean anything.
          getWeekdayPattern(resolvePeriod('month')),
        ]);
        return ok({ meta, kpis, hourly, topProducts, inventory, weekday });
      }

      case 'sales': {
        const [kpis, daily, payments, categories, topProducts] = await Promise.all([
          getKPIs(range),
          getDailySales(range),
          getPaymentBreakdown(range),
          getCategoryBreakdown(range),
          getTopProducts(range, 20),
        ]);
        return ok({ meta, kpis, daily, payments, categories, topProducts });
      }

      case 'inventory':
        return ok({ meta, inventory: await getInventorySummary() });

      case 'cashiers':
        return ok({ meta, cashiers: await getCashierPerformance(range) });

      case 'gst':
        return ok({ meta, gst: await getGSTSummary(range) });

      case 'margin':
        return ok({ meta, margin: await getMarginReport(range) });

      case 'voids':
        return ok({ meta, ...(await getVoidsAndReturns(range)) });

      case 'full': {
        const [kpis, daily, payments, categories, gst, cashiers, inventory, margin, voids] =
          await Promise.all([
            getKPIs(range),
            getDailySales(range),
            getPaymentBreakdown(range),
            getCategoryBreakdown(range),
            getGSTSummary(range),
            getCashierPerformance(range),
            getInventorySummary(),
            getMarginReport(range),
            getVoidsAndReturns(range),
          ]);
        return ok({
          meta,
          kpis,
          daily,
          payments,
          categories,
          gst,
          cashiers,
          inventory,
          margin,
          voids,
        });
      }

      default:
        return fail(`Unknown report section "${section}"`, 422, 'UNKNOWN_SECTION');
    }
  },
  'reports'
);
