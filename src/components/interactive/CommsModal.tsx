import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $modalMessages } from '@/stores/comms';
import type { SurfaceEntry } from '@/stores/comms';
import { $isCartOpen, $selectedProduct } from '@/stores/ui';
import { MODAL_THEME_CLASSES, colorStyle } from '@/lib/comms-theme';
import { safeUrl } from '@/lib/safe-url';
import { dismissMessage } from '@/lib/comms';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n/client';

interface Props {
  lang: string;
  onImpression?: (messageId: string, contentId: string) => void;
  onClick?: (messageId: string, contentId: string) => void;
  onDismiss?: (messageId: string, contentId: string) => void;
}

const SESSION_KEY = 'sous:comms:modal_shown';

export default function CommsModal({ lang, onImpression, onClick, onDismiss }: Props) {
  const entries = useStore($modalMessages);
  const [isOpen, setIsOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState<SurfaceEntry | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    if (activeEntry) {
      onDismiss?.(activeEntry.message.id, activeEntry.content.id);
      dismissMessage(activeEntry.message.id, activeEntry.message.dismiss_duration);
    }
    setIsOpen(false);
  }, [activeEntry, onDismiss]);

  useFocusTrap(dialogRef, isOpen, close);

  // Try to show modal via requestIdleCallback when entries become available
  useEffect(() => {
    if (entries.length === 0) return;
    // Check overlay state via .get() to avoid subscribing
    if ($isCartOpen.get() || $selectedProduct.get() !== null) return;
    if (typeof window !== 'undefined' && sessionStorage.getItem(SESSION_KEY)) return;

    const cb = () => {
      // Re-check overlay state before opening
      if ($isCartOpen.get() || $selectedProduct.get() !== null) return;
      if (sessionStorage.getItem(SESSION_KEY)) return;

      const current = $modalMessages.get();
      if (current.length === 0) return;

      sessionStorage.setItem(SESSION_KEY, '1');
      setActiveEntry(current[0]);
      setIsOpen(true);
    };

    let handle: number | ReturnType<typeof setTimeout>;
    if (typeof requestIdleCallback === 'function') {
      handle = requestIdleCallback(cb, { timeout: 2000 } as IdleRequestOptions);
    } else {
      handle = setTimeout(cb, 2000);
    }

    return () => {
      if (typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(handle as number);
      } else {
        clearTimeout(handle);
      }
    };
  }, [entries.length]);

  // Fire impression when modal opens
  useEffect(() => {
    if (isOpen && activeEntry && onImpression) {
      onImpression(activeEntry.message.id, activeEntry.content.id);
    }
  }, [isOpen, activeEntry?.content.id, onImpression]);

  if (!isOpen || !activeEntry) return null;

  const { message, content } = activeEntry;

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center" data-comms-modal>
      <div
        class="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in"
        onClick={close}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        class={`relative mx-4 w-full max-w-md rounded-xl border-2 p-6 shadow-xl animate-in zoom-in-95 ${MODAL_THEME_CLASSES[content.theme]}`}
        style={colorStyle(content.custom_colors)}
      >
        {content.headline && <h2 class="mb-2 text-lg font-semibold">{content.headline}</h2>}
        {content.body && <p class="mb-4 opacity-80">{content.body}</p>}
        <div class="flex flex-col gap-2">
          {content.cta_label && content.cta_url && (
            <a
              href={safeUrl(content.cta_url)}
              class="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              onClick={() => onClick?.(message.id, content.id)}
            >
              {content.cta_label}
            </a>
          )}
          <button
            type="button"
            class="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm text-current opacity-70 hover:opacity-100"
            onClick={close}
          >
            {t('dismissBanner', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
