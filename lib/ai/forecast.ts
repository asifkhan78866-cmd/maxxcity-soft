// ═══════════════════════════════════════
// Demand Forecasting Engine
// ═══════════════════════════════════════
// Pure statistics — no external AI needed.
//
// HONESTY RULE: every forecast day carries a `basis` and a `sample_days`
// count so the UI can say what a number actually is:
//
//   'observed'  — enough real MaxxCity history for this weekday to model it
//   'estimated' — some history, but a thin sample; treat as indicative
//   'assumed'   — no history at all; falls back to published day-of-week
//                 multipliers, which are ASSUMPTIONS, not measurements
//
// As real sales history accumulates the assumed baseline stops being used.
// Nothing here should ever be presented to the owner as a measured fact.

/** Minimum observations of a weekday before we treat its mean as reliable. */
const RELIABLE_SAMPLE = 4;
/** Below this, we have signal but not confidence. */
const THIN_SAMPLE = 2;

export interface ForecastDay {
  date: string;
  day_name: string;
  predicted_revenue: number;
  confidence_low: number;
  confidence_high: number;
  /** How this number was produced. Surface it — never hide it. */
  basis: 'observed' | 'estimated' | 'assumed';
  /** How many real trading days of this weekday fed the estimate. */
  sample_days: number;
  is_shandy: boolean;
  is_peak: boolean;
  festival_boost: string | null;
}

export interface ForecastResult {
  days: ForecastDay[];
  /** True when at least one day had to fall back to assumed multipliers. */
  usesAssumptions: boolean;
  historyDays: number;
  /** Plain-language caveat for the UI to display verbatim. */
  disclaimer: string;
}

/**
 * Day-of-week multipliers used ONLY when a weekday has no observed history.
 * These are assumptions about Adilabad retail patterns, not measurements.
 */
const ASSUMED_DAY_MULTIPLIERS: Record<number, number> = {
  0: 2.1, // Sunday — peak
  1: 0.58, // Monday
  2: 0.7, // Tuesday
  3: 0.82, // Wednesday
  4: 1.45, // Thursday — shandy market day
  5: 1.08, // Friday
  6: 1.65, // Saturday
};

interface FestivalPeriod {
  name: string;
  boost: number;
  check: (d: Date) => boolean;
}

/**
 * Approximate festival windows. These shift with the lunar calendar every
 * year, so they are a rough planning aid, never a precise prediction.
 */
const FESTIVALS: FestivalPeriod[] = [
  {
    name: 'Diwali Week',
    boost: 2.5,
    check: (d) =>
      (d.getMonth() === 9 && d.getDate() >= 20) || (d.getMonth() === 10 && d.getDate() <= 5),
  },
  {
    name: 'Eid Week',
    boost: 2.2,
    check: (d) =>
      (d.getMonth() === 2 && d.getDate() >= 28) || (d.getMonth() === 3 && d.getDate() <= 5),
  },
  {
    name: 'Ugadi/Sankranti',
    boost: 1.8,
    check: (d) =>
      (d.getMonth() === 0 && d.getDate() >= 12 && d.getDate() <= 16) ||
      (d.getMonth() === 3 && d.getDate() >= 8 && d.getDate() <= 12),
  },
  {
    name: 'Wedding Season',
    boost: 1.3,
    check: (d) => d.getMonth() === 10 || d.getMonth() === 11 || d.getMonth() === 1,
  },
];

function getActiveFestival(d: Date): FestivalPeriod | null {
  return FESTIVALS.find((f) => f.check(d)) ?? null;
}

/**
 * Generate a 14-day revenue forecast from real daily sales history.
 *
 * With no history at all the function still returns a shape the UI can render,
 * but every day is flagged `assumed` and the disclaimer says so.
 */
export function generateForecast(
  dailySales: Array<{ date: string; revenue: number }>,
  horizonDays = 14
): ForecastResult {
  const byDow: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  for (const day of dailySales) {
    const dow = new Date(day.date).getDay();
    byDow[dow].push(day.revenue);
  }

  // A store-wide daily average is the only sensible anchor for a weekday we
  // have never observed. With no history at all there is nothing to anchor to.
  const overallMean =
    dailySales.length > 0
      ? dailySales.reduce((sum, d) => sum + d.revenue, 0) / dailySales.length
      : 0;

  const stats: Record<number, { mean: number; stddev: number; n: number }> = {};
  for (let dow = 0; dow < 7; dow++) {
    const values = byDow[dow];
    const n = values.length;

    if (n === 0) {
      stats[dow] = {
        mean: overallMean * ASSUMED_DAY_MULTIPLIERS[dow],
        stddev: overallMean * 0.25,
        n: 0,
      };
      continue;
    }

    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
    stats[dow] = { mean, stddev: Math.sqrt(variance), n };
  }

  // Week-over-week trend, clamped so one unusual week cannot dominate.
  const weeklyTotals: number[] = [];
  for (let i = 0; i < dailySales.length; i += 7) {
    weeklyTotals.push(dailySales.slice(i, i + 7).reduce((s, d) => s + d.revenue, 0));
  }
  let trendFactor = 1;
  if (weeklyTotals.length >= 2) {
    const last = weeklyTotals[weeklyTotals.length - 1];
    const prev = weeklyTotals[weeklyTotals.length - 2];
    if (prev > 0) trendFactor = Math.min(Math.max(last / prev, 0.8), 1.2);
  }

  const days: ForecastDay[] = [];
  const today = new Date();
  let usesAssumptions = false;

  for (let i = 1; i <= horizonDays; i++) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const dow = date.getDay();
    const stat = stats[dow];
    const festival = getActiveFestival(date);

    let predicted = stat.mean * trendFactor;
    if (festival) predicted *= festival.boost;

    const basis: ForecastDay['basis'] =
      stat.n >= RELIABLE_SAMPLE ? 'observed' : stat.n >= THIN_SAMPLE ? 'estimated' : 'assumed';
    if (basis === 'assumed') usesAssumptions = true;

    // A thinner sample deserves a wider band.
    const spread = stat.stddev * (basis === 'observed' ? 1.5 : basis === 'estimated' ? 2 : 2.5);

    days.push({
      date: date.toISOString().slice(0, 10),
      day_name: date.toLocaleDateString('en-IN', { weekday: 'long' }),
      predicted_revenue: Math.round(predicted),
      confidence_low: Math.max(0, Math.round(predicted - spread)),
      confidence_high: Math.round(predicted + spread),
      basis,
      sample_days: stat.n,
      is_shandy: dow === 4,
      is_peak: dow === 0,
      festival_boost: festival?.name ?? null,
    });
  }

  const disclaimer =
    dailySales.length === 0
      ? 'No sales history is available yet, so this forecast is based entirely on assumed retail patterns. Treat it as a placeholder, not a prediction.'
      : usesAssumptions
        ? `Based on ${dailySales.length} day(s) of real MaxxCity sales. Days marked "assumed" have no history yet and fall back to general retail patterns.`
        : `Based on ${dailySales.length} day(s) of real MaxxCity sales history. Festival boosts remain approximate.`;

  return { days, usesAssumptions, historyDays: dailySales.length, disclaimer };
}
