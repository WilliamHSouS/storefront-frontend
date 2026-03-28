import { useStore } from '@nanostores/preact';
import { useEffect } from 'preact/hooks';
import { $topBannerMessages } from '@/stores/comms';
import { BANNER_THEME_CLASSES, colorStyle } from '@/lib/comms-theme';
import { safeUrl } from '@/lib/safe-url';
import { dismissMessage } from '@/lib/comms';
import { t } from '@/i18n/client';

interface Props {
  lang: string;
  onImpression?: (messageId: string, contentId: string) => void;
  onClick?: (messageId: string, contentId: string) => void;
  onDismiss?: (messageId: string, contentId: string) => void;
}

export default function TopBanner({ lang, onImpression, onClick, onDismiss }: Props) {
  const entries = useStore($topBannerMessages);
  const entry = entries[0];

  // SSR banner is hidden via CSS :has() selector in global.css when this
  // component renders [data-comms-banner="top"]. Both changes land in the
  // same layout computation, eliminating CLS.

  useEffect(() => {
    if (entry && onImpression) {
      onImpression(entry.message.id, entry.content.id);
    }
  }, [entry?.message.id, entry?.content.id, onImpression]);

  if (!entry) return null;

  const { message, content } = entry;

  return (
    <div
      role="status"
      data-comms-banner="top"
      class={`sticky top-0 z-30 w-full animate-in slide-in-from-top px-4 py-3 ${BANNER_THEME_CLASSES[content.theme]}`}
      style={colorStyle(content.custom_colors)}
    >
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div class="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {content.headline && <span class="font-medium">{content.headline}</span>}
          {content.body && <span class="opacity-90">{content.body}</span>}
          {content.cta_label && content.cta_url && (
            <a
              href={safeUrl(content.cta_url)}
              class="underline underline-offset-2 font-medium"
              onClick={() => onClick?.(message.id, content.id)}
            >
              {content.cta_label}
            </a>
          )}
        </div>
        {message.dismissible && (
          <button
            type="button"
            class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-current opacity-60 hover:opacity-100"
            aria-label={t('dismissBanner', lang)}
            onClick={() => {
              onDismiss?.(message.id, content.id);
              dismissMessage(message.id, message.dismiss_duration);
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
