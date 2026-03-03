import { useStore } from '@nanostores/preact';
import { $itemCount } from '@/stores/cart';
import { $isCartOpen } from '@/stores/ui';
import { t } from '@/i18n';

interface Props {
  lang: string;
}

export default function CartBadge({ lang }: Props) {
  const count = useStore($itemCount);

  return (
    <button
      type="button"
      onClick={() => $isCartOpen.set(true)}
      class="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      aria-label={`${t('cart', lang)}${count > 0 ? ` (${count})` : ''}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
      {count > 0 && (
        <span class="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {count}
        </span>
      )}
    </button>
  );
}
