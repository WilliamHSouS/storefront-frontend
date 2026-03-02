/**
 * Stub SDK client factory used until @sous/storefront-sdk is available.
 * Provides the same interface shape so TypeScript compiles and middleware works.
 * Replace with real SDK import once Gate 1 is resolved.
 */

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

export function createStorefrontClient(options: CreateClientOptions): StorefrontClient {
  const headers: Record<string, string> = {
    'X-Vendor-ID': options.vendorId,
    'Accept-Language': options.language,
    Accept: 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const customFetch = options.fetch ?? globalThis.fetch;

  async function request(method: string, path: string, requestOptions?: RequestOptions): Promise<ApiResult> {
    const url = new URL(path, options.baseUrl);
    const params = requestOptions?.params?.query;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    let resolvedPath = url.pathname;
    const pathParams = requestOptions?.params?.path;
    if (pathParams) {
      for (const [k, v] of Object.entries(pathParams)) {
        resolvedPath = resolvedPath.replace(`{${k}}`, String(v));
      }
      url.pathname = resolvedPath;
    }

    try {
      const res = await customFetch(url.toString(), {
        method,
        headers: {
          ...headers,
          ...(requestOptions?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: requestOptions?.body ? JSON.stringify(requestOptions.body) : undefined,
      });
      if (!res.ok) {
        return { data: null, error: { status: res.status, statusText: res.statusText } };
      }
      const data = await res.json();
      return { data, error: null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }

  return {
    GET: (path, opts?) => request('GET', path, opts),
    POST: (path, opts?) => request('POST', path, opts),
    PATCH: (path, opts?) => request('PATCH', path, opts),
    DELETE: (path, opts?) => request('DELETE', path, opts),
  };
}
