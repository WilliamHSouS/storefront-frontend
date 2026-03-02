import type { APIRoute } from 'astro';
import type { MerchantConfig } from '@/types/merchant';
import { fetchAllProducts } from '@/lib/fetch-all';

export const GET: APIRoute = async ({ locals, url }) => {
  const merchant = locals.merchant as MerchantConfig | undefined;
  const sdk = locals.sdk as any;

  if (!merchant || !sdk) {
    return new Response('Not found', { status: 404 });
  }

  const origin = url.origin;
  const languages = merchant.languages;
  const defaultLang = merchant.defaultLanguage;

  // Fetch products and categories for URL generation
  const [products, categoriesRes] = await Promise.all([
    fetchAllProducts(sdk, {
      vendorId: merchant.merchantId,
      language: defaultLang,
      baseUrl: import.meta.env.API_BASE_URL,
    }),
    sdk.GET('/api/v1/categories/'),
  ]);

  const categories = categoriesRes?.data?.results ?? [];

  const urls: Array<{ loc: string; lastmod?: string; langs: string[] }> = [];

  // Menu page (highest priority)
  urls.push({ loc: '/', langs: languages });

  // Category pages
  for (const cat of categories) {
    urls.push({
      loc: `/category/${cat.slug ?? cat.id}`,
      langs: languages,
    });
  }

  // Product pages
  for (const product of products) {
    urls.push({
      loc: `/product/${(product as any).slug ?? (product as any).id}`,
      langs: languages,
      lastmod: (product as any).updated_at,
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
