/**
 * Progressive (MSE) playback — feed decrypted bytes to a MediaSource instead
 * of minting a full-file blob URL.
 *
 * Why this exists: the players used to decrypt the whole file, call
 * `URL.createObjectURL()` on it, and hand that URL to <video>. Every platform
 * save affordance we're trying to blunt (PC right-click "Save video as",
 * Android download, iOS long-press "Save Video") resolves exactly that URL —
 * the plaintext copy. The bytes are necessarily in memory to play them at
 * all (they're AES-GCM ciphertext at rest), so this module keeps them in
 * memory and streams them into a SourceBuffer instead: <video> then has no
 * file-backed resource to save.
 *
 * What it does NOT stop: DevTools network replay (stream-url +
 * decryption-key remain the authorized fetches) and screen recording. This
 * closes the casual save gesture, not DRM.
 *
 * Pipeline: decrypted ArrayBuffer → mp4box.js fragments it into fMP4
 * segments in memory → segments are appendBuffer()'d serially (SourceBuffer
 * only accepts one append at a time) → endOfStream() once the queue drains.
 *
 * Browser matrix: Chromium/Firefox/Edge → window.MediaSource; Safari 17.4+
 * → window.ManagedMediaSource. Anything else — or a container mp4box can't
 * parse (WebM/AVI uploads) or a codec the SourceBuffer rejects — makes
 * attachProgressivePlayback() reject, and the caller falls back to the
 * classic blob-URL path (still guarded by the context-menu hardening).
 *
 * NOTE: mp4box is imported dynamically inside attachProgressivePlayback so
 * it lands in its own async chunk instead of the player bundle.
 */

import type { ISOFile, MP4BoxBuffer } from 'mp4box';

/**
 * What a player needs in order to render. `blob` rides along on the
 * progressive variant purely so the fallback (MSE setup failed) is an
 * in-memory swap — no re-download, no second key fetch.
 */
export type PlaybackMaterial =
  | { kind: 'blob'; url: string }
  | { kind: 'progressive'; buffer: ArrayBuffer; blob: Blob };

export interface ProgressivePlaybackHandle {
  /** Stop appending, detach from the element, revoke the MediaSource URL. */
  dispose(): void;
}

export interface ProgressivePlaybackOptions {
  /**
   * Called for pipeline failures that surface AFTER the attach promise has
   * resolved (SourceBuffer error, media element error mid-playback). Setup
   * failures reject the attach promise instead.
   */
  onError?: (error: Error) => void;
  /**
   * Abort setup (element unmounted, material replaced) before the init
   * segment landed: rejects the attach promise and tears down listeners /
   * the MediaSource URL. Aborting after a successful attach is a no-op —
   * dispose() the handle instead.
   */
  signal?: AbortSignal;
}

interface MediaSourceConstructor {
  new (): MediaSource;
  isTypeSupported(type: string): boolean;
}

function resolveMediaSourceConstructor(): MediaSourceConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    MediaSource?: unknown;
    ManagedMediaSource?: unknown;
  };
  // Prefer the standard MSE; ManagedMediaSource is Safari 17.4+'s variant.
  for (const candidate of [w.MediaSource, w.ManagedMediaSource]) {
    if (
      typeof candidate === 'function' &&
      typeof (candidate as MediaSourceConstructor).isTypeSupported === 'function'
    ) {
      return candidate as MediaSourceConstructor;
    }
  }
  return null;
}

/**
 * Cheap pre-check before we bother converting a decrypted Blob to an
 * ArrayBuffer. Validates a baseline H.264+AAC MP4 type; the *actual* codec
 * string is checked again at attach time against the parsed container.
 */
