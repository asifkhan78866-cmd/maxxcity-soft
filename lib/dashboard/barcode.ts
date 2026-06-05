// ═══════════════════════════════════════
// Barcode Scanner Hook
// ═══════════════════════════════════════

'use client';

import { useEffect, useCallback, useRef } from 'react';

interface UseBarcodeOptions {
  onScan: (barcode: string) => void;
  onManualInput?: (value: string) => void;
  enabled?: boolean;
}

export function useBarcodeScanner({
  onScan,
  onManualInput,
  enabled = true,
}: UseBarcodeOptions) {
  const bufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);
  const isRapidRef = useRef<boolean>(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetBuffer = useCallback(() => {
    bufferRef.current = '';
    isRapidRef.current = true;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys and non-printable keys
      if (e.key.length !== 1 && e.key !== 'Enter') return;
      
      const target = e.target as HTMLElement;
      // Let standard inputs handle their own typing, unless it's the barcode field
      if (
        target.getAttribute('data-barcode-input') !== 'true' &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastKeyTimeRef.current;
      lastKeyTimeRef.current = now;

      // Clear any pending timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const value = bufferRef.current.trim();
        
        if (value.length > 0) {
          if (isRapidRef.current) {
            // Treat as barcode scan
            onScan(value);
          } else if (onManualInput) {
            // Treat as manual search if too slow
            onManualInput(value);
          }
        }
        resetBuffer();
        return;
      }

      // Check for > 50ms gap between keystrokes
      if (bufferRef.current.length > 0 && timeDiff > 50) {
        isRapidRef.current = false;
      }

      bufferRef.current += e.key;

      // On timeout (>100ms gap): treat as manual if they stop typing without hitting Enter
      timeoutRef.current = setTimeout(() => {
        if (bufferRef.current.length > 0 && onManualInput) {
          onManualInput(bufferRef.current);
        }
        resetBuffer();
      }, 100);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, onScan, onManualInput, resetBuffer]);

  return { resetBuffer };
}

