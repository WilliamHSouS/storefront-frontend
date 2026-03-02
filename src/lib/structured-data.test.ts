import { describe, it, expect } from 'vitest';
import { generateRestaurantLD, generateMenuItemLD, generateBreadcrumbLD } from './structured-data';

const merchant = {
  slug: 'bar-sumac',
  merchantId: 'BAR_SUMAC_01',
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

describe('generateRestaurantLD', () => {
  it('returns a Restaurant schema with correct fields', () => {
    const ld = generateRestaurantLD(merchant, 'https://bar-sumac.poweredbysous.com');
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Restaurant');
    expect(ld.name).toBe('Bar Sumac');
    expect(ld.description).toBe('Mediterranean-inspired kitchen');
    expect(ld.telephone).toBe('+31 20 123 4567');
    expect(ld.url).toBe('https://bar-sumac.poweredbysous.com');
    expect(ld.image).toBe('/merchants/bar-sumac/hero.jpg');
  });

  it('includes address', () => {
    const ld = generateRestaurantLD(merchant, 'https://example.com');
    expect(ld.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Keizersgracht 123, 1015 Amsterdam',
    });
  });
});

describe('generateMenuItemLD', () => {
  it('returns a MenuItem schema with offer', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', description: 'Crispy falafel' };
    const ld = generateMenuItemLD(product, 'EUR', 'https://example.com/nl/product/falafel');
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('MenuItem');
    expect(ld.name).toBe('Falafel Wrap');
    expect(ld.offers['@type']).toBe('Offer');
    expect(ld.offers.price).toBe('8.50');
    expect(ld.offers.priceCurrency).toBe('EUR');
  });
});

describe('generateBreadcrumbLD', () => {
  it('returns a BreadcrumbList with correct positions', () => {
    const items = [
      { name: 'Menu', url: '/nl/' },
      { name: 'Mezze', url: '/nl/category/mezze' },
    ];
    const ld = generateBreadcrumbLD(items);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('BreadcrumbList');
    expect(ld.itemListElement).toHaveLength(2);
    expect(ld.itemListElement[0].position).toBe(1);
    expect(ld.itemListElement[0].item).toBe('/nl/');
    expect(ld.itemListElement[1].position).toBe(2);
    expect(ld.itemListElement[1].name).toBe('Mezze');
  });
});
