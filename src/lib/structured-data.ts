import type { MerchantConfig } from '@/types/merchant';

export function generateRestaurantLD(
  merchant: MerchantConfig,
  siteUrl: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: merchant.name,
    description: merchant.description,
    url: siteUrl,
    telephone: merchant.contact.phone,
    image: merchant.heroImage,
    address: {
      '@type': 'PostalAddress',
      streetAddress: merchant.contact.address,
    },
    ...(merchant.logo ? { logo: merchant.logo } : {}),
  };
}

export function generateMenuItemLD(
  product: { name: string; price: string; description?: string; image?: string | null },
  currency: string,
  productUrl: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'MenuItem',
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(product.image ? { image: product.image } : {}),
    url: productUrl,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: currency,
    },
  };
}

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
