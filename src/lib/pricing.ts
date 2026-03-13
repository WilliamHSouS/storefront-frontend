import { formatPrice } from './currency';
import { t } from '@/i18n';

export type Discount =
  | { type: 'percentage'; value: number }
  | { type: 'fixed'; value: number }
  | { type: 'bogo'; buyQuantity: number; getQuantity: number }
  | { type: 'tiered'; quantity: number; price: number };

export interface PricedItem {
  price: string;
  discount: Discount | null;
}

export interface Modifier {
  price: string;
  quantity: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function getOriginalPrice(item: PricedItem): number {
  return Number(item.price);
}

export function getEffectivePrice(item: PricedItem): number {
  const base = getOriginalPrice(item);
  if (!item.discount) return base;

  switch (item.discount.type) {
    case 'percentage':
      return round2(base * (1 - item.discount.value / 100));
    case 'fixed':
      return round2(Math.max(0, base - item.discount.value));
    case 'bogo':
    case 'tiered':
      return base;
  }
}

export function hasUnitDiscount(item: PricedItem): boolean {
  if (!item.discount) return false;
  return item.discount.type === 'percentage' || item.discount.type === 'fixed';
}

export function getDiscountLabel(
  item: PricedItem,
  currency: string,
  locale: string,
  lang: string,
): string {
  if (!item.discount) return '';

  switch (item.discount.type) {
    case 'percentage':
      return `${item.discount.value}% ${t('discountOff', lang)}`;
    case 'fixed':
      return `${formatPrice(String(item.discount.value), currency, locale)} ${t('discountOff', lang)}`;
    case 'bogo':
      return `${t('discountBuy', lang)} ${item.discount.buyQuantity} ${t('discountGet', lang)} ${item.discount.getQuantity} ${t('discountFree', lang)}`;
    case 'tiered':
      return `${item.discount.quantity} ${t('discountFor', lang)} ${formatPrice(String(item.discount.price), currency, locale)}`;
  }
}

function getModifierTotal(modifiers?: Modifier[]): number {
  if (!modifiers || modifiers.length === 0) return 0;
  return modifiers.reduce((sum, mod) => sum + Number(mod.price) * mod.quantity, 0);
}

export function getLineTotal(item: PricedItem, qty: number, modifiers?: Modifier[]): number {
  const modTotal = getModifierTotal(modifiers);

  switch (item.discount?.type) {
    case 'bogo': {
      const buy = item.discount.buyQuantity;
      const get = item.discount.getQuantity;
      const paidItems = qty - Math.floor(qty / (buy + get)) * get;
      return round2((getOriginalPrice(item) + modTotal) * paidItems);
    }
    case 'tiered': {
      const threshold = item.discount.quantity;
      const tierPrice = item.discount.price;
      const bundles = Math.floor(qty / threshold);
      const remainder = qty % threshold;
      return round2(bundles * tierPrice + remainder * getOriginalPrice(item) + qty * modTotal);
    }
    default:
      return round2((getEffectivePrice(item) + modTotal) * qty);
  }
}

export function getLineSavings(item: PricedItem, qty: number, modifiers?: Modifier[]): number {
  const fullPrice = round2((getOriginalPrice(item) + getModifierTotal(modifiers)) * qty);
  const discountedPrice = getLineTotal(item, qty, modifiers);
  return round2(fullPrice - discountedPrice);
}
