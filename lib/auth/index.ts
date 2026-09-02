// ═══════════════════════════════════════
// lib/auth — Authentication & Authorization
// ═══════════════════════════════════════

export { hashSecret, verifySecret, randomToken } from './crypto';

export {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  isSessionSecretConfigured,
  type SessionPayload,
} from './session';

export {
  ROLE_PERMISSIONS,
  ROUTE_RULES,
  MAX_DISCOUNT_FRACTION,
  MAX_DISCOUNT_ABSOLUTE,
  hasPermission,
  hasAnyPermission,
  maxDiscountFor,
  canAccessRoute,
  landingRouteFor,
  type Permission,
} from './rbac';

export {
  ApiError,
  getSession,
  requireAuth,
  requirePermission,
  requireAnyPermission,
  withAuth,
  withPermission,
  ok,
  fail,
  handleApiError,
} from './guard';
