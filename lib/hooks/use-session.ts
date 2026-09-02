'use client';

// ═══════════════════════════════════════
// Session Hook
// ═══════════════════════════════════════
// Reads identity and permissions from /api/auth/me. The session cookie is
// httpOnly, so the client CANNOT read or edit its own role — it asks the
// server. Anything gated on `can()` here is a UI affordance; the real check
// happens again in the route handler.

import { useCallback, useEffect, useState } from 'react';
import type { UserRole } from '@/types';
import type { Permission } from '@/lib/auth/rbac';

export interface SessionUser {
  id: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  maxDiscountFraction: number;
  expiresAt: string;
}

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;

    // Promise chain rather than an awaited async call: state settles in a
    // callback instead of synchronously inside the effect body.
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!active) return;
        setUser(json?.success ? (json.data as SessionUser) : null);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const can = useCallback(
    (permission: Permission) => user?.permissions.includes(permission) ?? false,
    [user]
  );

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }, []);

  return { user, loading, can, refresh, logout };
}
