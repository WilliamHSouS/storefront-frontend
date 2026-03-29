import { useState, useRef, useEffect, useCallback } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $merchant } from '@/stores/merchant';
import { $selectedProduct } from '@/stores/ui';
import { formatPrice, langToLocale } from '@/lib/currency';
import { t } from '@/i18n/client';
import { getClient } from '@/lib/api';
import { normalizeProduct, type NormalizedProduct } from '@/lib/normalize';
import { optimizedImageUrl } from '@/lib/image';
import * as log from '@/lib/logger';
import { CloseIcon, SearchIcon } from './icons';
import { withErrorBoundary } from './ErrorBoundary';

interface Props {
  lang: string;
}

function SearchBar({ lang }: Props) {
  const merchant = useStore($merchant);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NormalizedProduct[]>([]);
  const [isFallback, setIsFallback] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [featured, setFeatured] = useState<NormalizedProduct[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();
  const listRef = useRef<HTMLUListElement>(null);

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  const closeSearch = () => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setIsFallback(false);
  };

  // Clean up debounce timer and abort in-flight request on unmount
  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setIsFallback(false);
      return;
    }
    // Cancel previous in-flight search to prevent stale results
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const client = getClient();
      // Try dedicated search endpoint first, fall back to filtered product list
      const { data } = await client.GET('/api/v1/products/search/', {
        params: { query: { q } },
        signal: controller.signal,
      });
      if (data) {
        const page = data as unknown as { results: Array<Record<string, unknown>> };
        const items = page.results ?? [];
        if (items.length > 0) {
          setResults(items.map(normalizeProduct));
          setIsFallback(false);
          return;
        }
      }
      // Fallback: show popular products when search has no matches
      const { data: fallbackData } = await client.GET('/api/v1/products/', {
        params: { query: { search: q } },
        signal: controller.signal,
      });
      if (fallbackData) {
        const page = fallbackData as { results: Array<Record<string, unknown>> };
        setResults((page.results ?? []).map(normalizeProduct));
        setIsFallback(true);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      log.error('search', 'Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
      setActiveIndex(-1);
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    setActiveIndex(-1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 300);
  };

  const handleSelect = (result: NormalizedProduct) => {
    if (query.length >= 2) {
      try {
        const stored = localStorage.getItem('recentSearches');
        const existing: string[] = stored ? JSON.parse(stored) : [];
        const updated = [query, ...existing.filter((s) => s !== query)].slice(0, 5);
        localStorage.setItem('recentSearches', JSON.stringify(updated));
      } catch {
        // Ignore
      }
    }
    closeSearch();
    $selectedProduct.set({ id: String(result.id), name: result.name, slug: result.slug });
  };

  // Keyboard navigation: Escape, ArrowDown, ArrowUp, Enter
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeSearch();
        return;
      }

      // Determine the active list: search results when query >= 2, else featured products
      const activeList = query.length >= 2 ? results : featured;
      if (activeList.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev < activeList.length - 1 ? prev + 1 : 0;
          listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = prev > 0 ? prev - 1 : activeList.length - 1;
          listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
          return next;
        });
      } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < activeList.length) {
        e.preventDefault();
        handleSelect(activeList[activeIndex]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, featured, activeIndex, query]);

  // Listen for search trigger from Header button
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    document
      .querySelectorAll('[data-search-trigger]')
      .forEach((el) => el.addEventListener('click', handler));
    return () => {
      document
        .querySelectorAll('[data-search-trigger]')
        .forEach((el) => el.removeEventListener('click', handler));
    };
  }, []);

  // Fetch featured products for zero-state (once when first opened)
  useEffect(() => {
    if (!isOpen || featured.length > 0) return;

    const controller = new AbortController();
    const fetchFeatured = async () => {
      try {
        const client = getClient();
        const { data } = await client.GET('/api/v1/products/', {
          params: { query: { page_size: '6' } },
          signal: controller.signal,
        });
        if (data) {
          const page = data as { results: Array<Record<string, unknown>> };
          setFeatured((page.results ?? []).map(normalizeProduct));
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        log.error('search', 'Failed to fetch featured products:', err);
      }
    };
    fetchFeatured();
    return () => controller.abort();
  }, [isOpen]);

  // Load recent searches from localStorage
  useEffect(() => {
    if (!isOpen) return;
    try {
      const stored = localStorage.getItem('recentSearches');
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch {
      // Ignore — localStorage may be unavailable
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div class="fixed inset-0 z-50">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div class="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={closeSearch} />

      <div class="relative mx-auto mt-16 w-full max-w-lg px-4">
        <div class="overflow-hidden rounded-lg bg-card shadow-xl">
          <div class="flex items-center border-b border-border px-3">
            <SearchIcon class="shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
              placeholder={t('search', lang)}
              class="flex-1 bg-transparent px-3 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              aria-label={t('search', lang)}
            />
            {loading && (
              <div
                class="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent motion-reduce:animate-none"
                role="status"
                aria-label={t('loading', lang)}
              />
            )}
            <button
              type="button"
              onClick={closeSearch}
              class="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={t('close', lang)}
            >
              <CloseIcon />
            </button>
          </div>

          {results.length > 0 && (
            <div>
              {isFallback && (
                <div class="border-b border-border px-3 py-3">
                  <p class="text-sm font-medium text-muted-foreground">
                    {t('noResultsFor', lang, { query })}
                  </p>
                  <p class="mt-0.5 text-xs text-muted-foreground/70">{t('youMightLike', lang)}</p>
                </div>
              )}
              <ul
                ref={query.length >= 2 ? listRef : undefined}
                class="max-h-64 overflow-y-auto py-1"
                role="listbox"
                aria-label={t('search', lang)}
              >
                {results.map((result, idx) => (
                  <li key={result.id} role="option" aria-selected={idx === activeIndex}>
                    <button
                      type="button"
                      onClick={() => handleSelect(result)}
                      class={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent ${
                        query.length >= 2 && idx === activeIndex ? 'bg-accent' : ''
                      }`}
                    >
                      {result.image && (
                        <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
                          <img
                            src={optimizedImageUrl(result.image, { width: 80 })}
                            alt=""
                            class="h-full w-full object-cover"
                            width="40"
                            height="40"
                            loading="lazy"
                          />
                        </div>
                      )}
                      <div class="flex-1">
                        <span class="text-sm font-medium text-card-foreground">{result.name}</span>
                      </div>
                      <span class="text-sm text-muted-foreground">
                        {formatPrice(result.price, currency, locale)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {query.length < 2 && results.length === 0 && (
            <div class="max-h-64 overflow-y-auto">
              {/* Recent searches */}
              {recentSearches.length > 0 && (
                <div class="border-b border-border px-3 py-2">
                  <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('recentSearches', lang)}
                  </h3>
                  <ul>
                    {recentSearches.map((term) => (
                      <li key={term}>
                        <button
                          type="button"
                          onClick={() => {
                            setQuery(term);
                            search(term);
                          }}
                          class="flex w-full items-center gap-2 rounded px-1 py-1.5 text-sm text-card-foreground hover:bg-accent"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            class="text-muted-foreground"
                          >
                            <polyline points="1 4 1 10 7 10" />
                            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                          </svg>
                          {term}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Featured products */}
              {featured.length > 0 && (
                <div class="px-3 py-2">
                  <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('popularItems', lang)}
                  </h3>
                  <ul
                    ref={query.length < 2 ? listRef : undefined}
                    role="listbox"
                    aria-label={t('popularItems', lang)}
                  >
                    {featured.map((product, idx) => (
                      <li key={product.id} role="option" aria-selected={idx === activeIndex}>
                        <button
                          type="button"
                          onClick={() => handleSelect(product)}
                          class={`flex w-full items-center gap-3 rounded px-1 py-2 text-left hover:bg-accent ${
                            query.length < 2 && idx === activeIndex ? 'bg-accent' : ''
                          }`}
                        >
                          {product.image && (
                            <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
                              <img
                                src={optimizedImageUrl(product.image, { width: 80 })}
                                alt=""
                                class="h-full w-full object-cover"
                                width="40"
                                height="40"
                                loading="lazy"
                              />
                            </div>
                          )}
                          <div class="flex-1">
                            <span class="text-sm font-medium text-card-foreground">
                              {product.name}
                            </span>
                          </div>
                          <span class="text-sm text-muted-foreground">
                            {formatPrice(product.price, currency, locale)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {query.length >= 2 && results.length === 0 && !loading && (
            <div class="px-3 py-6 text-center text-sm text-muted-foreground">
              {t('noResults', lang)}
            </div>
          )}

          <div class="flex items-center justify-end border-t border-border px-3 py-2">
            <span class="text-xs text-muted-foreground">
              <kbd class="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                Esc
              </kbd>{' '}
              {t('close', lang)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default withErrorBoundary(SearchBar, 'SearchBar');
