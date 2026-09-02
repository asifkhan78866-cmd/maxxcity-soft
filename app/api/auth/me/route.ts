// ═══════════════════════════════════════
// Current Session
// ═══════════════════════════════════════
// The client reads its identity, role and permissions from here rather than
// from a cookie it can edit.

import { getSession, ok, fail } from '@/lib/auth';
import { ROLE_PERMISSIONS, MAX_DISCOUNT_FRACTION } from '@/lib/auth/rbac';

export async function GET() {
  const session = await getSession();

  if (!session) {
    return fail('Not signed in', 401, 'UNAUTHENTICATED');
  }

  return ok({
    id: session.sub,
    name: session.name,
    role: session.role,
    permissions: Array.from(ROLE_PERMISSIONS[session.role]),
    maxDiscountFraction: MAX_DISCOUNT_FRACTION[session.role],
    expiresAt: new Date(session.exp * 1000).toISOString(),
  });
}
