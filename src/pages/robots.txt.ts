import type { APIRoute } from 'astro';
import type { MerchantConfig } from '@/types/merchant';

export const GET: APIRoute = async ({ locals, url }) => {
  const merchant = locals.merchant as MerchantConfig | undefined;

  if (!merchant) {
    return new Response('User-agent: *\nDisallow: /\n', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const origin = url.origin;

  const body = `User-agent: *
Allow: /

# Transactional pages — no indexing value
Disallow: /*/cart
Disallow: /*/checkout
Disallow: /*/orders
Disallow: /*/login
Disallow: /*/group

# API routes
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400',
    },
  });
};
