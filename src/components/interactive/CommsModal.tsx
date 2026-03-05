import { useStore } from '@nanostores/preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { $modalMessages } from '@/stores/comms';
import type { CommsTheme, SurfaceEntry } from '@/stores/comms';
import { $isCartOpen, $selectedProduct } from '@/stores/ui';
import { dismissMessage } from '@/lib/comms';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n';

const MODAL_THEME_CLASSES: Record<CommsTheme, string> = {
  info: 'bg-card text-card-foreground border-muted',
  success: 'bg-card text-card-foreground border-primary/30',
  warning: 'bg-card text-card-foreground border-warning/30',
  urgent: 'bg-card text-card-foreground border-destructive/30',
  promotional: 'bg-card text-card-foreground border-accent/30',
};

function colorStyle(custom: Record<string, string>): Record<string, string> | undefined {
  if (!custom.bg && !custom.text) return undefined;
  const style: Record<string, string> = {};
  if (custom.bg && /^#[0-9a-fA-F]{3,8}$/.test(custom.bg)) style.backgroundColor = custom.bg;
  if (custom.text && /^#[0-9a-fA-F]{3,8}$/.test(custom.text)) style.color = custom.text;
  return Object.keys(style).length > 0 ? style : undefined;
}

interface Props {
  lang: string;
  onImpression?: (messageId: string, contentId: string) => void;
  onClick?: (messageId: string, contentId: string) => void;
  onDismiss?: (messageId: string, contentId: string) => void;
}

const SESSION_KEY = 'sous:comms:modal_shown';

export default function CommsModal({ lang, onImpression, onClick, onDismiss }: Props) {
  const entries = useStore($modalMessages);
  const cartOpen = useStore($isCartOpen);
  const selectedProduct = useStore($selectedProduct);
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
    if (cartOpen || selectedProduct !== null) return;
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
  }, [entries.length > 0, cartOpen, selectedProduct]);

  // Fire impression when modal opens
  useEffect(() => {
    if (isOpen && activeEntry && onImpression) {
      onImpression(activeEntry.message.id, activeEntry.content.id);
    }
  }, [isOpen, activeEntry?.content.id]);

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
              href={content.cta_url}
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
