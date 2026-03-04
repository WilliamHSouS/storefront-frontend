import { useState } from 'preact/hooks';
import AnimatedNumber from './AnimatedNumber';
import ConfirmRemoveDialog from './ConfirmRemoveDialog';
import { t } from '@/i18n';

interface Props {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  lang: string;
  min?: number;
}

export default function QuantitySelector({
  quantity,
  onIncrement,
  onDecrement,
  onRemove,
  lang,
  min = 0,
}: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDecrement = () => {
    if (quantity <= 1 && min === 0) {
      setShowConfirm(true);
    } else {
      onDecrement();
    }
  };

  return (
    <>
      <div class="inline-flex items-center rounded-md border border-border bg-background">
        <button
          type="button"
          onClick={handleDecrement}
          disabled={quantity <= min && min > 0}
          class="relative inline-flex h-9 w-9 items-center justify-center rounded-l-md text-foreground transition-colors hover:bg-accent disabled:opacity-50 before:absolute before:inset-[-4px]"
          aria-label={quantity <= 1 ? t('removeItem', lang) : t('decreaseQuantity', lang)}
        >
          {quantity <= 1 && min === 0 ? (
            // Trash icon
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14" />
            </svg>
          )}
        </button>

        <span class="inline-flex min-w-[2rem] items-center justify-center text-sm font-medium text-foreground">
          <AnimatedNumber value={quantity} />
        </span>

        <button
          type="button"
          onClick={onIncrement}
          class="relative inline-flex h-9 w-9 items-center justify-center rounded-r-md text-foreground transition-colors hover:bg-accent before:absolute before:inset-[-4px]"
          aria-label={t('increaseQuantity', lang)}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
        </button>
      </div>

      {showConfirm && (
        <ConfirmRemoveDialog
          lang={lang}
          onConfirm={() => {
            setShowConfirm(false);
            onRemove();
          }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
