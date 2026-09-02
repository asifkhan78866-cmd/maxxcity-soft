'use client';

// ═══════════════════════════════════════
// Connectivity & Terminal Identity
// ═══════════════════════════════════════
// Both of these are external, browser-owned values, so they are read through
// useSyncExternalStore. That gives a server snapshot for SSR (avoiding a
// hydration mismatch), keeps the value out of an effect, and means the POS
// never renders a stale online/offline badge.

import { useSyncExternalStore } from 'react';
import { getTerminalId } from '@/lib/config/store';

function subscribeToConnectivity(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** Live online/offline status. Assumes online during SSR. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true
  );
}

// The terminal id never changes for the life of the tab, so there is nothing
// to subscribe to — but resolving it through the same API keeps it out of a
// ref read during render, and gives SSR a stable placeholder.
const noopSubscribe = () => () => {};

let cachedTerminalId: string | null = null;

/** This terminal's id. Empty string during SSR. */
export function useTerminalId(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => {
      // Cached so getSnapshot returns a stable reference — returning a fresh
      // value each call would make React loop.
      if (cachedTerminalId === null) cachedTerminalId = getTerminalId();
      return cachedTerminalId;
    },
    () => ''
  );
}
