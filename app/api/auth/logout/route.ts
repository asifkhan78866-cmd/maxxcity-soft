// ═══════════════════════════════════════
// Logout
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE } from '@/lib/auth';
import { sessionCookieOptions } from '@/lib/auth/session';
import { logActivity, clientIp } from '@/lib/database/activity';

export async function POST(request: Request) {
  const session = await getSession();

  if (session) {
    await logActivity({
      userId: session.sub,
      userName: session.name,
      action: 'LOGOUT',
      details: `${session.role} signed out`,
      ipAddress: clientIp(request),
    });
  }

  const response = NextResponse.json({ success: true, data: { loggedOut: true } });
  // maxAge 0 expires the cookie immediately.
  response.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0));
  return response;
}
