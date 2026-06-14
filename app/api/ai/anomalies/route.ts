// ═══════════════════════════════════════
// Anomaly Detection API
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';
import { detectShiftAnomalies, fetchShiftAnomalyData } from '@/lib/ai';

export async function POST(request: Request) {
  try {
    const { shift_id } = await request.json();

    if (!shift_id) {
      return NextResponse.json({ success: false, error: 'shift_id is required' }, { status: 400 });
    }

    const { shifts, sales, historicalSales } = await fetchShiftAnomalyData(shift_id);
    const shift = shifts.find(s => s.id === shift_id);

    if (!shift) {
      return NextResponse.json({ success: false, error: 'Shift not found' }, { status: 404 });
    }

    const shiftSales = sales.filter(s => s.shift_id === shift_id);
    const anomalies = detectShiftAnomalies(shift, shiftSales, historicalSales);

    return NextResponse.json({ success: true, data: anomalies });
  } catch (error) {
    console.error('Anomalies error:', error);
    return NextResponse.json({ success: false, error: 'Failed to detect anomalies' }, { status: 500 });
  }
}
