/**
 * Compatibility wrapper around @poweredbysous/storefront-sdk.
 *
 * The real SDK returns openapi-fetch's `{ data?, error?, response }` shape.
 * This wrapper adapts responses to the `ApiResult` discriminated union that
 * all consumer code already relies on, so zero call-site changes are needed.
 */

import { createStorefrontClient as createRealClient } from '@poweredbysous/storefront-sdk';

export interface ApiError {
  status: number;
  statusText: string;
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
  fetch?: typeof globalThis.fetch;
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
  const realClient = createRealClient({
    baseUrl: options.baseUrl,
    vendorId: options.vendorId,
    language: options.language,
    token: options.token,
    fetch: options.fetch,
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