export function progressivePlaybackSupported(): boolean {
  const ctor = resolveMediaSourceConstructor();
  if (!ctor) return false;
  return (
    ctor.isTypeSupported('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') ||
    ctor.isTypeSupported('video/mp4; codecs="avc1.42E01E"')
  );
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** Samples per SourceBuffer append. In-memory playback means the chunking
 *  exists only to bound per-append transfer size — 500 frames (~20s of
 *  video, ~10s of audio) keeps the pipeline responsive without an
 *  updateend round-trip per fragment. */
const SAMPLES_PER_SEGMENT = 500;

/**
 * Attach `buffer` (a full, already-decrypted MP4/ISO-BMFF file) to `video`
 * through a MediaSource pipeline.
 *
 * Resolves once the initialization segment has been appended — i.e. the
 * element has a working source and playback can start — while media
 * segments keep appending in the background. Rejects (leaving the element
 * untouched apart from a revoked URL) when:
 *   - the container isn't parseable MP4 (WebM/AVI/corrupt → caller falls back),
 *   - the codecs aren't supported by this browser's SourceBuffer,
 *   - the element or pipeline errors during setup,
 *   - dispose() is called before the init segment landed.
 *
 * After resolve, fatal pipeline errors are reported through options.onError
 * so the caller can swap to its blob fallback.
 */
export async function attachProgressivePlayback(
  video: HTMLVideoElement,
  buffer: ArrayBuffer,
  options: ProgressivePlaybackOptions = {},
): Promise<ProgressivePlaybackHandle> {
  if (options.signal?.aborted) {
    throw new Error('Playback setup aborted');
  }
  const Ctor = resolveMediaSourceConstructor();
  if (!Ctor) {
    throw new Error('MediaSource is not supported in this browser');
  }
  // Re-bind with the narrowed type: the closures below (declared before the
  // guard runs) capture it, and TS doesn't keep throw-guard narrowing inside
  // hoisted function declarations.
  const MS: MediaSourceConstructor = Ctor;

  const mediaSource = new Ctor();
  const mediaUrl = URL.createObjectURL(mediaSource);

  let settled = false;
  let disposed = false;
  let flushed = false;
  let ended = false;
  let sourceBuffer: SourceBuffer | null = null;
  let mp4: ISOFile | null = null;
  const queue: ArrayBuffer[] = [];

  let resolveAttach: () => void = () => {};
  let rejectAttach: (e: Error) => void = () => {};
  const attachDone = new Promise<void>((res, rej) => {
    resolveAttach = res;
    rejectAttach = rej;
  });

  const cleanup = () => {
    try {
      mp4?.stop();
    } catch {
      /* already stopped or never started */
    }
    mp4 = null;
    mediaSource.removeEventListener('sourceopen', onSourceOpen);
    mediaSource.removeEventListener('sourceclose', onSourceClose);
    options.signal?.removeEventListener('abort', onAbort);
    if (sourceBuffer) {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd);
      sourceBuffer.removeEventListener('error', onSourceBufferError);
      sourceBuffer = null;
    }
    video.removeEventListener('error', onVideoError);
    if (video.getAttribute('src') === mediaUrl) {
      video.removeAttribute('src');
    }
    URL.revokeObjectURL(mediaUrl);
  };

  const fail = (error: Error) => {
    if (disposed) return;
    if (!settled) {
      settled = true;
      cleanup();
      rejectAttach(error);
      return;
    }
    if (options.onError) {
      options.onError(error);
    } else {
      console.warn('Progressive playback pipeline error:', error);
    }
  };

  /** Serialise appends: SourceBuffer accepts exactly one at a time. */
  const pump = () => {
    if (disposed || !sourceBuffer) return;
    if (sourceBuffer.updating) return;
    const next = queue.shift();
    if (next) {
      try {
        sourceBuffer.appendBuffer(next);
      } catch (err) {
        fail(toError(err));
      }
      return;
    }
    if (flushed && !ended && mediaSource.readyState === 'open') {
      ended = true;
      try {
        mediaSource.endOfStream();
      } catch {
        /* element already errored — its own event reports it */
      }
    }
  };

  function onUpdateEnd() {
    if (!settled) {
      // First updateend = init segment landed: the element now has a
      // working source and the caller may start playback.
      settled = true;
      resolveAttach();
    }
    pump();
  }

  function onSourceBufferError() {
    fail(new Error('SourceBuffer append failed'));
  }

  function onSourceClose() {
    fail(new Error('MediaSource closed during setup'));
  }

  function onVideoError() {
    fail(new Error('Media element pipeline error'));
  }

  function onAbort() {
    // Post-resolve aborts are disposal's job (the handle exists); failing
    // here would wrongly fire options.onError during a normal material swap.
    if (settled) return;
    fail(new Error('Playback setup aborted'));
  }

  async function onSourceOpen() {
    try {
      if (disposed) return;
      const { createFile } = await import('mp4box');
      if (disposed) return;

      // keepMdatData MUST be true: the default discards sample bytes, which
      // is exactly what segmentation needs to build moof/mdat fragments.
      const file = createFile(true);
      mp4 = file;

      file.onError = (module, message) => {
        fail(new Error(`MP4Box ${module}: ${message}`));
      };

      file.onSegment = (_id, _user, segment) => {
        if (disposed) return;
        queue.push(segment);
        pump();
      };

      file.onReady = (info) => {
        try {
          if (disposed) return;
          const mediaTracks = [...info.videoTracks, ...info.audioTracks];
          const codecs = mediaTracks
            .map((t) => t.codec)
            .filter(Boolean)
            .join(', ');
          if (!codecs) {
            fail(new Error('Container has no audio/video tracks'));
            return;
          }
          const mime = `video/mp4; codecs="${codecs}"`;
          if (!MS.isTypeSupported(mime)) {
            fail(new Error(`Unsupported codec (${mime})`));
            return;
          }

          const sb = mediaSource.addSourceBuffer(mime);
          sb.mode = 'segments';
          sb.addEventListener('updateend', onUpdateEnd);
          sb.addEventListener('error', onSourceBufferError);
          sourceBuffer = sb;

          for (const track of mediaTracks) {
            file.setSegmentOptions(track.id, sb, {
              nbSamples: SAMPLES_PER_SEGMENT,
            });
          }
          // Combined init segment covering every segmented track.
          const init = file.initializeSegmentation();
          queue.push(init.buffer);
          pump();

          file.start();
          // NOTE: flush() is NOT called here — onReady fires mid-appendBuffer,
          // and signaling EOF while the file is still being parsed can abort
          // the trailing mdat. The outer flush() after appendBuffer returns
          // does that; this pump only services the queued init segment.
          pump();
        } catch (err) {
          fail(toError(err));
        }
      };

      // Whole file in one buffer: onReady fires synchronously during
      // appendBuffer when moov is parsed; flush() signals EOF so any
      // trailing samples segment too.
      const input = buffer as MP4BoxBuffer;
      input.fileStart = 0;
      file.appendBuffer(input);
      file.flush();
      flushed = true;
      // If every segment appended synchronously before the init updateend
      // (queue drained), this finishes the stream; otherwise updateend keeps
      // driving the queue.
      pump();

      if (!file.readySent && !disposed) {
        fail(
          new Error(
            'Could not parse container as MP4 — falling back to blob playback',
          ),
        );
      }
    } catch (err) {
      fail(toError(err));
    }
  }

  mediaSource.addEventListener('sourceopen', onSourceOpen);
  mediaSource.addEventListener('sourceclose', onSourceClose);
  video.addEventListener('error', onVideoError);
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // Assigning src kicks off resource selection → fires 'sourceopen',
    // which drives the rest of the setup asynchronously.
    video.src = mediaUrl;
    video.load();
  } catch (err) {
    settled = true;
    cleanup();
    throw toError(err);
  }

  try {
    await attachDone;
  } catch (err) {
    // fail() has already cleaned up; propagate for the caller's fallback.
    throw toError(err);
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!settled) {
        settled = true;
        rejectAttach(new Error('Playback disposed during setup'));
      }
      cleanup();
    },
  };
}
