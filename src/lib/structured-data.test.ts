import { describe, it, expect } from 'vitest';
import {
  generateRestaurantLD,
  generateProductLD,
  generateMenuItemLD,
  generateBreadcrumbLD,
  generateItemListLD,
  expandDayRange,
} from './structured-data';

interface JsonLd extends Record<string, unknown> {
  offers: Record<string, unknown>;
  itemListElement: Array<Record<string, unknown>>;
}

const merchant = {
  slug: 'bar-sumac',
  merchantId: 'F9GJG923RBKMZYS',
  name: 'Bar Sumac',
  description: 'Mediterranean-inspired kitchen',
  logo: '/merchants/bar-sumac/logo.svg',
  heroImage: '/merchants/bar-sumac/hero.jpg',
  favicon: '/merchants/bar-sumac/favicon.ico',
  languages: ['nl', 'en'],
  defaultLanguage: 'nl',
  currency: 'EUR',
  theme: {} as any,
  layout: 'grid' as const,
  contact: {
    phone: '+31 20 123 4567',
    email: 'info@barsumac.nl',
    address: 'Keizersgracht 123, 1015 Amsterdam',
  },
  hours: [{ days: 'Mon-Fri', open: '11:00', close: '22:00' }],
  social: { instagram: 'https://instagram.com/barsumac' },
  seo: {
    titleTemplate: '%s | Bar Sumac',
    defaultDescription: 'Bestel online bij Bar Sumac',
  },
};

describe('expandDayRange', () => {
  it('expands a contiguous range', () => {
    expect(expandDayRange('Mon-Fri')).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ]);
  });

  it('expands weekend range', () => {
    expect(expandDayRange('Sat-Sun')).toEqual(['Saturday', 'Sunday']);
  });

  it('handles comma-separated days', () => {
    expect(expandDayRange('Mon, Wed, Fri')).toEqual(['Monday', 'Wednesday', 'Friday']);
  });

  it('handles single day', () => {
    expect(expandDayRange('Tuesday')).toEqual(['Tuesday']);
  });

  it('returns empty array for unrecognized input', () => {
    expect(expandDayRange('Gibberish')).toEqual([]);
  });

  it('returns empty array for reversed range', () => {
    expect(expandDayRange('Fri-Mon')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(expandDayRange('MON-WED')).toEqual(['Monday', 'Tuesday', 'Wednesday']);
  });
});

describe('generateRestaurantLD', () => {
  it('returns a Restaurant schema with correct fields', () => {
    const ld = generateRestaurantLD(merchant, 'https://bar-sumac.poweredbysous.com', 'nl');
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Restaurant');
    expect(ld.name).toBe('Bar Sumac');
    expect(ld.description).toBe('Mediterranean-inspired kitchen');
    expect(ld.telephone).toBe('+31 20 123 4567');
    expect(ld.url).toBe('https://bar-sumac.poweredbysous.com');
    expect(ld.image).toBe('/merchants/bar-sumac/hero.jpg');
  });

  it('resolves per-language description', () => {
    const multiLangMerchant = {
      ...merchant,
      description: {
        nl: 'Mediterraans geïnspireerde keuken',
        en: 'Mediterranean-inspired kitchen',
      },
    };
    const ldNl = generateRestaurantLD(multiLangMerchant, 'https://example.com', 'nl');
    expect(ldNl.description).toBe('Mediterraans geïnspireerde keuken');
    const ldEn = generateRestaurantLD(multiLangMerchant, 'https://example.com', 'en');
    expect(ldEn.description).toBe('Mediterranean-inspired kitchen');
  });

  it('includes address', () => {
    const ld = generateRestaurantLD(merchant, 'https://example.com', 'nl');
    expect(ld.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Keizersgracht 123, 1015 Amsterdam',
    });
  });

  it('includes openingHoursSpecification from merchant hours', () => {
    const ld = generateRestaurantLD(merchant, 'https://bar-sumac.poweredbysous.com', 'nl');
    const specs = ld.openingHoursSpecification as Array<Record<string, unknown>>;
    expect(specs).toHaveLength(1);
    expect(specs[0]['@type']).toBe('OpeningHoursSpecification');
    expect(specs[0].dayOfWeek).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
    ]);
    expect(specs[0].opens).toBe('11:00');
    expect(specs[0].closes).toBe('22:00');
  });

  it('includes menu link and sameAs social profiles', () => {
    const ld = generateRestaurantLD(merchant, 'https://bar-sumac.poweredbysous.com', 'nl');
    expect(ld.menu).toBe('https://bar-sumac.poweredbysous.com');
    expect(ld.sameAs).toEqual(['https://instagram.com/barsumac']);
  });

  it('omits sameAs when social is empty', () => {
    const m = { ...merchant, social: {} };
    const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
    expect(ld.sameAs).toBeUndefined();
  });

  it('omits openingHoursSpecification when hours is empty', () => {
    const m = { ...merchant, hours: [] };
    const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
    expect(ld.openingHoursSpecification).toBeUndefined();
  });

  it('handles comma-separated days in hours', () => {
    const m = { ...merchant, hours: [{ days: 'Mon, Wed, Fri', open: '10:00', close: '18:00' }] };
    const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
    const specs = ld.openingHoursSpecification as Array<Record<string, unknown>>;
    expect(specs[0].dayOfWeek).toEqual(['Monday', 'Wednesday', 'Friday']);
  });

  it('skips hours entries with unrecognized day format', () => {
    const m = { ...merchant, hours: [{ days: 'Gibberish', open: '10:00', close: '18:00' }] };
    const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
    expect(ld.openingHoursSpecification).toBeUndefined();
  });

  it('includes servesCuisine and priceRange when present', () => {
    const m = { ...merchant, cuisine: 'Mediterranean', priceRange: '$$' };
    const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
    expect(ld.servesCuisine).toBe('Mediterranean');
    expect(ld.priceRange).toBe('$$');
  });

  it('omits servesCuisine and priceRange when absent', () => {
    const ld = generateRestaurantLD(merchant, 'https://example.com', 'nl');
    expect(ld.servesCuisine).toBeUndefined();
    expect(ld.priceRange).toBeUndefined();
  });
});

