'use client';

import { useEffect, useState } from 'react';

/**
 * PlaybackWatermark — forensic overlay for the player frame.
 *
 * Every decoded frame is trivially re-capturable (screen recording, phone
 * camera, DevTools replay), so the protection we can actually enforce is
 * attribution: a visible "SHELBYFLIX · 0x1234…abcd" stamp that survives
 * being recorded. Anonymous viewers get the brand-only stamp.
 *
 * The stamp rotates clockwise through the four frame corners every
 * `intervalMs` with a short fade, so a viewer can't crop a single fixed
 * region out of a recording without losing video content.
 */

const CORNER_CLASSES = [
  'top-3 right-3',
  'bottom-3 right-3',
  'bottom-3 left-3',
  'top-3 left-3',
] as const;

const DEFAULT_INTERVAL_MS = 10_000;
// Keep the literal Tailwind class below in sync with this (JIT can't see
// interpolated class names).
const FADE_MS = 300;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface PlaybackWatermarkProps {
  /** Viewer's wallet; when absent the stamp is brand-only. */
  walletAddress?: string | null;
  /** Rotation period. Overridable for tests. */
  intervalMs?: number;
}

export function PlaybackWatermark({
  walletAddress,
  intervalMs = DEFAULT_INTERVAL_MS,
}: PlaybackWatermarkProps) {
  const [cornerIdx, setCornerIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let swapTimer: ReturnType<typeof setTimeout> | undefined;
    const rotate = setInterval(() => {
      setVisible(false);
      swapTimer = setTimeout(() => {
        setCornerIdx((i) => (i + 1) % CORNER_CLASSES.length);
        setVisible(true);
      }, FADE_MS);
    }, intervalMs);

    return () => {
      clearInterval(rotate);
      if (swapTimer !== undefined) clearTimeout(swapTimer);
    };
  }, [intervalMs]);

  return (
    <div
      aria-hidden="true"
      data-testid="playback-watermark"
      className={[
        'pointer-events-none absolute z-10 select-none text-[10px] leading-none text-white/60',
        'drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]',
        'transition-opacity ease-out duration-300',
        CORNER_CLASSES[cornerIdx],
        visible ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
    >
      <span className="font-black uppercase tracking-[0.18em]">Shelbyflix</span>
      {walletAddress ? (
        <>
          <span className="mx-1.5 font-black text-white/40">·</span>
          <span className="font-medium tracking-tight">
            {shortAddress(walletAddress.toLowerCase())}
          </span>
        </>
      ) : null}
    </div>
  );
}

export default PlaybackWatermark;
