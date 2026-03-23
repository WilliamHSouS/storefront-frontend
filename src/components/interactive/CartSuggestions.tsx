import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $cart, addSuggestionToCart, type Suggestion } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import { $selectedProduct, $isCartOpen } from '@/stores/ui';
import { formatPrice, langToLocale } from '@/lib/currency';
import { getClient } from '@/lib/api';
import { t } from '@/i18n/client';
import { optimizedImageUrl } from '@/lib/image';

interface Props {
  lang: string;
}

export default function CartSuggestions({ lang }: Props) {
  const cart = useStore($cart);
  const merchant = useStore($merchant);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  // Fetch cart-level suggestions when cart changes
  useEffect(() => {
    if (!cart?.id) {
      setSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      try {
        const client = getClient();
        const { data } = await client.GET(`/api/v1/cart/{cart_id}/suggestions/`, {
          params: { path: { cart_id: cart.id } },
        });
        if (data) {
          setSuggestions(data as Suggestion[]);
          setAddedIds(new Set());
        }
      } catch {
        // Silently fail — suggestions are non-critical
      }
    };
    fetchSuggestions();
  }, [
    cart?.id,
    JSON.stringify(
      cart?.line_items?.map((i: { product_id: string | number }) => i.product_id).sort(),
    ),
  ]);

  const visible = suggestions.filter((s) => !addedIds.has(s.id));
  if (visible.length === 0) return null;

  return (
    <div class="mb-3">
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('completeYourOrder', lang)}
      </h3>
      <div class="flex gap-2 overflow-x-auto pb-1">
        {visible.map((s) => (
          <div
            key={s.id}
            class="flex w-28 shrink-0 flex-col items-center rounded-lg border border-border p-2"
          >
            {s.image_url ? (
              <div class="mb-1.5 h-14 w-14 overflow-hidden rounded bg-card-image">
                <img
                  src={optimizedImageUrl(s.image_url, { width: 112 })}
                  alt=""
                  class="h-full w-full object-cover"
                  width="56"
                  height="56"
                  loading="lazy"
                />
              </div>
            ) : (
              <div class="mb-1.5 h-14 w-14 rounded bg-card-image" />
            )}
            <span class="line-clamp-1 text-center text-xs text-card-foreground">{s.title}</span>
            <span class="text-xs text-muted-foreground">
              {formatPrice(s.price, currency, locale)}
            </span>
            <button
              type="button"
              onClick={async () => {
                const result = await addSuggestionToCart(s.id);
                if (result === 'added') {
                  setAddedIds((prev) => new Set([...prev, s.id]));
                } else if (result === 'requires_options') {
                  $isCartOpen.set(false);
                  $selectedProduct.set({ id: String(s.id), name: s.title });
                }
              }}
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
