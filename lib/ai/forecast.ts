// ═══════════════════════════════════════
// Demand Forecasting Engine
// ═══════════════════════════════════════
// Pure statistics — no external AI needed.
// Uses 12-week historical data + day-of-week multipliers + festival boosts.

export interface ForecastDay {
  date: string;
  day_name: string;
  predicted_revenue: number;
  confidence_low: number;
  confidence_high: number;
  is_shandy: boolean;
  is_peak: boolean;
  festival_boost: string | null;
}

// Day-of-week multipliers derived from Adilabad retail patterns
const DAY_MULTIPLIERS: Record<number, number> = {
  0: 2.10,  // Sunday — peak
  1: 0.58,  // Monday
  2: 0.70,  // Tuesday
  3: 0.82,  // Wednesday
  4: 1.45,  // Thursday — shandy
  5: 1.08,  // Friday
  6: 1.65,  // Saturday
};

// Festival calendar (approximate month/day ranges)
interface FestivalPeriod {
  name: string;
  boost: number;
  check: (d: Date) => boolean;
}

const FESTIVALS: FestivalPeriod[] = [
  { name: 'Diwali Week', boost: 2.5, check: (d) => d.getMonth() === 9 && d.getDate() >= 20 || d.getMonth() === 10 && d.getDate() <= 5 },
  { name: 'Eid Week', boost: 2.2, check: (d) => d.getMonth() === 2 && d.getDate() >= 28 || d.getMonth() === 3 && d.getDate() <= 5 },
  { name: 'Ugadi/Sankranti', boost: 1.8, check: (d) => d.getMonth() === 0 && d.getDate() >= 12 && d.getDate() <= 16 || d.getMonth() === 3 && d.getDate() >= 8 && d.getDate() <= 12 },
  { name: 'Wedding Season', boost: 1.3, check: (d) => d.getMonth() === 10 || d.getMonth() === 11 || d.getMonth() === 1 },
];

function getActiveFestival(d: Date): FestivalPeriod | null {
  return FESTIVALS.find(f => f.check(d)) || null;
}

/**
 * Generate 14-day sales forecast from historical daily sales
 */
export function generateForecast(
  dailySales: Array<{ date: string; revenue: number }>
): ForecastDay[] {
  // Group historical sales by day-of-week
  const dayOfWeekData: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  dailySales.forEach(d => {
    const dow = new Date(d.date).getDay();
    dayOfWeekData[dow].push(d.revenue);
  });

  // Calculate mean and stddev per day-of-week
  const dayStats: Record<number, { mean: number; stddev: number }> = {};
  for (const [dow, revenues] of Object.entries(dayOfWeekData)) {
    const n = revenues.length;
    if (n === 0) {
      dayStats[Number(dow)] = { mean: 14000 * DAY_MULTIPLIERS[Number(dow)], stddev: 2000 };
      continue;
    }
    const mean = revenues.reduce((a, b) => a + b, 0) / n;
    const variance = revenues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
    dayStats[Number(dow)] = { mean, stddev: Math.sqrt(variance) };
  }

  // Calculate week-over-week trend
  const weeklyTotals: number[] = [];
  for (let i = 0; i < dailySales.length; i += 7) {
    const week = dailySales.slice(i, i + 7);
    weeklyTotals.push(week.reduce((s, d) => s + d.revenue, 0));
  }
  let trendFactor = 1.0;
  if (weeklyTotals.length >= 2) {
    const last = weeklyTotals[weeklyTotals.length - 1];
    const prev = weeklyTotals[weeklyTotals.length - 2];
    if (prev > 0) trendFactor = Math.min(Math.max(last / prev, 0.8), 1.2); // Clamp to ±20%
  }

  // Generate 14-day forecast
  const forecast: ForecastDay[] = [];
  const today = new Date();

  for (let i = 1; i <= 14; i++) {
    const futureDate = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const dow = futureDate.getDay();
    const stats = dayStats[dow];
    const festival = getActiveFestival(futureDate);

    let predicted = stats.mean * trendFactor;
    if (festival) predicted *= festival.boost;

    // Confidence interval (±1.5 std dev)
    const confidence = stats.stddev * 1.5;

    forecast.push({
      date: futureDate.toISOString().slice(0, 10),
      day_name: futureDate.toLocaleDateString('en-IN', { weekday: 'long' }),
      predicted_revenue: Math.round(predicted),
      confidence_low: Math.max(0, Math.round(predicted - confidence)),
      confidence_high: Math.round(predicted + confidence),
      is_shandy: dow === 4,
      is_peak: dow === 0,
      festival_boost: festival?.name || null,
    });
  }

  return forecast;
}
