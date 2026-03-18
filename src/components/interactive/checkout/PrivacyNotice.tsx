import { t } from '@/i18n';

interface PrivacyNoticeProps {
  lang: 'nl' | 'en' | 'de';
  privacyPolicyUrl?: string;
}

export function PrivacyNotice({ lang, privacyPolicyUrl }: PrivacyNoticeProps) {
  return (
    <p class="text-xs text-muted-foreground px-4 py-3">
      <svg
        class="inline-block w-3 h-3 mr-1 -mt-0.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width={2}
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
      {t('privacyNotice', lang)}{' '}
      {privacyPolicyUrl ? (
        <a
          href={privacyPolicyUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="underline hover:text-foreground"
        >
          {t('privacyPolicy', lang)}
        </a>
      ) : (
        <span>{t('privacyPolicy', lang)}</span>
      )}
    </p>
  );
}
