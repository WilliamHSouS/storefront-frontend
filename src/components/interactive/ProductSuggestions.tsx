import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { addSuggestionToCart, type Suggestion } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import { $selectedProduct } from '@/stores/ui';
import { formatPrice, langToLocale } from '@/lib/currency';
import { getClient } from '@/lib/api';
import { t } from '@/i18n';

interface Props {
  productId: string;
  lang: string;
}

export default function ProductSuggestions({ productId, lang }: Props) {
  const merchant = useStore($merchant);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const client = getClient();
        const { data } = await client.GET(`/api/v1/products/{id}/suggestions/`, {
          params: { path: { id: productId } },
        });
        if (data) setSuggestions(data as Suggestion[]);
      } catch {
        // Suggestions are non-critical
      }
    };
    fetchSuggestions();
  }, [productId]);

  const handleAdd = async (s: Suggestion) => {
    const result = await addSuggestionToCart(s.id);
    if (result === 'added') {
      setAddedIds((prev) => new Set([...prev, s.id]));
    } else if (result === 'requires_options') {
      $selectedProduct.set({ id: String(s.id), name: s.title });
    }
  };

  const visible = suggestions.filter((s) => !addedIds.has(s.id));
  if (visible.length === 0) return null;

  return (
    <div class="mt-6">
      <h2 class="text-sm font-semibold text-foreground">{t('frequentlyCombined', lang)}</h2>
      <div class="mt-2 flex gap-3 overflow-x-auto pb-1">
        {visible.map((s) => (
          <div
            key={s.id}
            class="flex w-32 shrink-0 flex-col items-center rounded-lg border border-border p-2"
          >
            {s.image_url ? (
              <div class="mb-1.5 h-16 w-16 overflow-hidden rounded bg-card-image">
                <img
                  src={s.image_url}
                  alt=""
                  class="h-full w-full object-cover"
                  width="64"
                  height="64"
                  loading="lazy"
                />
              </div>
            ) : (
              <div class="mb-1.5 h-16 w-16 rounded bg-card-image" />
            )}
            <span class="line-clamp-2 text-center text-xs text-foreground">{s.title}</span>
            <span class="text-xs text-muted-foreground">
              {formatPrice(s.price, currency, locale)}
            </span>
            <button
              type="button"
              onClick={() => handleAdd(s)}
              class="mt-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
              aria-label={`${t('addToCart', lang)} ${s.title}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
