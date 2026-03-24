import { useState, useRef, useEffect } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $addressCoords } from '@/stores/address';
import { onAddressChange, clearAddress, hydrateAddressFromStorage } from '@/stores/address-actions';
import { t } from '@/i18n/client';

// Decoupled from component lifecycle to avoid remount loops where store
// updates trigger Astro island re-hydration. Deferred to avoid competing
// with island hydration for CPU time.
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => hydrateAddressFromStorage());
  } else {
    setTimeout(() => hydrateAddressFromStorage(), 1000);
  }
}

interface Props {
  lang: string;
}

const LANG_TO_COUNTRY: Record<string, string> = {
  nl: 'NL',
  de: 'DE',
  en: 'NL',
};

export function AddressBar({ lang }: Props) {
  const coords = useStore($addressCoords);
  const [expanded, setExpanded] = useState(false);
  const [postcode, setPostcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for expand events from DeliveryBanner / ShippingEstimate
  useEffect(() => {
    const handler = () => setExpanded(true);
    document.addEventListener('address-bar:expand', handler);
    return () => document.removeEventListener('address-bar:expand', handler);
  }, []);

  // Focus input when expanding
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const country = LANG_TO_COUNTRY[lang] ?? 'NL';

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const trimmed = postcode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    const result = await onAddressChange({ postalCode: trimmed, country });

    setLoading(false);

    if (result.success) {
      setExpanded(false);
      setPostcode('');
    } else {
      if (result.error === 'network') {
        setError(t('connectionProblem', lang));
      } else {
        setError(t('postcodeNotFound', lang));
      }
    }
  }

  function handleClear(e: Event) {
    e.stopPropagation();
    clearAddress();
    setPostcode('');
    setError(null);
  }

  function handleExpand() {
    if (!expanded) {
      setExpanded(true);
      setError(null);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setExpanded(false);
      setError(null);
    }
  }

  const pinIcon = (
    <svg
      class="h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );

  // Compact state: address set
  if (coords && !expanded) {
    return (
      <div class="flex items-center gap-1.5 text-sm">
        <span class="text-muted-foreground">{pinIcon}</span>
        <button
          onClick={handleExpand}
          class="font-medium hover:underline"
          aria-expanded="false"
          aria-label={`${t('enterPostcode', lang)}: ${coords.postalCode}`}
        >
          {coords.postalCode}
        </button>
        <button
          onClick={handleClear}
          class="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={t('clearAddress', lang)}
        >
          <svg
            class="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  // Compact state: no address
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground cursor-pointer"
        aria-expanded="false"
        aria-label={t('enterPostcode', lang)}
      >
        {pinIcon}
        <span>{t('enterPostcode', lang)}</span>
      </button>
    );
  }

  // Expanded state: input mode
  return (
    <div class="flex items-center gap-1.5">
      <span class="text-muted-foreground">{pinIcon}</span>
      <form onSubmit={handleSubmit} class="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={postcode}
          onInput={(e) => setPostcode((e.target as HTMLInputElement).value)}
          placeholder={t('enterPostcode', lang)}
          aria-label={t('enterPostcode', lang)}
          maxLength={10}
          autoComplete="postal-code"
          class="w-24 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={loading}
          onKeyDown={handleKeyDown}
        />
        <button
          type="submit"
          disabled={loading || !postcode.trim()}
          class="rounded bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {loading ? (
            <svg
              class="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" />
            </svg>
          ) : (
            t('checkAddress', lang)
          )}
        </button>
        {error && (
          <span role="alert" class="text-xs text-destructive whitespace-nowrap">
            {error}
          </span>
        )}
      </form>
    </div>
  );
}
