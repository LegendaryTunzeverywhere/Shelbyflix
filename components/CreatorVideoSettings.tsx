'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cog6ToothIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  UserGroupIcon,
  ClockIcon,
  TicketIcon,
  GlobeAltIcon,
  CheckCircleIcon,
  ShoppingCartIcon,
  CurrencyDollarIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline';
import type { AccessMode, VideoMetadata } from '@/types';
import { useWallet } from '@/hooks/useWallet';
import { useNotification } from '@/hooks/useNotification';
import { NotificationContainer } from '@/components/NotificationToast';
import { formatAddress } from '@/lib/aptos';
import AccessModeSelector from './AccessModeSelector';
import AllowlistEditor from './AllowlistEditor';
import TimeLockPicker from './TimeLockPicker';

// ---------------------------------------------------------------------------
// CreatorVideoSettings
//
// Collapsible creator-only surface mounted on the video detail page. Lets the
// uploader:
//   - Review the current access configuration (mode + parameters)
//   - Edit access mode + mode-specific parameters (allowlist / unlockAt / price)
//   - See a live purchase count for Purchasable videos
//
// Parent is expected to guard rendering with `video.uploader === address`
// so this component never mounts for non-owners (task 4.7). As a defense-
// in-depth measure the component also compares the caller's wallet against
// `video.uploader` on mount and renders nothing if they don't match — that
// way a future caller that forgets the guard still can't leak the purchase
// list.
//
// ── Save flow ──────────────────────────────────────────────────────────────
// When the creator hits "Save changes":
//   1. Request a one-time nonce from `/api/auth/challenge?walletAddress=...`.
//   2. Ask the wallet adapter to sign the literal message
//      `"ShelbyFlix login: <nonce>"` via `useWallet().signMessage`.
//   3. PATCH `/api/videos/:id/access-config` with the signed payload plus
//      the new access config. The PATCH route re-verifies the signature
//      against the outstanding nonce; see `app/api/videos/[id]/access-config
//      /route.ts` for the server-side validation.
//
// This matches the challenge/signed-nonce pattern already used by
// `/api/auth/check-access` and the PATCH access-config route, so the app
// has a single canonical wallet-auth flow for privileged mutations.
//
// Requirements covered: 9.1, 9.2, 9.3, 9.4, 9.5.
// ---------------------------------------------------------------------------

interface CreatorVideoSettingsProps {
  video: VideoMetadata;
  walletAddress: string;
  /**
   * Sign and submit a Move entry-function transaction via the Wallet Adapter.
   * Used by the move-flag save flow to broadcast `chainTx` payloads returned
   * by the PATCH endpoint (Req 9.1, 9.5).
   */
  signAndSubmitTransaction: (payload: any) => Promise<any>;
}

interface PurchaseRow {
  wallet_address: string;
  amount_total: number;
  created_at: string;
}

interface PurchasesResponse {
  count: number;
  purchases: PurchaseRow[];
}

// SHELBYUSD uses 8 decimal places. Align with the display logic in
// UploadForm's price input so numbers the creator types match what they see
// back here.
const SUSD_DECIMALS = 8;
const SUSD_DIVISOR = 10 ** SUSD_DECIMALS;

