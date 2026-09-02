// ═══════════════════════════════════════
// API Route Guards
// ═══════════════════════════════════════
// Server-side authorization. Route handlers call requireAuth / requirePermission
// FIRST — before reading a body or touching the database.
//
// Proxy (proxy.ts) redirects unauthenticated page loads, but it is only an
// optimistic check: a request straight to an API URL is authorized here.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken, type SessionPayload } from './session';
import { hasPermission, type Permission } from './rbac';

export type { SessionPayload };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'ERROR',
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Read and verify the current session. Returns null when unauthenticated. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Require a valid session. Throws ApiError(401) otherwise. */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new ApiError(401, 'Authentication required', 'UNAUTHENTICATED');
  }
  return session;
}

/** Require a valid session holding a specific permission. */
export async function requirePermission(permission: Permission): Promise<SessionPayload> {
  const session = await requireAuth();
  if (!hasPermission(session.role, permission)) {
    throw new ApiError(
      403,
      `Your role (${session.role}) is not permitted to perform this action`,
      'FORBIDDEN'
    );
  }
  return session;
}

/** Require any one of several permissions. */
export async function requireAnyPermission(permissions: Permission[]): Promise<SessionPayload> {
  const session = await requireAuth();
  if (!permissions.some((p) => hasPermission(session.role, p))) {
    throw new ApiError(
      403,
      `Your role (${session.role}) is not permitted to perform this action`,
      'FORBIDDEN'
    );
  }
  return session;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: string;
  code: string;
  details?: unknown;
}

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ success: true as const, data }, { status });
}

export function fail(
  message: string,
  status = 400,
  code = 'ERROR',
  details?: unknown
): NextResponse<ApiFailure> {
  return NextResponse.json({ success: false as const, error: message, code, details }, { status });
}

/**
 * Convert a thrown error into a safe API response.
 *
 * Internal error text (database messages, stack traces) is logged but never
 * returned to the client — it can disclose schema details.
 */
export function handleApiError(error: unknown, context: string): NextResponse<ApiFailure> {
  if (error instanceof ApiError) {
    return fail(error.message, error.status, error.code, error.details);
  }

  // Zod validation failure from parseOrThrow — safe to surface, it describes
  // the caller's own input rather than anything internal.
  if (error instanceof Error && (error as { isValidationError?: boolean }).isValidationError) {
    return fail(error.message, 422, 'VALIDATION_ERROR', {
      fields: (error as { fieldErrors?: Record<string, string> }).fieldErrors,
    });
  }

  // Business rules raised inside a Postgres RPC arrive as `CODE: message`.
  // The code half is a deliberate, user-facing contract, so pass it through.
  const pgMessage = extractPostgresBusinessError(error);
  if (pgMessage) {
    return fail(pgMessage.message, 409, pgMessage.code);
  }

  console.error(`[${context}]`, error);

  return fail(
    'An unexpected server error occurred. Please try again.',
    500,
    'INTERNAL_ERROR'
  );
}

/** Business error codes the database RPCs raise deliberately. */
const RPC_ERROR_CODES = new Set([
  'EMPTY_CART',
  'INVALID_PAYMENT_METHOD',
  'INVALID_QTY',
  'INVALID_DISCOUNT',
  'INVALID_REFUND_METHOD',
  'INVALID_MOVEMENT_TYPE',
  'INVALID_CLOSING_CASH',
  'INSUFFICIENT_STOCK',
  'INSUFFICIENT_CASH',
  'NEGATIVE_STOCK',
  'PRODUCT_NOT_FOUND',
  'PRODUCT_INACTIVE',
  'PRICE_MISMATCH',
  'INVALID_GST_RATE',
  'SHIFT_NOT_FOUND',
  'SHIFT_CLOSED',
  'SHIFT_ALREADY_CLOSED',
  'SALE_NOT_FOUND',
  'SALE_VOIDED',
  'ALREADY_VOID',
  'HAS_RETURNS',
  'REASON_REQUIRED',
  'EMPTY_RETURN',
  'ITEM_NOT_ON_SALE',
  'EXCESS_RETURN',
  'ZERO_ADJUSTMENT',
  'PO_NOT_FOUND',
  'PO_CANCELLED',
  'PO_ITEM_NOT_FOUND',
  'OVER_RECEIPT',
]);

function extractPostgresBusinessError(
  error: unknown
): { code: string; message: string } | null {
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  const match = raw.match(/^([A-Z_]+):\s*(.+)$/s);
  if (!match) return null;
  const [, code, message] = match;
  if (!RPC_ERROR_CODES.has(code)) return null;
  return { code, message: message.trim() };
}

/**
 * Wrap a route handler with auth, permission checking and error handling.
 *
 *   export const POST = withPermission('sale.void', async (req, session) => { … });
 */
export function withPermission<T extends unknown[]>(
  permission: Permission,
  handler: (request: Request, session: SessionPayload, ...rest: T) => Promise<NextResponse>,
  context = 'api'
) {
  return async (request: Request, ...rest: T): Promise<NextResponse> => {
    try {
      const session = await requirePermission(permission);
      return await handler(request, session, ...rest);
    } catch (error) {
      return handleApiError(error, context);
    }
  };
}

/** Same as withPermission but only requires an authenticated session. */
export function withAuth<T extends unknown[]>(
  handler: (request: Request, session: SessionPayload, ...rest: T) => Promise<NextResponse>,
  context = 'api'
) {
  return async (request: Request, ...rest: T): Promise<NextResponse> => {
    try {
      const session = await requireAuth();
      return await handler(request, session, ...rest);
    } catch (error) {
      return handleApiError(error, context);
    }
  };
}
