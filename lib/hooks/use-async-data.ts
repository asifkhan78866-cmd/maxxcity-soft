'use client';

// ═══════════════════════════════════════
// useAsyncData
// ═══════════════════════════════════════
// One implementation of "load data for this screen, show a spinner, let the
// page reload after a mutation" — replacing the same twenty lines repeated on
// every admin page.
//
// The fetch is driven from a promise chain inside the effect rather than by
// awaiting a called async function. That is not a style preference: React's
// lint rules flag the latter because it puts a synchronous setState in the
// effect body, which cascades an extra render on every mount. The chain form
// settles state in a callback instead.
//
// `loading` is derived by comparing the token that settled against the current
// one, so a filter change shows the spinner again without any extra state.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError } from '@/lib/api-client';

export interface AsyncDataResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-run the fetcher — call after a mutation. */
  refresh: () => void;
  /** Patch the data locally, e.g. for an optimistic update. */
  setData: (value: T | null) => void;
}

function messageOf(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong while loading this data.';
}

/**
 * @param fetcher MUST be memoised with useCallback. Its identity is the cache
 *                key: change it (by changing a filter) and the data reloads.
 */
export function useAsyncData<T>(fetcher: () => Promise<T>): AsyncDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [settledToken, setSettledToken] = useState<object | null>(null);

  // A fresh object identity per intended load — a new fetcher, or an explicit
  // refresh. The dependencies are the whole point (the memo exists to change
  // identity when they do), so the "unnecessary dependency" lint hint does not
  // apply here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const token = useMemo(() => ({}), [fetcher, nonce]);

  useEffect(() => {
    let active = true;

    fetcher()
      .then((result) => {
        if (!active) return;
        setData(result);
        setError(null);
      })
      .catch((cause) => {
        if (!active) return;
        setError(messageOf(cause));
      })
      .finally(() => {
        if (active) setSettledToken(token);
      });

    // Guards against a slow response from a previous filter overwriting a
    // newer one, and against setting state after unmount.
    return () => {
      active = false;
    };
  }, [fetcher, token]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading: settledToken !== token, refresh, setData };
}
