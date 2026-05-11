'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccessResult } from '@/types';

// ---------------------------------------------------------------------------
// useVideoAccess
//
// Wraps a single `GET /api/videos/:id/access?wallet=...` call with
// SWR-style semantics using plain React hooks. The project deliberately
// avoids SWR / react-query (see design.md § Hooks), so this hook is the
// one place that deals with fetch lifecycle for the access endpoint.
//
// Contract (Req 7.1, 7.6):
//  - Fires once on mount.
//  - Re-runs whenever `videoId` or `wallet` changes.
//  - `wallet` is optional. When missing, null, or blank the query param
//    is omitted entirely so the server resolves the caller as anonymous
//    (matches the behaviour documented in the access route).
//  - In-flight requests are aborted on unmount or when inputs change, so
//    a stale response can never overwrite a newer one.
//  - `refetch()` forces a re-run without changing the inputs. Used by
//    VideoPlayer after a successful purchase so the gate disappears
//    without a full page reload (see task 5.6 in tasks.md).
// ---------------------------------------------------------------------------

export interface UseVideoAccessResult {
  loading: boolean;
  access: AccessResult | null;
  error: string | null;
  refetch: () => void;
}

export function useVideoAccess(
  videoId: string,
  wallet: string | null | undefined,
): UseVideoAccessResult {
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(videoId));
  const [error, setError] = useState<string | null>(null);

  // Bumped by `refetch()` to retrigger the effect without altering inputs.
  const [refetchCounter, setRefetchCounter] = useState(0);

  // Tracks the live AbortController so we can cancel an in-flight request
  // when videoId/wallet change or the component unmounts.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Guard against empty ids — nothing to fetch, clear state.
    if (!videoId) {
      setAccess(null);
      setError(null);
      setLoading(false);
      return;
    }

    // Cancel any previous in-flight request before starting a new one.
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    // Normalise the wallet input. The server already handles mixed-case
    // and whitespace defensively, but omitting the param for blank input
    // keeps the URL clean and makes anonymous resolution unambiguous.
    const trimmedWallet =
      typeof wallet === 'string' ? wallet.trim() : '';

    const url =
      trimmedWallet.length > 0
        ? `/api/videos/${encodeURIComponent(videoId)}/access?wallet=${encodeURIComponent(trimmedWallet)}`
        : `/api/videos/${encodeURIComponent(videoId)}/access`;

    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          // Default `no-store` semantics are what we want — access flips
          // (e.g. the owner removing someone from the allowlist) must be
          // reflected on the next mount without any cached staleness.
          cache: 'no-store',
        });

        if (!res.ok) {
          // Try to surface the server's error message when present, but
          // never throw on a malformed error body — we still want a
          // sensible string for the UI.
          let message = `Access check failed (HTTP ${res.status})`;
          try {
            const body = await res.json();
            if (body && typeof body.error === 'string') {
              message = body.error;
            }
          } catch {
            // ignore JSON parse errors on error responses
          }
          if (!controller.signal.aborted) {
            setAccess(null);
            setError(message);
            setLoading(false);
          }
          return;
        }

        const data = (await res.json()) as AccessResult;
        if (!controller.signal.aborted) {
          setAccess(data);
          setError(null);
          setLoading(false);
        }
      } catch (err: unknown) {
        // Aborts are expected when inputs change — don't surface as error.
        if (
          (err instanceof DOMException && err.name === 'AbortError') ||
          controller.signal.aborted
        ) {
          return;
        }
        console.error('useVideoAccess fetch error:', err);
        setAccess(null);
        setError(
          err instanceof Error
            ? err.message
            : 'Network error while checking access',
        );
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [videoId, wallet, refetchCounter]);

  const refetch = useCallback(() => {
    setRefetchCounter((n) => n + 1);
  }, []);

  return { loading, access, error, refetch };
}

export default useVideoAccess;
