import { useState } from 'preact/hooks';
import { t } from '@/i18n';
import {
  applyDiscountCode,
  removeDiscountCode,
  DISCOUNT_ERROR_MAP,
  DiscountError,
} from '@/stores/cart-actions';
import { showToast } from '@/stores/toast';
import type { Cart } from '@/stores/cart';

interface Props {
  cart: Cart;
  lang: string;
}

export default function DiscountCodeInput({ cart, lang }: Props) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  // Track the last successfully applied code locally — the backend may not
  // return an `applied_discount` object, but we still need to show the UI.
  const [lastAppliedCode, setLastAppliedCode] = useState<string | null>(null);

  const appliedDiscount = cart.applied_discount;
  const discountActive =
    appliedDiscount ||
    (lastAppliedCode && cart.discount_amount && parseFloat(cart.discount_amount) > 0);

  const handleApply = async () => {
    if (!code.trim()) return;
    setLoading(true);
    try {
      await applyDiscountCode(cart.id, code.trim());
      setLastAppliedCode(code.trim().toUpperCase());
      setCode('');
      showToast(t('discountApplied', lang), 'success');
    } catch (err) {
      const detail = err instanceof DiscountError ? err.apiDetail : '';
      const i18nKey = DISCOUNT_ERROR_MAP[detail] ?? 'discountInvalid';
      showToast(t(i18nKey, lang));
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    try {
      await removeDiscountCode(cart.id);
      setLastAppliedCode(null);
    } catch (err) {
      console.error('[cart] failed to remove discount:', err);
      showToast(t('toastCartUpdateFailed', lang));
    } finally {
      setLoading(false);
    }
  };

  if (discountActive) {
    const displayCode = appliedDiscount?.code ?? lastAppliedCode ?? '';
    const displayName = appliedDiscount?.name ?? t('discount', lang);

    return (
      <div class="mb-2 flex items-center justify-between rounded-md bg-accent/50 px-3 py-2">
        <div>
          <span class="text-xs font-medium text-card-foreground">{displayCode}</span>
          <span class="ml-2 text-xs text-muted-foreground">{displayName}</span>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          disabled={loading}
          class="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
        >
          {t('removeDiscount', lang)}
        </button>
      </div>
    );
  }

  return (
    <div class="mb-2 flex gap-2">
      <input
        type="text"
        value={code}
        onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
        placeholder={t('discountCodePlaceholder', lang)}
        aria-label={t('discountCode', lang)}
        maxLength={50}
        class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        disabled={loading}
      />
      <button
        type="button"
        onClick={handleApply}
        disabled={loading || !code.trim()}
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {t('applyDiscount', lang)}
      </button>
    </div>
  );
}
