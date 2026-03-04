import { useStore } from '@nanostores/preact';
import { $toasts, dismissToast } from '@/stores/toast';
import { t } from '@/i18n';

interface Props {
  lang: string;
}

export default function Toast({ lang }: Props) {
  const toasts = useStore($toasts);

  if (toasts.length === 0) return null;

  return (
    <div class="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col gap-2 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          class={`flex items-center gap-2 rounded-lg border bg-card px-4 py-3 shadow-lg animate-in ${
            toast.type === 'error'
              ? 'border-destructive/40 text-destructive'
              : 'border-primary/40 text-primary'
          }`}
        >
          <span class="text-sm font-medium">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            class="ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-current opacity-60 hover:opacity-100"
            aria-label={t('dismiss', lang)}
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
        </div>
      ))}
    </div>
  );
}
