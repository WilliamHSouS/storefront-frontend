import { useEffect, useRef } from 'preact/hooks';
import type { SurfaceEntry } from '@/stores/comms';
import { CALLOUT_THEME_CLASSES, colorStyle } from '@/lib/comms-theme';
import { safeUrl } from '@/lib/safe-url';
import { dismissMessage } from '@/lib/comms';
import { t } from '@/i18n/client';

interface Props {
  lang: string;
  entries: SurfaceEntry[];
  onImpression?: (messageId: string, contentId: string) => void;
  onClick?: (messageId: string, contentId: string) => void;
  onDismiss?: (messageId: string, contentId: string) => void;
}

export default function InlineCallout({ lang, entries, onImpression, onClick, onDismiss }: Props) {
  const impressedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onImpression) return;
    for (const entry of entries) {
      const key = `${entry.message.id}:${entry.content.id}`;
      if (!impressedRef.current.has(key)) {
        impressedRef.current.add(key);
        onImpression(entry.message.id, entry.content.id);
      }
    }
  }, [entries, onImpression]);

  if (entries.length === 0) return null;

  return (
    <div class="flex flex-col gap-3">
      {entries.map(({ message, content }) => (
        <div
          key={content.id}
          role="status"
          data-comms-callout={content.surface}
          class={`rounded-lg border p-4 ${CALLOUT_THEME_CLASSES[content.theme]}`}
          style={colorStyle(content.custom_colors)}
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
              {content.headline && <span class="font-medium">{content.headline}</span>}
              {content.body && <p class="mt-1 opacity-80">{content.body}</p>}
              {content.cta_label && content.cta_url && (
                <a
                  href={safeUrl(content.cta_url)}
                  class="mt-2 inline-block underline underline-offset-2 font-medium"
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
      ))}
    </div>
  );
}
