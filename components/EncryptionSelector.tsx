'use client';

import { LockClosedIcon, ArrowDownTrayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface EncryptionSelectorProps {
  value: boolean;
  onChange: (encrypted: boolean) => void;
  disabled?: boolean;
}

/**
 * Two-option picker for the upload-time encryption choice, matching the
 * card pattern used by AccessModeSelector (bordered highlight + check badge
 * when selected).
 *
 *  - encrypted (default): AES-256-GCM at upload, playback gated behind the
 *    decryption-key endpoint — viewers stream in-app, the file itself is
 *    never handed out.
 *  - unencrypted: raw bytes on storage — streamable AND downloadable by
 *    anyone with the URL, no key, no gate. The creator is warned plainly.
 */
export default function EncryptionSelector({
  value,
  onChange,
  disabled = false,
}: EncryptionSelectorProps) {
  const options: Array<{
    encrypted: boolean;
    label: string;
    description: string;
    Icon: typeof LockClosedIcon;
  }> = [
    {
      encrypted: true,
      label: 'Encrypted',
      description: 'Protected — streams only, not downloadable',
      Icon: LockClosedIcon,
    },
    {
      encrypted: false,
      label: 'Unencrypted',
      description: 'Open — anyone with the link can download it',
      Icon: ArrowDownTrayIcon,
    },
  ];

  return (
    <div>
      <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
        Encryption <span className="text-brand-red">*</span>
      </label>
      <div
        role="radiogroup"
        aria-label="Video encryption"
        className="grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {options.map(({ encrypted, label, description, Icon }) => {
          const selected = value === encrypted;
          return (
            <button
              key={String(encrypted)}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(encrypted)}
              disabled={disabled}
              className={`relative flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left
                disabled:opacity-50 disabled:cursor-not-allowed
                ${selected
                  ? 'border-brand-red bg-brand-red/10'
                  : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600'
                }`}
            >
              <div
                className={`relative w-12 h-12 rounded-xl border-2 flex items-center justify-center flex-shrink-0
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
      {!value && (
        <p className="text-[11px] text-amber-400/90 mt-2 font-medium">
          ⚠️ Unencrypted videos are stored as plain files — viewers can save or
          re-upload them anywhere. Only choose this for content you don&apos;t
          mind being copied.
        </p>
      )}
    </div>
  );
}
