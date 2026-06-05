// ═══════════════════════════════════════
// PIN Login API Route
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { pin } = await request.json();

    if (!pin || pin.length !== 4) {
      return NextResponse.json(
        { success: false, error: 'Invalid PIN format' },
        { status: 400 }
      );
    }

    // In production, this would query Supabase and compare hashed PINs.
    // For demo/development, we use hardcoded PINs:
    const demoUsers: Record<string, { id: string; name: string; role: string }> = {
      '1234': { id: 'cashier-001', name: 'Ravi (Cashier)', role: 'CASHIER' },
      '5678': { id: 'manager-001', name: 'Priya (Manager)', role: 'MANAGER' },
      '0000': { id: 'admin-001', name: 'Syed (Owner)', role: 'ADMIN' },
    };

    const user = demoUsers[pin];
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Invalid PIN. Please try again.' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      user,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}
