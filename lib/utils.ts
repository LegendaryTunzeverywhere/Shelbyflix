// ---------------------------------------------------------------------------
// This file previously also contained a duplicate uploadToShelby /
// downloadAndDecryptVideo / deleteFromShelby / validateVideoFile block —
// a stale fork of lib/shelby.ts that nothing in the app actually imported
// (every real call site uses '@/lib/shelby' instead). It had drifted from
// the real implementation (still called the fully-obsolete client-side
// registerBlob/uploadBlobToShelbynet flow, and had the same creator-vs-
// platform-account owner-address bug that was fixed in lib/shelby.ts).
// Removed to avoid the confusion of two files exporting identically-named
// functions where only one is ever actually used — see lib/shelby.ts for
// the real, maintained implementations.
// ---------------------------------------------------------------------------

export function formatAddress(address: string | null | undefined): string {
  if (!address) return '';
  if (address.length <= 10) return address; // If address is too short, return as is
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

export function sanitizeUrl(url: string): string {
  // Basic sanitization: check if it's a data URL or starts with http(s)://
  if (url.startsWith("data:")) {
    return url;
  }
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return url;
    }
  } catch (error) {
    // Invalid URL, return empty string or a placeholder
  }
  return "";
}
