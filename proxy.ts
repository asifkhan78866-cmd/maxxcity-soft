// ═══════════════════════════════════════
// Next.js Middleware — Auth + Role Guards
// ═══════════════════════════════════════

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes that don't need auth
  const publicRoutes = ['/login', '/api/health', '/api/auth'];
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Create Supabase client for middleware
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response = NextResponse.next({
              request: { headers: request.headers },
            });
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Check session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If not authenticated, redirect to login
  // Allow PIN-authenticated sessions (stored in cookie)
  const pinSession = request.cookies.get('maxxcity_pin_session');
  
  if (!user && !pinSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-based access control
  if (pinSession) {
    try {
      const session = JSON.parse(pinSession.value);
      const role = session.role;

      // Cashier can only access POS
      if (role === 'CASHIER' && pathname.startsWith('/admin')) {
        return NextResponse.redirect(new URL('/billing', request.url));
      }

      // Manager can access POS + limited admin
      if (role === 'MANAGER') {
        const managerAllowed = ['/billing', '/admin/inventory', '/admin/reports'];
        const isAllowed = managerAllowed.some((r) => pathname.startsWith(r));
        if (pathname.startsWith('/admin') && !isAllowed) {
          return NextResponse.redirect(new URL('/billing', request.url));
        }
      }
    } catch {
      // Invalid session cookie — clear it
      response.cookies.delete('maxxcity_pin_session');
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
