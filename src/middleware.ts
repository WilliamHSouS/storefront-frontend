import type { MiddlewareHandler } from 'astro';
import { loadMerchantConfig } from './merchants';
import { resolveMerchantSlug } from './lib/resolve-merchant';
import { createStorefrontClient } from './lib/sdk-stub';

const CACHEABLE_PATTERNS = [
  /^\/[a-z]{2}\/?$/, // menu page
  /^\/[a-z]{2}\/product\//, // product pages
  /^\/[a-z]{2}\/collection\//, // collection pages
  /^\/[a-z]{2}\/pages\//, // CMS pages
];

// Paths that need merchant context but skip language prefix routing
const LANG_EXEMPT_PATHS = new Set(['/sitemap.xml', '/robots.txt']);

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request, locals, redirect } = context;
  const url = new URL(request.url);

  // Skip middleware for the 404 page to prevent rewrite loops
  if (url.pathname === '/404') {
    return next();
  }

  // Skip middleware for static assets in public/ (images, fonts, etc.)
  // SEO endpoints (.xml, .txt) are excluded — they need merchant context from below.
  if (
    !LANG_EXEMPT_PATHS.has(url.pathname) &&
    url.pathname.match(/\.(svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|eot|css|js|json|xml|txt)$/i)
  ) {
    return next();
  }

  // 1. Resolve merchant from hostname
  const slug = resolveMerchantSlug(
    url.hostname,
    import.meta.env.CUSTOM_DOMAINS,
    import.meta.env.DEFAULT_MERCHANT,
  );
  const merchant = loadMerchantConfig(slug);

  if (!merchant) {
    return context.rewrite('/404');
  }

  // 2a. SEO endpoints — inject merchant context but skip language routing
  if (LANG_EXEMPT_PATHS.has(url.pathname)) {
    locals.merchant = merchant;
    locals.lang = merchant.defaultLanguage;
    locals.sdk = createStorefrontClient({
      baseUrl: import.meta.env.API_BASE_URL,
      vendorId: merchant.merchantId,
      language: merchant.defaultLanguage,
    });
    return next();
  }

  // 2. Extract and validate language from path
  const pathMatch = url.pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  const lang = pathMatch?.[1];
  const restOfPath = pathMatch?.[2] ?? '/';

  if (!lang || !merchant.languages.includes(lang)) {
    // Redirect to default language, preserving path + query
    const targetPath = lang
      ? `/${merchant.defaultLanguage}${restOfPath}${url.search}`
      : `/${merchant.defaultLanguage}${url.pathname}${url.search}`;
    return redirect(targetPath);
  }

  // 3. Create SDK client
  const sdk = createStorefrontClient({
    baseUrl: import.meta.env.API_BASE_URL,
    vendorId: merchant.merchantId,
    language: lang,
  });

  // 4. Inject into locals
  locals.merchant = merchant;
  locals.lang = lang;
  locals.sdk = sdk;

  // 5. Execute page
  const response = await next();

  // 6. Add cache headers with auth/personalization guards
  const isCacheable = CACHEABLE_PATTERNS.some((p) => p.test(url.pathname));
  const hasAuthCookie = context.cookies.has('auth_token');
  const responseSetsCookie = response.headers.has('set-cookie');

  if (isCacheable && !hasAuthCookie && !responseSetsCookie) {
    const ttl = url.pathname.includes('/pages/') ? 3600 : 300;
    response.headers.set(
      'Cache-Control',
      `public, s-maxage=${ttl}, stale-while-revalidate=${ttl * 12}`,
    );
  } else if (isCacheable && (hasAuthCookie || responseSetsCookie)) {
    response.headers.set('Cache-Control', 'private, no-store');
  }

  response.headers.set('Vary', 'Cookie');

  return response;
};
