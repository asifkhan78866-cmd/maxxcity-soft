'use client';

// ═══════════════════════════════════════
// Typed API Client
// ═══════════════════════════════════════
// One place that understands the { success, data } / { success, error, code }
// envelope, so components never have to guess whether a response failed.

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** True when retrying the same request could plausibly succeed. */
  get isTransient(): boolean {
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    // fetch() only rejects on a network-level failure.
    throw new ApiClientError(
      'Could not reach the server. Check the internet connection.',
      0,
      'NETWORK_ERROR'
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A non-JSON body (proxy error page, gateway timeout) is still a failure.
  }

  const body = payload as
    | { success: true; data: T }
    | { success: false; error: string; code: string; details?: unknown }
    | null;

  if (!response.ok || !body?.success) {
    throw new ApiClientError(
      body && 'error' in body ? body.error : `Request failed (${response.status})`,
      response.status,
      body && 'code' in body ? body.code : 'HTTP_ERROR',
      body && 'details' in body ? body.details : undefined
    );
  }

  return body.data;
}

export const api = {
  get: <T>(url: string) => request<T>(url, { method: 'GET', cache: 'no-store' }),
  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
};
