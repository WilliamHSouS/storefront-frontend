import type { APIRoute } from 'astro';
import type { MerchantConfig } from '@/types/merchant';
import { flattenCategories, slugify } from '@/lib/normalize';

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export const GET: APIRoute = async ({ locals, url }) => {
  const merchant = locals.merchant as MerchantConfig | undefined;
  const sdk = locals.sdk as any;

  if (!merchant || !sdk) {
    return new Response('Not found', { status: 404 });
  }

  const origin = url.origin;
  const languages = merchant.languages;
  const defaultLang = merchant.defaultLanguage;

  // Fetch products and categories — use allSettled so one failure
  // doesn't prevent the other resource from appearing in the sitemap
  let products: Record<string, unknown>[] = [];
  let categories: Array<{ id: number | string; slug: string }> = [];

  try {
    const [productsResult, categoriesResult] = await Promise.allSettled([
      sdk.GET('/api/v1/products/'),
      sdk.GET('/api/v1/categories/'),
    ]);

    if (productsResult.status === 'fulfilled') {
      products = productsResult.value?.data?.results ?? [];
    } else {
      console.error('sitemap: failed to fetch products', productsResult.reason);
    }

    if (categoriesResult.status === 'fulfilled') {
      const rawCats = categoriesResult.value?.data?.results ?? [];
      categories = flattenCategories(rawCats);
    } else {
      console.error('sitemap: failed to fetch categories', categoriesResult.reason);
    }
  } catch (err) {
    console.error('sitemap: unexpected error fetching data', err);
  }

  // If both fetches failed, return 503 so crawlers retain the previous sitemap
  // rather than treating a near-empty sitemap as authoritative
  if (products.length === 0 && categories.length === 0) {
    return new Response('Service temporarily unavailable', {
      status: 503,
      headers: { 'Retry-After': '300' },
    });
  }

  const urls: Array<{ loc: string; lastmod?: string; langs: string[] }> = [];

  // Menu page (highest priority)
  urls.push({ loc: '/', langs: languages });

  // Category pages
  for (const cat of categories) {
    urls.push({
      loc: `/collection/${escapeXml(cat.slug)}`,
      langs: languages,
    });
  }

  // Product pages
  for (const product of products) {
    const raw = product as any;
    const productSlug = raw.slug ?? slugify(raw.title ?? raw.name ?? String(raw.id));
    urls.push({
      loc: `/product/${escapeXml(productSlug)}`,
      langs: languages,
      lastmod: raw.updated_at,
    });
  }

  // Build XML
  const entries = urls
    .map((entry) => {
      const langAlternates = entry.langs
        .map(
          (lang) =>
            `    <xhtml:link rel="alternate" hreflang="${lang}" href="${origin}/${lang}${entry.loc}" />`,
        )
        .join('\n');

      const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/${defaultLang}${entry.loc}" />`;

      return `  <url>
    <loc>${origin}/${defaultLang}${entry.loc}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ''}
${langAlternates}
${xDefault}
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
