'use client';

// ═══════════════════════════════════════
// Service Worker Registration
// ═══════════════════════════════════════
// Registers the PWA service worker so the POS shell keeps loading through an
// internet interruption. Registration failure is non-fatal: the app works
// normally without it, it just loses the offline shell.

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    // In development the SW mostly gets in the way of hot reload.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('Service worker registration failed — offline shell unavailable', error);
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register);

    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
