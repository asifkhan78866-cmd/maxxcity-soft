// ═══════════════════════════════════════
// Reporting Period Resolution
// ═══════════════════════════════════════
// One place that turns a period name into a concrete UTC range, so the
// dashboard, the reports page and the AI context all agree on what "today"
// and "this week" mean.

export type PeriodName =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'custom';

export interface DateRange {
  from: Date;
  to: Date;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export function resolvePeriod(
  period: PeriodName,
  fromIso?: string,
  toIso?: string
): DateRange {
  const now = new Date();

  if (period === 'custom' || fromIso || toIso) {
    const from = fromIso ? new Date(fromIso) : startOfDay(now);
    const to = toIso ? new Date(toIso) : endOfDay(now);
    // Guard against a reversed range silently returning nothing.
    return from <= to ? { from, to } : { from: to, to: from };
  }

  switch (period) {
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case 'week': {
      const from = new Date(now);
      from.setDate(from.getDate() - 6);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'quarter': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 3);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case 'today':
    default:
      return { from: startOfDay(now), to: endOfDay(now) };
  }
}

/** The equivalent range immediately before `range` — used for % comparisons. */
export function previousPeriod(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - span - 1),
    to: new Date(range.from.getTime() - 1),
  };
}

/** Percentage change, guarding the divide-by-zero case. */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
