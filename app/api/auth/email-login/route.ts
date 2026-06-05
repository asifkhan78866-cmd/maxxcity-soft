// ═══════════════════════════════════════
// Email Login API Route
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // In production, use Supabase Auth:
    // const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    // Demo login
    if (email === 'admin@maxxcity.in' && password === 'admin123') {
      return NextResponse.json({
        success: true,
        user: {
          id: 'admin-001',
          name: 'Syed (Owner)',
          role: 'ADMIN',
          email: 'admin@maxxcity.in',
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid email or password' },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { success: false, error: 'Server error' },
      { status: 500 }
    );
  }
}
