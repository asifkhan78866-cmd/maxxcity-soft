// ═══════════════════════════════════════
// Shifts API Route
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';

export async function GET() {
  const shifts = [
    {
      id: 'shift-1',
      cashier_id: 'cashier-001',
      cashier_name: 'Ravi (Cashier)',
      opened_at: new Date(Date.now() - 4 * 3600000).toISOString(),
      closed_at: null,
      opening_cash: 5000,
      closing_cash: null,
      expected_cash: 12400,
      cash_sales_total: 7400,
      upi_sales_total: 3200,
      card_sales_total: 1800,
      total_sales: 12400,
      total_items: 83,
      total_transactions: 28,
      discrepancy: null,
      discrepancy_reason: null,
      status: 'OPEN',
      created_at: new Date(Date.now() - 4 * 3600000).toISOString(),
    },
  ];

  return NextResponse.json({ success: true, data: shifts });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json({
      success: true,
      data: {
        id: `shift-${Date.now()}`,
        ...body,
        status: 'OPEN',
        opened_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: 'Failed to create shift' }, { status: 500 });
  }
}
