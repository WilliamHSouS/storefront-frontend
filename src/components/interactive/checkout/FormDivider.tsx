import { t } from '@/i18n/client';

interface Props {
  lang: 'nl' | 'en' | 'de';
  visible: boolean;
}

export function FormDivider({ lang, visible }: Props) {
  if (!visible) return <div />;
  return (
    <div class="flex items-center gap-3 px-4 py-3">
      <div class="flex-1 h-px bg-border" />
      <span class="text-sm text-muted-foreground">{t('orFillInDetails', lang)}</span>
      <div class="flex-1 h-px bg-border" />
    </div>
  );
}
