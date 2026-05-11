/**
 * Client-side image resizing and compression utilities.
 * Uses native Canvas API — no external dependencies.
 */

interface ResizeOptions {
  maxWidth: number;
  maxHeight: number;
  maxSizeBytes: number;
  quality?: number;
}

/**
 * Resize and compress an image file to a JPEG data URL.
 * Iteratively reduces quality until the result is under maxSizeBytes.
 */
export async function resizeImageToDataUrl(
  file: File,
  options: ResizeOptions
): Promise<string> {
  const { maxWidth, maxHeight, maxSizeBytes } = options;
  let quality = options.quality ?? 0.85;

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  // Calculate scaled dimensions maintaining aspect ratio
  let targetWidth = width;
  let targetHeight = height;

  if (targetWidth > maxWidth || targetHeight > maxHeight) {
    const ratio = Math.min(maxWidth / targetWidth, maxHeight / targetHeight);
    targetWidth = Math.round(targetWidth * ratio);
    targetHeight = Math.round(targetHeight * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
  bitmap.close();

  // Iteratively reduce quality until under size limit
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  while (dataUrl.length > maxSizeBytes * 1.37 && quality > 0.1) {
    // 1.37 factor accounts for base64 overhead (~37% larger than binary)
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  return dataUrl;
}

/** Avatar: 200x200, max 100KB */
export function resizeAvatar(file: File): Promise<string> {
  return resizeImageToDataUrl(file, {
    maxWidth: 200,
    maxHeight: 200,
    maxSizeBytes: 100_000,
    quality: 0.85,
  });
}

/** Banner: 1200x300, max 300KB */
export function resizeBanner(file: File): Promise<string> {
  return resizeImageToDataUrl(file, {
    maxWidth: 1200,
    maxHeight: 300,
    maxSizeBytes: 300_000,
    quality: 0.8,
  });
}
