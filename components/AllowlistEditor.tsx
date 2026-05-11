'use client';

import { useState } from 'react';
import { XMarkIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import { formatAddress } from '@/lib/aptos';

interface AllowlistEditorProps {
  /** Current allowlist (already lowercased, deduplicated, sorted). */
  value: string[];
  /** Emits the new allowlist (lowercased, deduplicated, sorted). */
  onChange: (addresses: string[]) => void;
  disabled?: boolean;
}

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{1,64}$/;

/**
 * Normalize a list of addresses: lowercase, deduplicate, sort ascending.
 * Keeps the UI state and the on-wire representation in one canonical form
 * so downstream comparisons are trivially case-insensitive.
 */
function normalize(addresses: string[]): string[] {
  return Array.from(new Set(addresses.map((a) => a.toLowerCase()))).sort();
}

/**
 * Chip-style address input for the Allowlist access mode. Validates each
 * entry against the Aptos address regex, lowercases, deduplicates and
 * sorts before emitting via onChange. Invalid entries render an inline
 * error and are not added.
 *
 * Accepts single or comma / whitespace / newline separated input so users
 * can paste a batch of addresses at once.
 */
export default function AllowlistEditor({
  value,
  onChange,
  disabled = false,
}: AllowlistEditorProps) {
  const [inputValue, setInputValue] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const commitInput = () => {
    const raw = inputValue.trim();
    if (!raw) return;

    // Support pasting comma / whitespace / newline separated lists.
    const candidates = raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const nextErrors: string[] = [];
    const validated: string[] = [];

    for (const candidate of candidates) {
      if (ADDRESS_REGEX.test(candidate)) {
        validated.push(candidate.toLowerCase());
      } else {
        nextErrors.push(candidate);
      }
    }

    if (validated.length > 0) {
      onChange(normalize([...value, ...validated]));
    }

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      // Preserve the invalid fragments in the input so the user can fix
      // them without retyping. Strip the ones we accepted.
      setInputValue(nextErrors.join(', '));
    } else {
      setErrors([]);
      setInputValue('');
    }
  };

  const removeAddress = (addr: string) => {
    onChange(value.filter((a) => a !== addr));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeAddress(value[value.length - 1]);
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-xs font-black uppercase tracking-widest text-zinc-400">
        Allowlist <span className="text-brand-red">*</span>
      </label>

      {/* Chips */}
      <div
        className={`min-h-[56px] px-3 py-2.5 bg-zinc-900/60 border rounded-xl
          ${errors.length > 0 ? 'border-brand-red' : 'border-zinc-800'}
          ${disabled ? 'opacity-50' : ''}`}
      >
        {value.length === 0 ? (
          <p className="text-xs text-zinc-500 py-2 px-1">
            No addresses added yet
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {value.map((addr) => (
              <span
                key={addr}
                title={addr}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-purple/20 border border-brand-purple/40 text-white rounded-full text-xs font-mono"
              >
                {formatAddress(addr)}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAddress(addr)}
                    aria-label={`Remove ${addr}`}
                    className="hover:bg-brand-purple/40 rounded-full p-0.5 transition-colors"
                  >
                    <XMarkIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            if (errors.length > 0) setErrors([]);
          }}
          onKeyDown={handleKeyDown}
          onBlur={commitInput}
          placeholder="0x... (press Enter, comma, or paste multiple)"
          disabled={disabled}
          spellCheck={false}
          className={`w-full px-4 py-3 pr-12 bg-zinc-900/60 border rounded-xl text-white
            placeholder-zinc-600 focus:outline-none focus:ring-1 transition-colors text-sm font-mono
            disabled:opacity-50
            ${errors.length > 0
              ? 'border-brand-red focus:border-brand-red focus:ring-brand-red'
              : 'border-zinc-800 focus:border-brand-purple focus:ring-brand-purple'
            }`}
        />
        <UserPlusIcon className="absolute right-4 top-3.5 w-4 h-4 text-zinc-600 pointer-events-none" />
      </div>

      {errors.length > 0 && (
        <p className="text-[11px] text-brand-red font-medium">
          ⚠️ Invalid address{errors.length > 1 ? 'es' : ''}:{' '}
          <span className="font-mono">
            {errors.map((e) => (e.length > 20 ? `${e.slice(0, 20)}…` : e)).join(', ')}
          </span>
        </p>
      )}

      <p className="text-[11px] text-zinc-500 font-medium">
        {value.length} {value.length === 1 ? 'address' : 'addresses'} on allowlist
      </p>
    </div>
  );
}
