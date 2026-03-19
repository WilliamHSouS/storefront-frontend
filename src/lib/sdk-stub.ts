/**
 * Compatibility wrapper around @poweredbysous/storefront-sdk.
 *
 * The real SDK returns openapi-fetch's `{ data?, error?, response }` shape.
 * This wrapper adapts responses to the `ApiResult` discriminated union that
 * all consumer code already relies on, so zero call-site changes are needed.
 *
 * When an `hmacSecret` is provided, write requests (POST/PATCH/PUT/DELETE) are
 * signed with HMAC-SHA256 via the Web Crypto API / Node crypto module.
 */

import { createStorefrontClient as createRealClient } from '@poweredbysous/storefront-sdk';

export interface ApiError {
  status: number;
  statusText: string;
  /** Parsed JSON body from the API error response (e.g. `{ code, message, details }`). */
  body?: unknown;
}

export type ApiResult<T = unknown> =
  | { data: T; error: null }
  | { data: null; error: ApiError | Error };

export interface RequestOptions {
  params?: {
    query?: Record<string, string | number | boolean | undefined>;
    path?: Record<string, string | number>;
  };
  body?: unknown;
  signal?: AbortSignal;
}

export interface StorefrontClient {
  GET: (path: string, options?: RequestOptions) => Promise<ApiResult>;
  POST: (path: string, options?: RequestOptions) => Promise<ApiResult>;
  PATCH: (path: string, options?: RequestOptions) => Promise<ApiResult>;
  DELETE: (path: string, options?: RequestOptions) => Promise<ApiResult>;
}

export interface CreateClientOptions {
  baseUrl: string;
  vendorId: string;
  language: string;
  token?: string;
  hmacSecret?: string;
  fetch?: typeof globalThis.fetch;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function computeHmac(body: string, secret: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    // Browser / Node 18+ with Web Crypto
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Node.js fallback (SSR)
  const { createHmac } = await import('node:crypto');
  return createHmac('sha256', secret).update(body).digest('hex');
}

function createSigningFetch(
  baseFetch: typeof globalThis.fetch,
  secret: string,
): typeof globalThis.fetch {
  return async (input, init?) => {
    // Resolve method from init, or from a Request object passed as input.
    // openapi-fetch passes a Request as the first arg; the SDK's authFetch
    // forwards it with only { headers } in init (no method).
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    // Resolve body: prefer init.body, then clone+read the Request body.
    let bodyStr = '';
    if (WRITE_METHODS.has(method)) {
      if (init?.body != null) {
        bodyStr = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
      } else if (input instanceof Request && input.body) {
        bodyStr = await input.clone().text();
      }
    }
    const signature = await computeHmac(bodyStr, secret);
    const headers = new Headers(init?.headers);
    headers.set('X-Vendor-Signature', signature);
    return baseFetch(input, { ...init, headers });
  };
}

/** Adapt openapi-fetch's `{ data?, error?, response }` to our `ApiResult` union. */
interface RawSdkResponse {
  data?: unknown;
  error?: unknown;
  response?: { status: number; statusText: string };
}

function adaptResponse({ data, error, response }: RawSdkResponse): ApiResult {
  if (error !== undefined) {
    return {
      data: null,
      error: {
        status: response?.status ?? 0,
        statusText: response?.statusText ?? '',
        body: error,
      },
    };
  }
  return { data, error: null };
}

/** Wrap an SDK call so thrown exceptions (network errors, etc.) become ApiResult. */
function wrapCall(promise: Promise<RawSdkResponse>): Promise<ApiResult> {
  return promise.then(adaptResponse).catch((err: unknown) => ({
    data: null,
    error: err instanceof Error ? err : new Error(String(err)),
  }));
}

export function createStorefrontClient(options: CreateClientOptions): StorefrontClient {
  const baseFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  // Add X-Merchant-ID header before HMAC signing (backend migration from X-Vendor-ID)
  const merchantId = options.vendorId;
  const merchantFetch: typeof baseFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('X-Merchant-ID', merchantId);
    return baseFetch(input, { ...init, headers });
  };

  const fetchFn = options.hmacSecret
    ? createSigningFetch(merchantFetch, options.hmacSecret)
    : merchantFetch;

  const realClient = createRealClient({
    baseUrl: options.baseUrl,
    vendorId: options.vendorId,
    language: options.language,
    token: options.token,
    fetch: fetchFn,
  });

  /* eslint-disable @typescript-eslint/no-explicit-any -- intentional: shim erases strict OpenAPI path-literal types */
  return {
    GET: (path, opts?) => wrapCall(realClient.GET(path as any, opts as any)),
    POST: (path, opts?) => wrapCall(realClient.POST(path as any, opts as any)),
    PATCH: (path, opts?) => wrapCall(realClient.PATCH(path as any, opts as any)),
    DELETE: (path, opts?) => wrapCall(realClient.DELETE(path as any, opts as any)),
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