function formatSusd(baseUnits: number): string {
  if (!Number.isFinite(baseUnits)) return '0';
  const whole = baseUnits / SUSD_DIVISOR;
  // Trim trailing zeros beyond 4 decimals for a cleaner display.
  return whole.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatUnlockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function CreatorVideoSettings({
  video,
  walletAddress,
  signAndSubmitTransaction,
}: CreatorVideoSettingsProps) {
  const { signMessage, account: walletAccount } = useWallet();
  const { notifications, success, error, remove } = useNotification();

  // ── Defense-in-depth ownership check ──────────────────────────────────
  // Parent already guards mounting; this re-check prevents a future caller
  // that forgets the guard from leaking the purchase list. `normalize` both
  // sides so a case mismatch never locks a legitimate owner out.
  const normalizedCaller = walletAddress.toLowerCase();
  const normalizedOwner = video.uploader.toLowerCase();
  const isOwner = normalizedCaller.length > 0 && normalizedCaller === normalizedOwner;

  // ── Collapse state ─────────────────────────────────────────────────────
  // Default to collapsed so the video page isn't dominated by the settings
  // panel. Expanding is one click; creators who frequently manage access
  // can persist their preference in local storage in a future iteration.
  const [expanded, setExpanded] = useState(false);

  // ── Form state ─────────────────────────────────────────────────────────
  // Seed from the current video row. Every field has a local state copy so
  // the creator can freely edit without mutating the `video` prop; on save
  // we snapshot whichever subset applies to the chosen mode.
  const [accessMode, setAccessMode] = useState<AccessMode>(video.accessMode ?? 'public');
  const [allowlist, setAllowlist] = useState<string[]>(video.allowlist ?? []);
  const [unlockAt, setUnlockAt] = useState<number | undefined>(video.unlockAt);
  // Price is edited in whole SUSD (UI-friendly) and converted to base units
  // on submit; we seed the display value from the row's stored base units.
  const [priceSusd, setPriceSusd] = useState<string>(
    video.price && video.price > 0
      ? (video.price / SUSD_DIVISOR).toString()
      : '',
  );

  // Reset the form whenever the underlying video changes (e.g. parent
  // refetches after a save) so the "dirty" detection below is accurate.
  useEffect(() => {
    setAccessMode(video.accessMode ?? 'public');
    setAllowlist(video.allowlist ?? []);
    setUnlockAt(video.unlockAt);
    setPriceSusd(
      video.price && video.price > 0
        ? (video.price / SUSD_DIVISOR).toString()
        : '',
    );
  }, [video.videoId, video.accessMode, video.allowlist, video.unlockAt, video.price]);

  // ── Purchase count fetch ───────────────────────────────────────────────
  // Kick off on mount for every access mode — even videos that have since
  // been switched away from Purchasable may have historical receipts the
  // creator wants to see. On failure we surface nothing (not an error toast)
  // because this data is incidental to the primary editing task.
  const [purchases, setPurchases] = useState<PurchasesResponse | null>(null);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchasesError, setPurchasesError] = useState<string | null>(null);

  const fetchPurchases = useCallback(async () => {
    if (!isOwner) return;
    setPurchasesLoading(true);
    setPurchasesError(null);
    try {
      const url = `/api/videos/${encodeURIComponent(video.videoId)}/purchases?wallet=${encodeURIComponent(
        normalizedCaller,
      )}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed with status ${res.status}`);
      }
      const data: PurchasesResponse = await res.json();
      setPurchases(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load purchases';
      setPurchasesError(msg);
    } finally {
      setPurchasesLoading(false);
    }
  }, [video.videoId, normalizedCaller, isOwner]);

  useEffect(() => {
    fetchPurchases();
  }, [fetchPurchases]);

  // ── Derived validation (mirrors UploadForm) ────────────────────────────
  const priceBaseUnits = useMemo(() => {
    const n = Number(priceSusd);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n * SUSD_DIVISOR);
  }, [priceSusd]);

  const validationMessage = useMemo<string | null>(() => {
    if (accessMode === 'purchasable') {
      if (priceBaseUnits <= 0) {
        return 'Purchasable videos require a price greater than zero';
      }
    }
    if (accessMode === 'allowlist') {
      if (allowlist.length < 1) {
        return 'Add at least one wallet address to the allowlist';
      }
    }
    if (accessMode === 'timelock') {
      if (unlockAt === undefined) return 'Pick an unlock time';
      if (unlockAt <= Date.now()) return 'Unlock time must be in the future';
      if (unlockAt >= video.expirationTimestamp) {
        return 'Unlock time must be before the video expires';
      }
    }
    return null;
  }, [accessMode, priceBaseUnits, allowlist, unlockAt, video.expirationTimestamp]);

  // Detect "dirty" state so the Save button is a no-op when nothing changed.
  const isDirty = useMemo(() => {
    if (accessMode !== (video.accessMode ?? 'public')) return true;
    if (accessMode === 'allowlist') {
      const current = [...(video.allowlist ?? [])].sort();
      const next = [...allowlist].sort();
      if (current.length !== next.length) return true;
      for (let i = 0; i < current.length; i++) {
        if (current[i] !== next[i]) return true;
      }
    }
    if (accessMode === 'timelock' && unlockAt !== video.unlockAt) return true;
    if (accessMode === 'purchasable') {
      const currentPrice = video.price ?? 0;
      if (currentPrice !== priceBaseUnits) return true;
    }
    return false;
  }, [accessMode, allowlist, unlockAt, priceBaseUnits, video]);

  // ── Save flow ──────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!isOwner) {
      error('You are not the uploader of this video');
      return;
    }
    if (validationMessage) {
      error(validationMessage);
      return;
    }
    if (!isDirty) {
      success('No changes to save');
      return;
    }

    setSaving(true);
    try {
      // 1. Request a one-time nonce keyed by the caller's wallet.
      const challengeRes = await fetch(
        `/api/auth/challenge?walletAddress=${encodeURIComponent(normalizedCaller)}`,
        { method: 'GET' },
      );
      if (!challengeRes.ok) {
        const body = await challengeRes.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to obtain signing challenge');
      }
      const { nonce } = (await challengeRes.json()) as { nonce?: string };
      if (!nonce) throw new Error('Challenge endpoint returned no nonce');

      // 2. Sign the nonce via the Aptos Wallet Adapter Standard. We send
      //    the same literal message the PATCH route expects so its
      //    fullMessage-free verification path works without surprises.
      const signed = await signMessage({
        message: `ShelbyFlix login: ${nonce}`,
        nonce,
      });

      // The adapter spec returns { signature, fullMessage, address, publicKey? }
      // where `signature` and `publicKey` may be either raw hex strings
      // or objects carrying a `.toString()` that serializes to hex. We
      // coerce through String() so both shapes flow through to the server
      // identically.
      const signatureHex = normalizeHex(signed?.signature);
      // Fall back to account.publicKey when signMessage doesn't return it
      // (Petra and some wallets omit publicKey from the signMessage response)
      const publicKeyHex = normalizeHex(signed?.publicKey)
        || normalizeHex((walletAccount as any)?.publicKey);
      const fullMessage: string | undefined =
        typeof signed?.fullMessage === 'string' ? signed.fullMessage : undefined;

      if (!signatureHex) {
        throw new Error('Wallet did not return a signature');
      }
      if (!publicKeyHex) {
        throw new Error(
          'Wallet did not expose a public key — signature cannot be verified',
        );
      }

      // 3. PATCH the access-config endpoint with the signed payload.
      //    We only send the mode-specific parameters that are meaningful
      //    for the chosen mode; the server clears the other columns so
      //    the row never ends up inconsistent (see access-config route).
      const body: Record<string, unknown> = {
        walletAddress: normalizedCaller,
        publicKey: publicKeyHex,
        signature: signatureHex,
        nonce,
        fullMessage,
        accessMode,
      };
      if (accessMode === 'allowlist') body.allowlist = allowlist;
      if (accessMode === 'timelock') body.unlockAt = unlockAt;
      if (accessMode === 'purchasable') body.price = priceBaseUnits;

      const { csrfFetch } = await import('@/lib/csrf-client');
      const saveRes = await csrfFetch(
        `/api/videos/${encodeURIComponent(video.videoId)}/access-config`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );

      if (!saveRes.ok) {
        const errBody = await saveRes.json().catch(() => ({}));
        throw new Error(
          errBody?.error || `Save failed with status ${saveRes.status}`,
        );
      }

      const saveData = await saveRes.json();

      // 4. Under the move flag, the PATCH returns a `chainTx` payload that
      //    the client must sign and submit. No DB mutation occurs under move
      //    — the chain IS the source of truth (Req 9.1, 9.5).
      if (saveData.chainTx) {
        // Sign and submit the chain transaction via the wallet adapter.
        let txHash: string;
        try {
          const response = await signAndSubmitTransaction({
            data: saveData.chainTx,
          });
          txHash = response.hash;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Categorize signing failure for user-friendly messaging
          if (
            msg.toLowerCase().includes('user rejected') ||
            msg.toLowerCase().includes('user denied') ||
            msg.toLowerCase().includes('rejected by user') ||
            msg.toLowerCase().includes('cancelled')
          ) {
            throw new Error('Transaction cancelled — your access settings were not changed.');
          }
          if (msg.toLowerCase().includes('account')) {
            throw new Error(`Wallet error: ${msg}`);
          }
          throw new Error(`Wallet signing failed: ${msg}`);
        }

        // Wait for transaction confirmation with a 60-second timeout.
        const { getAptosClient } = await import('@/lib/aptos-client');
        const aptos = getAptosClient();

        let txResult: any;
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Transaction commit timeout (60s)')), 60_000)
          );
          const waitPromise = aptos.waitForTransaction({
            transactionHash: txHash,
            options: { checkSuccess: false },
          });
          txResult = await Promise.race([waitPromise, timeoutPromise]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Transaction failed to confirm: ${msg}`);
        }

        // Check on-chain result — abort means the policy was NOT updated.
        if (txResult.success === false) {
          const vmStatus: string = txResult.vm_status ?? '';
          throw new Error(
            `Transaction aborted on-chain: ${vmStatus || 'Unknown VM error'}`
          );
        }

        // Emit logChainWriteSuccess on confirmed commit (Req 14.2).
        const { logChainWriteSuccess } = await import('@/lib/move-logging');
        const entryFn = saveData.chainTx.function?.includes('update_allowlist')
          ? 'update_allowlist'
          : 'force_update_policy_v2';
        logChainWriteSuccess(entryFn as any, {
          videoId: video.videoId,
          txHash,
          version: txResult.version ?? 0,
        });
      }

      success('Access settings saved');

      // Refresh the purchase count — changing the mode can surface stale
      // receipts (e.g. switching purchasable → allowlist still leaves the
      // historical count visible, which is useful context for the creator).
      fetchPurchases();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (!isOwner) return null;

  // ── Render ─────────────────────────────────────────────────────────────
  const modeLabel = MODE_LABELS[accessMode];
  const ModeIcon = MODE_ICONS[video.accessMode ?? 'public'];

  return (
    <>
      <NotificationContainer notifications={notifications} onClose={remove} />

      <section
        aria-labelledby="creator-settings-heading"
        className="mb-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden"
      >
        {/* Collapsible header */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-brand-purple/20 border border-brand-purple/30 flex items-center justify-center flex-shrink-0">
              <Cog6ToothIcon className="w-4 h-4 text-brand-purple" />
            </div>
            <div className="text-left min-w-0">
              <h3
                id="creator-settings-heading"
                className="text-white text-sm font-black tracking-tight"
              >
                Creator Settings
              </h3>
              <p className="text-zinc-500 text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
                <ModeIcon className="w-3 h-3" />
                <span>{MODE_LABELS[video.accessMode ?? 'public']}</span>
                {purchases && purchases.count > 0 && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span>
                      {purchases.count}{' '}
                      {purchases.count === 1 ? 'purchase' : 'purchases'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          {expanded ? (
            <ChevronUpIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="px-4 pb-5 pt-1 space-y-6 border-t border-zinc-800">
            {/* Current config snapshot */}
            <CurrentConfigSummary
              video={video}
              purchases={purchases}
              purchasesLoading={purchasesLoading}
              purchasesError={purchasesError}
            />

            {/* Editor */}
            <div className="space-y-5">
              <AccessModeSelector
                value={accessMode}
                onChange={setAccessMode}
                disabled={saving}
              />

              {accessMode === 'allowlist' && (
                <AllowlistEditor
                  value={allowlist}
                  onChange={setAllowlist}
                  disabled={saving}
                />
              )}
              {accessMode === 'timelock' && (
                <TimeLockPicker
                  value={unlockAt}
                  onChange={setUnlockAt}
                  expirationTimestamp={video.expirationTimestamp}
                  disabled={saving}
                />
              )}
              {accessMode === 'purchasable' && (
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-zinc-400 mb-3">
                    Price (ShelbyUSD) <span className="text-brand-red">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      value={priceSusd}
                      onChange={(e) => setPriceSusd(e.target.value)}
                      step="0.01"
                      min="0"
                      disabled={saving}
                      placeholder="0.10"
                      className="w-full px-4 py-3 pr-28 bg-zinc-900/60 border border-zinc-800 rounded-xl text-white
                        focus:outline-none focus:border-brand-red focus:ring-1 focus:ring-brand-red
                        disabled:opacity-50 transition-colors text-sm"
                    />
                    <span className="absolute right-4 top-3 text-zinc-500 text-xs font-bold">
                      SHELBY_USD
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-600 mt-1">
                    Viewers pay this once for lifetime access
                  </p>
                </div>
              )}

              {validationMessage && (
                <p className="text-[11px] text-brand-red font-medium">
                  ⚠️ {validationMessage}
                </p>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <span className="text-[11px] text-zinc-500 mr-auto">
                  {isDirty
                    ? 'Unsaved changes'
                    : `Current: ${modeLabel}`}
                </span>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={
                    saving || !isDirty || validationMessage !== null
                  }
                  className="px-5 py-2.5 rounded-xl bg-brand-red hover:bg-brand-red/90 text-white text-xs font-black tracking-widest
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                    shadow-[0_0_20px_rgba(246,27,46,0.2)]"
                >
                  {saving ? 'SAVING...' : 'SAVE CHANGES'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

const MODE_LABELS: Record<AccessMode, string> = {
  public: 'Public',
  allowlist: 'Allowlist',
  timelock: 'Time Lock',
  purchasable: 'Purchasable',
};

const MODE_ICONS: Record<AccessMode, typeof GlobeAltIcon> = {
  public: GlobeAltIcon,
  allowlist: UserGroupIcon,
  timelock: ClockIcon,
  purchasable: TicketIcon,
};

/**
 * Read-only snapshot of the video's currently persisted access config plus
 * the live purchase count. Renders the data from the `video` prop (source of
 * truth) rather than the local edit state so creators can always see what
 * viewers are actually hitting on the server. The edit form below may show
 * uncommitted values until "Save changes" lands.
 */
function CurrentConfigSummary({
  video,
  purchases,
  purchasesLoading,
  purchasesError,
}: {
  video: VideoMetadata;
  purchases: PurchasesResponse | null;
  purchasesLoading: boolean;
  purchasesError: string | null;
}) {
  const mode = video.accessMode ?? 'public';
  const ModeIcon = MODE_ICONS[mode];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ModeIcon className="w-4 h-4 text-brand-purple" />
          <span className="text-xs font-black uppercase tracking-widest text-zinc-400">
            Current Access
          </span>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-purple/10 border border-brand-purple/30 text-brand-purple text-[11px] font-bold">
          <CheckCircleIcon className="w-3 h-3" />
          {MODE_LABELS[mode]}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {mode === 'purchasable' && (
          <ConfigRow
            Icon={CurrencyDollarIcon}
            label="Price"
            value={
              video.price && video.price > 0
                ? `${formatSusd(video.price)} SUSD`
                : '— (free)'
            }
          />
        )}

        {mode === 'timelock' && video.unlockAt && (
          <ConfigRow
            Icon={CalendarDaysIcon}
            label="Unlocks at"
            value={formatUnlockTime(video.unlockAt)}
          />
        )}

        {mode === 'allowlist' && (
          <ConfigRow
            Icon={UserGroupIcon}
            label="Allowlist"
            value={
              video.allowlist.length === 0
                ? 'Empty'
                : `${video.allowlist.length} ${
                    video.allowlist.length === 1 ? 'address' : 'addresses'
                  }`
            }
          />
        )}

        <ConfigRow
          Icon={ShoppingCartIcon}
          label="Purchases"
          value={
            purchasesLoading
              ? 'Loading...'
              : purchasesError
              ? '—'
              : `${purchases?.count ?? 0}`
          }
        />
      </div>

      {/* Allowlist peek: if the video is in allowlist mode, surface the
          first few entries so creators can sanity-check at a glance. */}
      {mode === 'allowlist' && video.allowlist.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-black mb-2">
            Allowed wallets
          </p>
          <div className="flex flex-wrap gap-1.5">
            {video.allowlist.slice(0, 8).map((addr) => (
              <span
                key={addr}
                title={addr}
                className="inline-flex items-center px-2 py-1 rounded-full bg-brand-purple/15 border border-brand-purple/30 text-white text-[10px] font-mono"
              >
                {formatAddress(addr)}
              </span>
            ))}
            {video.allowlist.length > 8 && (
              <span className="text-[10px] text-zinc-500 self-center">
                +{video.allowlist.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Most recent purchases — capped at 5 in-card; the API returns up
          to 50 rows but cramming them all into a summary is noisy. */}
      {!purchasesLoading && purchases && purchases.purchases.length > 0 && (
        <div className="pt-2">
          <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-black mb-2">
            Recent purchases
          </p>
          <ul className="space-y-1.5">
            {purchases.purchases.slice(0, 5).map((p) => (
              <li
                key={`${p.wallet_address}-${p.created_at}`}
                className="flex items-center justify-between gap-3 text-[11px] px-3 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800"
              >
                <span className="text-zinc-300 font-mono truncate">
                  {formatAddress(p.wallet_address)}
                </span>
                <span className="text-zinc-500">
                  {formatSusd(p.amount_total)} SUSD
                </span>
                <span className="text-zinc-600">
                  {new Date(p.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
          {purchases.count > purchases.purchases.length && (
            <p className="text-[10px] text-zinc-600 mt-1.5">
              Showing {purchases.purchases.length} of {purchases.count} total
            </p>
          )}
        </div>
      )}

      {purchasesError && (
        <p className="text-[11px] text-brand-red font-medium">
          ⚠️ {purchasesError}
        </p>
      )}
    </div>
  );
}

function ConfigRow({
  Icon,
  label,
  value,
}: {
  Icon: typeof GlobeAltIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
      <Icon className="w-4 h-4 text-zinc-500 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">
          {label}
        </p>
        <p className="text-xs text-white font-bold truncate">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Coerce the value returned by `signMessage` into a `0x`-prefixed hex string
 * that the server's Ed25519 verifier can consume. The Aptos Wallet Adapter
 * returns these as either raw hex strings or SDK objects that serialise to
 * hex via `.toString()`; both shapes flow through here identically.
 *
 * Returns `null` for empty / unserialisable inputs so callers can bail out
 * before sending a malformed PATCH.
 */
function normalizeHex(value: unknown): string | null {
  if (value == null) return null;
  let out: string;
  if (typeof value === 'string') {
    out = value;
  } else if (typeof (value as { toString?: () => string })?.toString === 'function') {
    out = (value as { toString: () => string }).toString();
  } else {
    return null;
  }
  out = out.trim();
  if (out.length === 0 || out === '[object Object]') return null;
  return out.startsWith('0x') ? out : `0x${out}`;
}
