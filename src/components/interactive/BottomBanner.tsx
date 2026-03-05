import { useStore } from '@nanostores/preact';
import { useEffect } from 'preact/hooks';
import { $bottomBannerMessages } from '@/stores/comms';
import type { CommsTheme } from '@/stores/comms';
import { dismissMessage } from '@/lib/comms';
import { t } from '@/i18n';

const THEME_CLASSES: Record<CommsTheme, string> = {
  info: 'bg-muted text-muted-foreground',
  success: 'bg-primary/10 text-primary',
  warning: 'bg-warning/10 text-warning',
  urgent: 'bg-destructive/10 text-destructive',
  promotional: 'bg-accent text-accent-foreground',
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

export default function BottomBanner({ lang, onImpression, onClick, onDismiss }: Props) {
  const entries = useStore($bottomBannerMessages);
  const entry = entries[0];

  useEffect(() => {
    if (entry && onImpression) {
      onImpression(entry.message.id, entry.content.id);
    }
  }, [entry?.message.id, entry?.content.id]);

  if (!entry) return null;

  const { message, content } = entry;

  return (
    <div
      role="status"
      data-comms-banner="bottom"
      class={`fixed bottom-0 left-0 right-0 z-30 animate-in slide-in-from-bottom px-4 py-3 ${THEME_CLASSES[content.theme]}`}
      style={colorStyle(content.custom_colors)}
    >
      <div class="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div class="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          {content.headline && <span class="font-medium">{content.headline}</span>}
          {content.body && <span class="opacity-80">{content.body}</span>}
          {content.cta_label && content.cta_url && (
            <a
              href={content.cta_url}
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
