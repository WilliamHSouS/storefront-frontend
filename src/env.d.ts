/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly API_BASE_URL: string;
  readonly PUBLIC_API_BASE_URL: string;
  readonly DEFAULT_MERCHANT: string;
  readonly CUSTOM_DOMAINS: string;
  readonly PUBLIC_POSTHOG_KEY: string;
  readonly PUBLIC_POSTHOG_HOST: string;
  readonly AUTH_COOKIE_DOMAIN: string;
  readonly AUTH_COOKIE_SECURE: string;
  readonly PUBLIC_ENVIRONMENT: string;
}
