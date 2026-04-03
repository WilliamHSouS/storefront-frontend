import { useStore } from '@nanostores/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { $cart, $cartLoading, ensureCart, cartCoordsQuery } from '@/stores/cart';
import { $selectedProduct, $isCartOpen } from '@/stores/ui';
import { getClient } from '@/lib/api';
import { showToast } from '@/stores/toast';
import { setCartItemQuantity, commitCartResponse } from '@/stores/cart-actions';
import { t } from '@/i18n/client';
import * as log from '@/lib/logger';
import QuantitySelector from './QuantitySelector';

interface Props {
  productId: string;
  productName: string;
  productSlug?: string;
  hasModifiers: boolean;
  soldOut: boolean;
  lang: string;
}

export default function AddToCartButton({
  productId,
  productName,
  productSlug,
  hasModifiers,
  soldOut,
  lang,
}: Props) {
  const cart = useStore($cart);
  const loading = useStore($cartLoading);
  const [collapsed, setCollapsed] = useState(true);
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>();

  const cartItems =
    cart?.line_items.filter((item) => String(item.product_id) === String(productId)) ?? [];
  const quantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  // For simple products, use the single line item for stepper updates
  const cartItem = cartItems[0];

  // Auto-collapse stepper after 3 seconds of inactivity
  useEffect(() => {
    if (quantity > 0 && !collapsed) {
      collapseTimer.current = setTimeout(() => setCollapsed(true), 3000);
      return () => clearTimeout(collapseTimer.current);
    }
  }, [quantity, collapsed]);

  const resetCollapseTimer = () => {
    clearTimeout(collapseTimer.current);
    setCollapsed(false);
    collapseTimer.current = setTimeout(() => setCollapsed(true), 3000);
  };

  const updateCartItem = async (itemId: string, newQuantity: number) => {
    const cartId = cart?.id;
    if (!cartId) return;
    try {
      await setCartItemQuantity(cartId, itemId, newQuantity);
    } catch (err) {
      log.error('AddToCart', 'Update error:', err);
      showToast(t('toastCartUpdateFailed', lang));
    }
  };

  const handleAdd = async () => {
    if (soldOut) return;

    if (hasModifiers) {
      $selectedProduct.set({ id: productId, name: productName, slug: productSlug });
      return;
    }

    $cartLoading.set(true);
    const prevCart = cart;
    try {
      const client = getClient();
      const cartId = await ensureCart(client);
      const { data, error } = await client.POST(`/api/v1/cart/{cart_id}/items/`, {
        params: { path: { cart_id: cartId }, query: cartCoordsQuery() },
        body: { product_id: productId, quantity: 1 },
      });

      if (error) {
        $cart.set(prevCart);
        if ('status' in error && error.status === 400) {
          // Product likely requires modifiers — open the detail modal and scroll to options
          $selectedProduct.set({
            id: productId,
            name: productName,
            slug: productSlug,
            scrollToOptions: true,
          });
        } else {
          log.error('AddToCart', 'Failed to add to cart:', error);
          showToast(t('toastAddToCartFailed', lang));
        }
      } else if (data) {
        commitCartResponse(data);
        // Fetch suggestions before opening modal to avoid flash-then-close
        try {
          const { data: suggestions } = await client.GET(`/api/v1/products/{id}/suggestions/`, {
            params: { path: { id: productId } },
          });
          const items = (suggestions as Array<unknown>) ?? [];
          if (items.length > 0) {
            $selectedProduct.set({
              id: productId,
              name: productName,
              slug: productSlug,
              skipToUpsell: true,
            });
          } else {
            $isCartOpen.set(true);
          }
        } catch {
          // Suggestions fetch failed — still a successful add, open cart
          $isCartOpen.set(true);
        }
      }
    } catch (err) {
      log.error('AddToCart', 'Error:', err);
      showToast(t('toastAddToCartFailed', lang));
      $cart.set(prevCart);
    } finally {
      $cartLoading.set(false);
    }
  };

  if (soldOut) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        class="inline-flex h-9 items-center justify-center rounded-md bg-muted px-3 text-xs font-medium text-muted-foreground"
      >
        {t('soldOut', lang)}
      </button>
    );
  }

  // Modifier products: always show add button (opens modal), with quantity badge
  if (hasModifiers) {
    return (
      <button
        type="button"
        onClick={handleAdd}
        disabled={loading}
        class="group relative inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        aria-label={t('addToCart', lang)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
        {quantity > 0 && (
          <span class="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground group-hover:animate-badge-bounce">
            {quantity}
          </span>
        )}
      </button>
    );
  }

  // Simple products: quantity stepper when in cart
  if (quantity > 0 && collapsed) {
    return (
      <button
        type="button"
        onClick={resetCollapseTimer}
        class="inline-flex h-9 min-w-9 items-center justify-center rounded-[10px] bg-accent text-sm font-semibold text-accent-foreground"
        aria-label={`${quantity} ${t('inCartTapToAdjust', lang)}`}
      >
        {quantity}
      </button>
    );
  }

  if (quantity > 0 && !collapsed) {
    const handleIncrement = () => {
      resetCollapseTimer();
      if (cartItem) updateCartItem(cartItem.id, cartItem.quantity + 1);
    };
    const handleDecrement = () => {
      resetCollapseTimer();
      if (cartItem) updateCartItem(cartItem.id, cartItem.quantity - 1);
    };
    const handleRemove = () => {
      if (cartItem) updateCartItem(cartItem.id, 0);
    };

    return (
      <QuantitySelector
        quantity={quantity}
        onIncrement={handleIncrement}
        onDecrement={handleDecrement}
        onRemove={handleRemove}
        lang={lang}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={loading}
      class="group/add inline-flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary text-primary-foreground transition-all hover:w-auto hover:gap-1.5 hover:px-4 hover:bg-primary/90 disabled:opacity-50"
      aria-label={t('addToCart', lang)}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="shrink-0"
      >
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </svg>
      <span class="hidden text-xs font-semibold whitespace-nowrap group-hover/add:inline">
        {t('addToCart', lang)}
      </span>
    </button>
  );
}
