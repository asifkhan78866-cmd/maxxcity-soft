// ═══════════════════════════════════════
// Next.js Proxy — page-level auth guard
// ═══════════════════════════════════════
// (Proxy is what Middleware is called from Next.js 16 onward.)
//
// This is an OPTIMISTIC check that keeps signed-out or under-privileged users
// from loading a page they cannot use. It is NOT the security boundary:
// every API route independently authorises the caller in the handler itself
// (lib/auth/guard.ts), so hitting an admin URL directly is rejected there
// regardless of what happens here.
//
// The session cookie is HMAC-signed; a client that edits its role fails
// verification and is treated as signed out.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { canAccessRoute, landingRouteFor } from '@/lib/auth/rbac';

/** Paths reachable without a session. */
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/pin-login',
  '/api/auth/email-login',
  '/api/auth/logout',
  '/api/auth/bootstrap',
  '/api/health',
];

/** Assets that must load before sign-in (PWA shell, icons). */
const PUBLIC_FILES = ['/manifest.webmanifest', '/sw.js', '/offline.html', '/favicon.ico'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_FILES.includes(pathname)) return true;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    // API callers get a JSON 401; a redirect would be unhelpful to fetch().
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 }
      );
    }

    const loginUrl = new URL('/login', request.url);
    if (pathname !== '/') loginUrl.searchParams.set('redirect', pathname);

    const response = NextResponse.redirect(loginUrl);
    // Clear an expired or tampered cookie so the browser stops resending it.
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // API authorisation happens in the route handlers, which know the specific
  // permission each operation needs. Do not second-guess it here.
  if (pathname.startsWith('/api/')) return NextResponse.next();

  if (!canAccessRoute(session.role, pathname)) {
    return NextResponse.redirect(new URL(landingRouteFor(session.role), request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    '/((?!_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json|webmanifest)$).*)',
  ],
};
