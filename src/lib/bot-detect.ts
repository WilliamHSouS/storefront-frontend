/**
 * Detect whether a User-Agent string belongs to a known bot/crawler.
 *
 * Used to serve full SSR pages to crawlers for SEO while redirecting
 * real browsers to the SPA modal experience.
 */

const BOT_PATTERN =
  /bot|crawl|spider|slurp|facebookexternalhit|linkedinbot|twitterbot|whatsapp|googlebot|bingbot|applebot|chatgpt-user|claudebot|bytespider|yandex|baidu|duckduckbot|semrush|ahrefsbot|mj12bot|petalbot|gptbot/i;

export function isBot(userAgent: string): boolean {
  return BOT_PATTERN.test(userAgent);
}
