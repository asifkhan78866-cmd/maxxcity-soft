// ═══════════════════════════════════════
// Anomaly Detection
// ═══════════════════════════════════════
// Pure rule engine over real shift and sales rows — no model call, so it
// works regardless of AI configuration.

import { withPermission, ok, fail } from '@/lib/auth/guard';
import { detectShiftAnomalies, fetchShiftAnomalyData } from '@/lib/ai';
import { parseOrThrow, uuidSchema } from '@/lib/validation/schemas';
import { z } from 'zod';

const schema = z.object({ shift_id: uuidSchema });

export const POST = withPermission(
  'shift.read.all',
  async (request) => {
    const body = parseOrThrow(schema, await request.json());

    const { shifts, sales, historicalSales } = await fetchShiftAnomalyData(body.shift_id);
    const shift = shifts.find((s) => s.id === body.shift_id);

    if (!shift) return fail('Shift not found', 404, 'SHIFT_NOT_FOUND');

    const shiftSales = sales.filter((s) => s.shift_id === body.shift_id);
    return ok(detectShiftAnomalies(shift, shiftSales, historicalSales));
  },
  'ai/anomalies'
);
