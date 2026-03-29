import { useStore } from '@nanostores/preact';
import { useEffect } from 'preact/hooks';
import { $bottomBannerMessages } from '@/stores/comms';
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

export default function BottomBanner({ lang, onImpression, onClick, onDismiss }: Props) {
  const entries = useStore($bottomBannerMessages);
  const entry = entries[0];

  useEffect(() => {
    if (entry && onImpression) {
      onImpression(entry.message.id, entry.content.id);
    }
  }, [entry?.message.id, entry?.content.id, onImpression]);

  if (!entry) return null;

  const { message, content } = entry;
  const hasContent = content.headline || content.body || (content.cta_label && content.cta_url);
  if (!hasContent) return null;

  return (
    <div
      role="status"
      data-comms-banner="bottom"
      class={`fixed bottom-0 left-0 right-0 z-30 animate-in slide-in-from-bottom px-4 py-3 ${BANNER_THEME_CLASSES[content.theme]}`}
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
