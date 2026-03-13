import { useStore } from '@nanostores/preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { $cart, $cartLoading, ensureCart, cartCoordsQuery } from '@/stores/cart';
import { $selectedProduct } from '@/stores/ui';
import { getClient } from '@/lib/api';
import { showToast } from '@/stores/toast';
import { setCartItemQuantity, commitCartResponse } from '@/stores/cart-actions';
import { t } from '@/i18n';
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
      console.error('[AddToCart] update error:', err);
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
          // Product likely requires modifiers — open the detail modal
          $selectedProduct.set({ id: productId, name: productName, slug: productSlug });
        } else {
          console.error('Failed to add to cart:', error);
          showToast(t('toastAddToCartFailed', lang));
        }
      } else if (data) {
        commitCartResponse(data);
        // Open modal in upsell mode so suggestions are shown if available
        $selectedProduct.set({
          id: productId,
          name: productName,
          slug: productSlug,
          skipToUpsell: true,
        });
      }
    } catch (err) {
      console.error('[AddToCart] error:', err);
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
        class="group relative inline-flex h-9 items-center justify-center rounded-[10px] bg-accent px-3 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
      >
        {t('addToCart', lang)}
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
      class="group/btn inline-flex h-10 items-center justify-center rounded-[10px] border border-accent bg-accent px-4 text-xs font-semibold text-accent-foreground transition-all duration-300 hover:bg-accent/90 disabled:opacity-50 sm:h-9"
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
        class="mr-1"
      >
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </svg>
      {t('addToCart', lang)}
    </button>
  );
}
