import { useEffect, useRef } from 'preact/hooks';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n/client';

interface Props {
  lang: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmRemoveDialog({ lang, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(dialogRef, true, onCancel);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm"
      onClick={onCancel}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={t('remove', lang)}
        class="mx-4 w-full max-w-xs rounded-lg bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <p class="text-sm font-medium text-card-foreground">{t('remove', lang)}?</p>
        <div class="mt-3 flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            {t('close', lang)}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            class="flex-1 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            {t('remove', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
