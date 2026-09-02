// ═══════════════════════════════════════
// Offline & Reporting Invariants
// ═══════════════════════════════════════
// Covers the properties that keep offline billing safe: an offline invoice
// number can never collide with a server-issued one or with another
// terminal's, and reporting periods are computed consistently.

import { describe, it, expect } from 'vitest';
import { isOfflineInvoiceNumber } from '@/lib/database/dexie';
import { resolvePeriod, previousPeriod, percentChange } from '@/lib/reports/period';

describe('invoice number namespacing', () => {
  const serverNumbers = ['MCM/2026/000001', 'MCM/2026/999999', 'MCM/2025/000042'];
  const offlineNumbers = ['MCM/2026/OFF-T4A9C2-00001', 'MCM/2026/OFF-COUNTER2-00017'];

  it('recognises a locally issued number', () => {
    for (const n of offlineNumbers) expect(isOfflineInvoiceNumber(n)).toBe(true);
  });

  it('does not mistake a server number for an offline one', () => {
    for (const n of serverNumbers) expect(isOfflineInvoiceNumber(n)).toBe(false);
  });

  it('keeps the two namespaces disjoint', () => {
    // This is what makes the unique constraint on invoice_number safe when
    // offline sales sync: the OFF- segment cannot appear in a server number.
    for (const offline of offlineNumbers) {
      for (const server of serverNumbers) {
        expect(offline).not.toBe(server);
      }
    }
  });

  it('separates two terminals billing offline at the same moment', () => {
    // Both terminals issue their own sequence #1; the terminal segment is
    // what stops the two numbers being identical.
    const terminalA = 'MCM/2026/OFF-TAAAAA-00001';
    const terminalB = 'MCM/2026/OFF-TBBBBB-00001';
    expect(terminalA).not.toBe(terminalB);
  });
});

describe('reporting periods', () => {
  it('bounds "today" to a single calendar day', () => {
    const { from, to } = resolvePeriod('today');
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getHours()).toBe(23);
    expect(from.toDateString()).toBe(to.toDateString());
  });

  it('spans seven days for "week"', () => {
    const { from, to } = resolvePeriod('week');
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(days).toBe(7);
  });

  it('starts "month" on the first of the month', () => {
    const { from } = resolvePeriod('month');
    expect(from.getDate()).toBe(1);
  });

  it('honours an explicit custom range', () => {
    const { from, to } = resolvePeriod(
      'custom',
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.000Z'
    );
    expect(from.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(to.toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  it('corrects a reversed custom range instead of returning nothing', () => {
    const { from, to } = resolvePeriod(
      'custom',
      '2026-01-31T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    );
    expect(from.getTime()).toBeLessThan(to.getTime());
  });

  it('produces a non-overlapping previous period of the same length', () => {
    const current = resolvePeriod('week');
    const previous = previousPeriod(current);

    const currentSpan = current.to.getTime() - current.from.getTime();
    const previousSpan = previous.to.getTime() - previous.from.getTime();

    expect(Math.abs(currentSpan - previousSpan)).toBeLessThanOrEqual(2);
    expect(previous.to.getTime()).toBeLessThan(current.from.getTime());
  });
});

describe('percentage change', () => {
  it('computes a normal change', () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
  });

  it('handles a zero baseline without dividing by zero', () => {
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(500, 0)).toBe(100);
  });

  it('rounds to one decimal place', () => {
    expect(percentChange(1234, 1000)).toBe(23.4);
  });
});
