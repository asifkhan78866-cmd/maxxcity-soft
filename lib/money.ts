// ═══════════════════════════════════════
// Decimal-Safe Money Helpers
// ═══════════════════════════════════════
// All monetary maths runs in integer PAISE (1 rupee = 100 paise) so that
// POS totals, receipts, database rows and reports agree to the last paisa.
//
// Rule: convert rupees → paise, do all arithmetic in paise, convert back once.
// Never sum floating-point rupee values directly.

/**
 * Shift a number's decimal point using its DECIMAL string form.
 *
 * Multiplying by 100 rounds through binary floating point, where 1.005 is
 * really 1.00499999999999989 — so `1.005 * 100` is 100.49999999999999 and
 * rounds DOWN to ₹1.00 instead of ₹1.01. Adding Number.EPSILON does not help:
 * the error here is ~1e-14, five decimal orders larger than epsilon.
 *
 * Re-parsing "1.005e2" instead shifts the point in the decimal representation,
 * giving exactly 100.5, which rounds correctly.
 */
function shiftDecimal(value: number, places: number): number {
  if (value === 0 || !Number.isFinite(value)) return value;
  const [mantissa, exponent] = String(value).split('e');
  return Number(`${mantissa}e${exponent ? Number(exponent) + places : places}`);
}

/** Convert a rupee amount to integer paise, rounding half away from zero. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  const sign = rupees < 0 ? -1 : 1;
  return sign * Math.round(shiftDecimal(Math.abs(rupees), 2));
}

/** Convert integer paise back to a rupee number with 2 decimals. */
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** Round a rupee amount to 2 decimal places, half away from zero. */
export function roundMoney(rupees: number): number {
  return toRupees(toPaise(rupees));
}

/** Sum a list of rupee amounts without accumulating float error. */
export function sumMoney(values: number[]): number {
  return toRupees(values.reduce((acc, v) => acc + toPaise(v), 0));
}

/** True when two rupee amounts are equal to the paisa. */
export function moneyEquals(a: number, b: number): boolean {
  return toPaise(a) === toPaise(b);
}

/**
 * Split an integer paise amount into two halves (CGST / SGST).
 * The remainder paisa, if any, goes to the first half so the two always
 * add back to exactly the input.
 */
export function splitPaise(total: number): { first: number; second: number } {
  const t = Math.round(total);
  const second = Math.floor(t / 2);
  return { first: t - second, second };
}

/** Format a rupee amount in Indian currency notation. */
export function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(roundMoney(amount));
}

/** Format a rupee amount as plain digits (no symbol) — used on thermal paper. */
export function formatAmountPlain(amount: number): string {
  return roundMoney(amount).toFixed(2);
}