describe('generateProductLD', () => {
  it('uses dual Product+MenuItem type', () => {
    const product = { name: 'Falafel Wrap', price: '8.50' };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel');
    expect(ld['@type']).toEqual(['Product', 'MenuItem']);
  });

  it('includes basic offer fields', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', description: 'Crispy falafel' };
    const ld = generateProductLD(
      product,
      'EUR',
      'https://example.com/nl/product/falafel',
    ) as JsonLd;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld.name).toBe('Falafel Wrap');
    expect(ld.offers['@type']).toBe('Offer');
    expect(ld.offers.price).toBe('8.50');
    expect(ld.offers.priceCurrency).toBe('EUR');
  });

  it('includes availability InStock when available and not sold out', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', is_available: true, sold_out: false };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBe('https://schema.org/InStock');
  });

  it('marks as SoldOut when sold_out is true', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', is_available: true, sold_out: true };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBe('https://schema.org/SoldOut');
  });

  it('marks as Discontinued when not available', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', is_available: false };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBe('https://schema.org/Discontinued');
  });

  it('omits availability when not provided', () => {
    const product = { name: 'Falafel Wrap', price: '8.50' };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBeUndefined();
  });

  it('uses images array when provided', () => {
    const product = {
      name: 'Falafel Wrap',
      price: '8.50',
      image: 'https://example.com/img1.jpg',
      images: [
        { image_url: 'https://example.com/img1.jpg', alt_text: 'front' },
        { image_url: 'https://example.com/img2.jpg', alt_text: 'side' },
      ],
    };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel');
    expect(ld.image).toEqual(['https://example.com/img1.jpg', 'https://example.com/img2.jpg']);
  });

  it('falls back to single image string', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', image: 'https://example.com/img1.jpg' };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel');
    expect(ld.image).toBe('https://example.com/img1.jpg');
  });
});

describe('generateMenuItemLD (deprecated alias)', () => {
  it('is the same function as generateProductLD', () => {
    expect(generateMenuItemLD).toBe(generateProductLD);
  });
});

describe('generateBreadcrumbLD', () => {
  it('returns a BreadcrumbList with correct positions', () => {
    const items = [
      { name: 'Menu', url: '/nl/' },
      { name: 'Mezze', url: '/nl/category/mezze' },
    ];
    const ld = generateBreadcrumbLD(items) as JsonLd;
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[0].position).toBe(1);
    expect(ld.itemListElement[0].item).toBe('/nl/');
    expect(ld.itemListElement[1].position).toBe(2);
    expect(ld.itemListElement[1].name).toBe('Mezze');
  });
});

describe('generateItemListLD', () => {
  it('returns an ItemList with ListItems for each product', () => {
    const products = [
      { name: 'Falafel Wrap', url: 'https://example.com/nl/product/falafel-wrap--1' },
      { name: 'Hummus', url: 'https://example.com/nl/product/hummus--2' },
    ];
    const ld = generateItemListLD('Mezze', products);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('ItemList');
    expect(ld.name).toBe('Mezze');
    expect(ld.numberOfItems).toBe(2);
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: 'https://example.com/nl/product/falafel-wrap--1',
    });
  });

  it('handles empty product list', () => {
    const ld = generateItemListLD('Empty', []);
    expect(ld.numberOfItems).toBe(0);
    expect((ld.itemListElement as unknown[]).length).toBe(0);
  });
});
