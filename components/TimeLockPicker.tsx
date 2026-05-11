'use client';

import { useMemo } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

interface TimeLockPickerProps {
  /** Epoch ms, or undefined when the user hasn't picked a time yet. */
  value?: number;
  /** Emits the selected unlock time as epoch ms, or undefined if cleared. */
  onChange: (unlockAt: number | undefined) => void;
  /**
   * The video's expiration timestamp (epoch ms). The unlock time must be
   * strictly less than this so the video is watchable for at least an
   * instant after unlocking.
   */
  expirationTimestamp: number;
  disabled?: boolean;
}

/**
 * Convert an epoch-ms timestamp to a string suitable for a
 * <input type="datetime-local"> field. The input expects `YYYY-MM-DDTHH:mm`
 * in the user's *local* timezone and has no timezone indicator.
 */
function toDatetimeLocal(epochMs: number): string {
  const d = new Date(epochMs);
  // Offset into the user's local timezone, then strip the trailing
  // seconds/ms/timezone so the browser accepts the value.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Format a positive millisecond duration as a human-readable countdown.
 * Shows two meaningful units (e.g. "3 days, 2 hours", "5 minutes, 10 seconds").
 */
function formatCountdown(deltaMs: number): string {
  if (deltaMs <= 0) return 'now';

  const totalSeconds = Math.floor(deltaMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const unit = (n: number, label: string) =>
    `${n} ${label}${n === 1 ? '' : 's'}`;

  if (days > 0) return `${unit(days, 'day')}, ${unit(hours, 'hour')}`;
  if (hours > 0) return `${unit(hours, 'hour')}, ${unit(minutes, 'minute')}`;
  if (minutes > 0) return `${unit(minutes, 'minute')}, ${unit(seconds, 'second')}`;
  return unit(seconds, 'second');
}

/**
 * Pure controlled datetime picker for the Time Lock access mode. Emits an
 * epoch-ms timestamp via onChange and validates that the chosen time is:
 *   - strictly greater than `Date.now()` (future)
 *   - strictly less than `expirationTimestamp` (before the video expires)
 *
 * Presentational only — no hooks beyond `useMemo` for derived display
 * values. Validation is re-evaluated on every render so parents can pass
 * a `value` that was valid at paint time and becomes invalid later (e.g.
 * user sat on the form for an hour); the inline error will still surface.
 */
export default function TimeLockPicker({
  value,
  onChange,
  expirationTimestamp,
  disabled = false,
}: TimeLockPickerProps) {
  const now = Date.now();

  const { inputValue, validationError, countdownLabel } = useMemo(() => {
    if (value === undefined) {
      return { inputValue: '', validationError: null, countdownLabel: null };
    }

    const inputStr = toDatetimeLocal(value);

    let error: string | null = null;
    if (value <= now) {
      error = 'Unlock time must be in the future';
    } else if (value >= expirationTimestamp) {
      error = 'Unlock time must be before the video expires';
    }

    const countdown =
      error === null && value > now
        ? `Unlocks in ${formatCountdown(value - now)}`
        : null;

    return {
      inputValue: inputStr,
      validationError: error,
      countdownLabel: countdown,
    };
  }, [value, now, expirationTimestamp]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const str = e.target.value;
    if (!str) {
      onChange(undefined);
      return;
    }
    const parsed = new Date(str).getTime();
    if (Number.isNaN(parsed)) {
      onChange(undefined);
      return;
    }
    onChange(parsed);
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
        Unlock Time <span className="text-brand-red">*</span>
      </label>

      <div className="relative">
        <input
          type="datetime-local"
          value={inputValue}
          onChange={handleChange}
          disabled={disabled}
          className={`w-full px-4 py-3 pr-12 bg-zinc-900/60 border rounded-xl text-white
            placeholder-zinc-600 focus:outline-none focus:ring-1 transition-colors text-sm
            disabled:opacity-50
            [color-scheme:dark]
            ${validationError
              ? 'border-brand-red focus:border-brand-red focus:ring-brand-red'
              : 'border-zinc-800 focus:border-brand-red focus:ring-brand-red'
            }`}
        />
        <ClockIcon className="absolute right-4 top-3.5 w-4 h-4 text-zinc-600 pointer-events-none" />
      </div>

      {validationError && (
        <p className="text-[11px] text-brand-red font-medium">
          ⚠️ {validationError}
        </p>
      )}

      {countdownLabel && !validationError && (
        <p className="text-[11px] text-zinc-400 font-medium">
          ⏱️ {countdownLabel}
        </p>
      )}

      {value === undefined && (
        <p className="text-[11px] text-zinc-500 font-medium">
          Pick a future date and time when the video becomes watchable.
        </p>
      )}
    </div>
  );
}
