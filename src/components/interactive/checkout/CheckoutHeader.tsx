import { t } from '@/i18n';

interface Props {
  lang: 'nl' | 'en' | 'de';
  merchantName: string;
}

export function CheckoutHeader({ lang, merchantName }: Props) {
  return (
    <header class="flex items-center justify-between py-4 px-4 border-b border-border">
      <a
        href={`/${lang}/`}
        class="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width={2}>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {t('backToMenu', lang)}
      </a>
      <span class="font-heading font-bold text-lg">{merchantName}</span>
    </header>
  );
}
