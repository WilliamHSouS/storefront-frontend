import { useEffect } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $addressCoords } from '@/stores/address';
import { getClient } from '@/lib/api';
import { t } from '@/i18n';
import type { AddressCoords, ProductFulfillment } from '@/types/address';

interface Props {
  lang: string;
}

// Pure logic — exported for testing
export function getBadgeForProduct(
  coords: AddressCoords | null,
  fulfillmentTypes: string[],
  pickupOnly: boolean,
): 'pickupOnly' | 'shipsSeparately' | null {
  if (!coords) return null;
  if (pickupOnly || (fulfillmentTypes.length === 1 && fulfillmentTypes[0] === 'pickup')) {
    return 'pickupOnly';
  }
  if (fulfillmentTypes.length === 1 && fulfillmentTypes[0] === 'nationwide_delivery') {
    return 'shipsSeparately';
  }
  return null;
}

export function shouldHideProduct(
  coords: AddressCoords | null,
  fulfillmentTypes: string[],
): boolean {
  if (!coords) return false;
  return fulfillmentTypes.length === 0;
}

/** Create a badge element using safe DOM methods (no innerHTML) */
function createBadgeElement(text: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className =
    'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground';
  badge.textContent = text;
  return badge;
}

/** Exported for DOM integration tests */
export function applyFulfillmentToDOM(
  fulfillmentMap: Map<string, ProductFulfillment>,
  coords: AddressCoords,
  lang: string,
): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-product-id]');

  for (const card of cards) {
    const productId = card.dataset.productId;
    if (!productId) continue;

    const fulfillment = fulfillmentMap.get(productId);
    const badgeSlot = card.querySelector<HTMLElement>('[data-fulfillment-badge]');

    if (!fulfillment) {
      // Product absent from API response — may be beyond page_size or not yet indexed.
      // Show without badge rather than hiding, to avoid removing purchasable items.
      card.classList.remove('hidden');
      if (badgeSlot) badgeSlot.replaceChildren();
      continue;
    }

    // Hide products explicitly marked as unavailable (empty fulfillment types)
    if (shouldHideProduct(coords, fulfillment.availableFulfillmentTypes)) {
      card.classList.add('hidden');
      if (badgeSlot) badgeSlot.replaceChildren();
      continue;
    }

    card.classList.remove('hidden');

    const badge = getBadgeForProduct(
      coords,
      fulfillment.availableFulfillmentTypes,
      fulfillment.pickupOnly,
    );

    if (badgeSlot) {
      badgeSlot.replaceChildren();
      if (badge === 'pickupOnly') {
        badgeSlot.appendChild(createBadgeElement(t('pickupOnly', lang)));
      } else if (badge === 'shipsSeparately') {
        badgeSlot.appendChild(createBadgeElement(t('shipsSeparately', lang)));
      }
    }
  }

  const sections = document.querySelectorAll<HTMLElement>('[data-menu-section]');
  for (const section of sections) {
    const visibleCards = section.querySelectorAll('[data-product-id]:not(.hidden)');
    if (visibleCards.length === 0) {
      section.classList.add('hidden');
    } else {
      section.classList.remove('hidden');
    }
  }
}

function clearAllBadges(): void {
  const badges = document.querySelectorAll<HTMLElement>('[data-fulfillment-badge]');
  for (const badge of badges) {
    badge.replaceChildren();
  }
}

function showAllProducts(): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-product-id]');
  for (const card of cards) {
    card.classList.remove('hidden');
  }
  const sections = document.querySelectorAll<HTMLElement>('[data-menu-section]');
  for (const section of sections) {
    section.classList.remove('hidden');
  }
}

export function FulfillmentOverlay({ lang }: Props) {
  const coords = useStore($addressCoords);

  useEffect(() => {
    if (!coords) {
      clearAllBadges();
      showAllProducts();
      return;
    }

    let stale = false;
    fetchAndApplyFulfillment(coords, lang, () => stale);
    return () => {
      stale = true;
    };
  }, [coords, lang]);

  return <div data-fulfillment-overlay />;
}

async function fetchAndApplyFulfillment(
  coords: AddressCoords,
  lang: string,
  isStale: () => boolean = () => false,
): Promise<void> {
  try {
    const client = getClient();
    const { data } = await client.GET('/api/v1/products/', {
      params: {
        query: { latitude: coords.latitude, longitude: coords.longitude, page_size: 200 },
      },
    });

    if (isStale()) return;

    const r = data as Record<string, unknown>;
    if (!r || !Array.isArray(r.results)) return;

    if (r.next != null) {
      console.warn(
        'FulfillmentOverlay: product response is paginated — some products may lack badges.',
      );
    }

    const fulfillmentMap = new Map<string, ProductFulfillment>();
    for (const product of r.results as Array<Record<string, unknown>>) {
      fulfillmentMap.set(String(product.id), {
        productId: String(product.id),
        availableFulfillmentTypes:
          (product.address_fulfillment_types as string[]) ??
          (product.available_fulfillment_types as string[]) ??
          [],
        pickupOnly: product.pickup_only === true,
      });
    }

    applyFulfillmentToDOM(fulfillmentMap, coords, lang);
  } catch {
    if (isStale()) return;
    clearAllBadges();
    showAllProducts();
  }
}
