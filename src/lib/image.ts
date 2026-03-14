interface ImageOptions {
  width: number;
  quality?: number;
}

/**
 * Network-aware connection info.
 *
 * Uses the Network Information API (Chromium ~75% of traffic) to detect
 * slow connections. Unsupported browsers get full quality — progressive
 * enhancement, not degradation.
 */
interface ConnectionInfo {
  effectiveType: string;
  saveData: boolean;
}

/** Cached connection info — read once per page load, not per image. */
let cachedConnection: ConnectionInfo | null | undefined;

function getConnection(): ConnectionInfo | null {
  if (cachedConnection !== undefined) return cachedConnection;
  if (typeof navigator === 'undefined') {
    cachedConnection = null;
    return null;
  }
  cachedConnection = (navigator as { connection?: ConnectionInfo }).connection ?? null;
  return cachedConnection;
}

/** @internal Reset cached connection — only for tests. */
export function _resetConnectionCache(): void {
  cachedConnection = undefined;
}

/** True when the user is on a slow connection or has data saver enabled. */
export function isSlowConnection(): boolean {
  const conn = getConnection();
  if (!conn) return false;
  if (conn.saveData) return true;
  return (
    conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g' || conn.effectiveType === '3g'
  );
}

/**
 * Adapt image quality and width cap based on network conditions.
 * On slow connections: quality drops to 45, width capped at 600px.
 * On save-data: quality drops to 35, width capped at 400px.
 */
export function adaptForConnection(
  width: number,
  quality: number,
): { width: number; quality: number } {
  const conn = getConnection();
  if (!conn) return { width, quality };

  if (conn.saveData) {
    return { width: Math.min(width, 400), quality: Math.min(quality, 35) };
  }
  if (conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g') {
    return { width: Math.min(width, 400), quality: Math.min(quality, 35) };
  }
  if (conn.effectiveType === '3g') {
    return { width: Math.min(width, 600), quality: Math.min(quality, 45) };
  }
  return { width, quality };
}

export function optimizedImageUrl(src: string, opts: ImageOptions): string {
  if (!src) return src;
  const { width, quality = 75 } = opts;
  const adapted = adaptForConnection(width, quality);
  if (import.meta.env.DEV) {
    // Astro's built-in image service (sharp) — works in local dev
    return `/_image?href=${encodeURIComponent(src)}&w=${adapted.width}&q=${adapted.quality}&f=webp`;
  }
  // Vercel Image Optimization — works in production
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${adapted.width}&q=${adapted.quality}`;
}

interface ResponsiveImageAttrs {
  src: string;
  srcset: string;
  sizes: string;
}

export function responsiveImage(
  src: string,
  widths: number[],
  sizes: string,
  quality?: number,
): ResponsiveImageAttrs {
  if (!src) {
    return { src, srcset: '', sizes };
  }
  const srcset = widths
    .map((w) => `${optimizedImageUrl(src, { width: w, quality })} ${w}w`)
    .join(', ');
  return {
    src: optimizedImageUrl(src, { width: widths[widths.length - 1], quality }),
    srcset,
    sizes,
  };
}
