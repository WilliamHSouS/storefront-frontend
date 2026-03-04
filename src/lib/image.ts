interface ImageOptions {
  width: number;
  quality?: number;
}

export function optimizedImageUrl(src: string, opts: ImageOptions): string {
  if (!src || import.meta.env.DEV) return src;
  const { width, quality = 75 } = opts;
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
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
  if (!src || import.meta.env.DEV) {
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
