'use client';

import type { AccessMode } from '@/types';
import {
  GlobeAltIcon,
  UserGroupIcon,
  ClockIcon,
  TicketIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

interface AccessModeSelectorProps {
  value: AccessMode;
  onChange: (mode: AccessMode) => void;
  disabled?: boolean;
}

/**
 * Pure controlled 4-option picker for video access mode. Mirrors the card
 * pattern used by VideoTypeSelector in UploadForm — bordered highlight +
 * check badge when selected. Uses brand-red as the active accent so all
 * four cards share one visual language; consumers can wrap if per-mode
 * theming is ever needed.
 *
 * Intentionally presentational: no hooks, no DB calls, no routing. Wiring
 * into UploadForm happens in task 4.4.
 */
export default function AccessModeSelector({
  value,
  onChange,
  disabled = false,
}: AccessModeSelectorProps) {
  const options: Array<{
    mode: AccessMode;
    label: string;
    description: string;
    Icon: typeof GlobeAltIcon;
  }> = [
    {
      mode: 'public',
      label: 'Public',
      description: 'Anyone can watch',
      Icon: GlobeAltIcon,
    },
    {
      mode: 'allowlist',
      label: 'Allowlist',
      description: 'Only specific wallets',
      Icon: UserGroupIcon,
    },
    {
      mode: 'timelock',
      label: 'Time Lock',
      description: 'Unlocks at a set time',
      Icon: ClockIcon,
    },
    {
      mode: 'purchasable',
      label: 'Purchasable',
      description: 'Viewers pay to unlock',
      Icon: TicketIcon,
    },
  ];

  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
        Access Mode <span className="text-brand-red">*</span>
      </label>
      <div
        role="radiogroup"
        aria-label="Access mode"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        {options.map(({ mode, label, description, Icon }) => {
          const selected = value === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(mode)}
              disabled={disabled}
              className={`relative flex flex-col items-center gap-3 p-5 rounded-2xl border-2 transition-all text-center
                disabled:opacity-50 disabled:cursor-not-allowed
                ${selected
                  ? 'border-brand-red bg-brand-red/10'
                  : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
                }`}
            >
              <div
                className={`relative w-12 h-12 rounded-xl border-2 flex items-center justify-center
                  ${selected ? 'border-brand-red' : 'border-zinc-700'}`}
              >
                <Icon
                  className={`w-6 h-6 ${selected ? 'text-brand-red' : 'text-zinc-400'}`}
                />
                {selected && (
                  <CheckCircleIcon className="absolute -top-2 -right-2 w-4 h-4 text-brand-red bg-black rounded-full" />
                )}
              </div>
              <div>
                <p
                  className={`text-sm font-black tracking-tight ${
                    selected ? 'text-white' : 'text-zinc-300'
                  }`}
                >
                  {label}
                </p>
                <p className="text-[10px] text-zinc-500 mt-1 font-medium leading-tight">
                  {description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
