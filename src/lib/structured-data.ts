import type { MerchantConfig } from '@/types/merchant';
import { getMerchantDescription } from '@/types/merchant';

const DAY_MAP: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Expand "Mon-Fri" or "Mon, Wed, Fri" into Schema.org day names. Returns [] on bad input. */
export function expandDayRange(days: string): string[] {
  const trimmed = days.trim().toLowerCase();

  // Comma-separated: "Mon, Wed, Fri"
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((s) => s.trim().slice(0, 3))
      .filter((d) => DAY_MAP[d])
      .map((d) => DAY_MAP[d]);
  }

  // Range: "Mon-Fri"
  if (trimmed.includes('-')) {
    const parts = trimmed.split('-').map((s) => s.trim().slice(0, 3));
    if (parts.length === 2) {
      const start = DAY_ORDER.indexOf(parts[0]);
      const end = DAY_ORDER.indexOf(parts[1]);
      if (start >= 0 && end >= 0 && start <= end) {
        return DAY_ORDER.slice(start, end + 1).map((d) => DAY_MAP[d]);
      }
    }
    // Looks like a range but invalid (e.g. reversed) — don't fall through
    return [];
  }

  // Single day: "Mon"
  const key = trimmed.slice(0, 3);
  if (DAY_MAP[key]) return [DAY_MAP[key]];

  return [];
}

export function generateRestaurantLD(
  merchant: MerchantConfig,
  siteUrl: string,
  lang?: string,
): Record<string, unknown> {
  const hoursSpecs = merchant.hours
    .map((h) => {
      const dayOfWeek = expandDayRange(h.days);
      if (dayOfWeek.length === 0) return null;
      return {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek,
        opens: h.open,
        closes: h.close,
      };
    })
    .filter(Boolean);

  const socialLinks = Object.values(merchant.social ?? {});

  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: merchant.name,
    description: getMerchantDescription(merchant, lang ?? merchant.defaultLanguage),
    url: siteUrl,
    menu: siteUrl,
    telephone: merchant.contact.phone,
    image: merchant.heroImage,
    address: {
      '@type': 'PostalAddress',
      streetAddress: merchant.contact.address,
    },
    ...(merchant.logo ? { logo: merchant.logo } : {}),
    ...(hoursSpecs.length > 0 ? { openingHoursSpecification: hoursSpecs } : {}),
    ...(socialLinks.length > 0 ? { sameAs: socialLinks } : {}),
    ...(merchant.cuisine ? { servesCuisine: merchant.cuisine } : {}),
    ...(merchant.priceRange ? { priceRange: merchant.priceRange } : {}),
  };
}

export function generateProductLD(
  product: {
    name: string;
    price: string;
    description?: string;
    image?: string | null;
    images?: Array<{ image_url: string; alt_text: string }>;
    is_available?: boolean;
    sold_out?: boolean;
  },
  currency: string,
  productUrl: string,
): Record<string, unknown> {
  const imageList =
    product.images && product.images.length > 0
      ? product.images.map((img) => img.image_url)
      : undefined;

  let availability: string | undefined;
  if (product.is_available != null) {
    if (product.sold_out) {
      availability = 'https://schema.org/SoldOut';
    } else if (product.is_available) {
      availability = 'https://schema.org/InStock';
    } else {
      availability = 'https://schema.org/Discontinued';
    }
  }

  return {
    '@context': 'https://schema.org',
    '@type': ['Product', 'MenuItem'],
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(imageList ? { image: imageList } : product.image ? { image: product.image } : {}),
    url: productUrl,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: currency,
      ...(availability ? { availability } : {}),
    },
  };
}

/** @deprecated Use generateProductLD */
export const generateMenuItemLD = generateProductLD;

export function generateBreadcrumbLD(
  items: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function generateItemListLD(
  name: string,
  products: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: p.url,
    })),
  };
}
