'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XMarkIcon, LinkIcon, CheckIcon } from '@heroicons/react/24/outline';

/**
 * ShareModal
 *
 * Social share sheet for a video. Opens a set of platform intents in a popup
 * and keeps a copy-link fallback, because platform intents are popup-based and
 * popups get blocked — silently doing nothing is a bad experience, so we fall
 * back to same-tab navigation and say so.
 *
 * Styling follows the app's existing modal language (see DeleteVideoModal):
 * `bg-zinc-950` panel, `border-zinc-800`, `rounded-3xl`, blurred backdrop,
 * `font-black` headings with uppercase tracking-widest kickers.
 */

interface ShareTarget {
  id: string;
  /** Shown under the tile. */
  label: string;
  /** Short glyph drawn inside the coloured tile. */
  mark: string;
  /** Tailwind classes for the tile. */
  tile: string;
  href: (url: string, title: string) => string;
  /** Platform intents open in a popup; mailto navigates the current tab. */
  popup: boolean;
}

const SHARE_TARGETS: ShareTarget[] = [
  {
    id: 'x',
    label: 'X',
    mark: 'X',
    tile: 'bg-black text-white border-zinc-700',
    popup: true,
    href: (url, title) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    mark: 'f',
    tile: 'bg-[#1877F2] text-white border-[#1877F2]/40',
    popup: true,
    href: (url) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    mark: 'W',
    tile: 'bg-[#25D366] text-zinc-950 border-[#25D366]/40',
    popup: true,
    href: (url, title) =>
      `https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    mark: 'T',
    tile: 'bg-[#229ED9] text-white border-[#229ED9]/40',
    popup: true,
    href: (url, title) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    mark: 'R',
    tile: 'bg-[#FF4500] text-white border-[#FF4500]/40',
    popup: true,
    href: (url, title) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    mark: 'in',
    tile: 'bg-[#0A66C2] text-white border-[#0A66C2]/40',
    popup: true,
    href: (url) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: 'email',
    label: 'Email',
    mark: '@',
    tile: 'bg-zinc-800 text-zinc-200 border-zinc-700',
    popup: false,
    href: (url, title) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`,
  },
];

interface ShareModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Absolute URL to share. */
  url: string;
}

export default function ShareModal({ open, onClose, title, url }: ShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);

  // Reset transient state each time the sheet opens.
  useEffect(() => {
    if (open) {
      setCopied(false);
      setPopupBlocked(false);
    }
  }, [open]);

  // Move focus into the dialog, and hand it back to the trigger on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();
    return () => {
      const el = restoreFocusRef.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [open]);

  // Escape to dismiss.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const shareText = useMemo(
    () => (title.trim() ? title.trim() : 'Watch this on Shelbyflix'),
    [title],
  );

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context, or permission denied). Show the
      // URL so it can still be selected manually rather than failing silently.
      setCopied(false);
      setPopupBlocked(true);
    }
  }, [url]);

  const onShare = useCallback(
    (target: ShareTarget) => {
      const href = target.href(url, shareText);

      if (!target.popup) {
        window.location.href = href;
        return;
      }

      const features = 'width=640,height=560,menubar=no,toolbar=no,location=no,status=no';
      // Opened without `noopener` in the feature string: that makes Chrome
      // return null *by design*, which would make us mistake a real popup for
      // a blocked one. We sever the opener reference manually instead.
      const w = window.open(href, '_blank', features);
      if (w) {
        w.opener = null;
        setPopupBlocked(false);
      } else {
        setPopupBlocked(true);
      }
    },
    [url, shareText],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
        className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Close button */}
        <button
          ref={closeButtonRef}
          onClick={onClose}
          aria-label="Close share dialog"
          className="absolute top-4 right-4 w-8 h-8 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors z-10"
        >
          <XMarkIcon className="w-4 h-4 text-zinc-400" />
        </button>

        {/* Header */}
        <div className="bg-zinc-900/60 border-b border-zinc-800 px-6 pt-6 pb-5">
          <h2
            id="share-modal-title"
            className="text-white font-black text-lg tracking-tight"
          >
            Share
          </h2>
          <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mt-0.5">
            Send this video anywhere
          </p>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Video preview */}
          <div className="min-w-0">
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-1.5">
              Sharing
            </p>
            <p className="text-white font-bold text-sm line-clamp-2 leading-snug">
              {shareText}
            </p>
          </div>

          {/* Social targets */}
          <div className="grid grid-cols-4 gap-3">
            {SHARE_TARGETS.map((target) => (
              <button
                key={target.id}
                onClick={() => onShare(target)}
                className="group flex flex-col items-center gap-2"
                aria-label={`Share on ${target.label}`}
              >
                <span
                  className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-lg font-black transition-transform group-hover:scale-105 group-focus-visible:scale-105 ${target.tile}`}
                >
                  {target.mark}
                </span>
                <span className="text-zinc-500 text-[11px] font-bold truncate w-full text-center">
                  {target.label}
                </span>
              </button>
            ))}
          </div>

          {/* Copy link */}
          <div className="pt-1">
            <button
              onClick={copyLink}
              className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900/60 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-2xl transition-colors text-left"
            >
              <span className="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center flex-shrink-0">
                {copied ? (
                  <CheckIcon className="w-4 h-4 text-green-400" />
                ) : (
                  <LinkIcon className="w-4 h-4 text-zinc-400" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-white font-bold text-sm">
                  {copied ? 'Link copied!' : 'Copy link'}
                </span>
                <span className="block text-zinc-500 text-xs truncate">
                  {url}
                </span>
              </span>
            </button>
          </div>

          {/* Popup / clipboard failure notice — platform intents and the
              clipboard are both blocked silently by some browsers, so say so
              rather than appearing to do nothing. */}
          {popupBlocked && (
            <p
              role="status"
              className="text-amber-400 text-xs leading-relaxed bg-amber-950/30 border border-amber-900/30 rounded-xl px-3 py-2"
            >
              Your browser blocked that. Allow popups for this site, or use
              “Copy link” below.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
