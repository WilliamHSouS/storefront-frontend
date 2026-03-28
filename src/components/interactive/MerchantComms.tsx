import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { $commsMessages, $dismissedMessages, $toastMessages } from '@/stores/comms';
import type { CommsMessage } from '@/stores/comms';
import { loadDismissedState, createCommsBatcher } from '@/lib/comms';
import { $merchant } from '@/stores/merchant';
import { showToast } from '@/stores/toast';
import { capture, EVENTS } from '@/analytics';
import TopBanner from './TopBanner';
import BottomBanner from './BottomBanner';
import CommsModal from './CommsModal';

interface Props {
  lang: string;
  messages: CommsMessage[];
}

function getSubjectKey(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    // Use sessionStorage to avoid persistent tracking without consent (GDPR)
    const key = 'sous:comms:subject';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

export default function MerchantComms({ lang, messages }: Props) {
  const impressionSet = useRef(new Set<string>());
  const batcherRef = useRef<ReturnType<typeof createCommsBatcher> | null>(null);

  // Hydrate comms stores before paint so TopBanner renders in the same
  // frame that CSS hides the SSR placeholder — zero CLS.
  useLayoutEffect(() => {
    $commsMessages.set(messages);
    $dismissedMessages.set(loadDismissedState());
  }, []);

  useEffect(() => {
    // Create analytics batcher
    const vendorId = $merchant.get()?.merchantId ?? '';
    const batcher = createCommsBatcher(import.meta.env.PUBLIC_API_BASE_URL || '', vendorId);
    batcherRef.current = batcher;

    // Feed toast-surface messages into the toast system
    const toastEntries = $toastMessages.get();
    for (const { content } of toastEntries) {
      const toastType =
        content.theme === 'urgent' || content.theme === 'warning' ? 'error' : 'success';
      showToast(content.headline || content.body, toastType);
    }

    return () => {
      batcher.destroy();
    };
  }, []);

  const subjectKey = useMemo(() => getSubjectKey(), []);

  const onImpression = (messageId: string, contentId: string) => {
    const key = `${messageId}:${contentId}`;
    if (impressionSet.current.has(key)) return;
    impressionSet.current.add(key);

    batcherRef.current?.track({
      message_id: messageId,
      content_id: contentId,
      event_type: 'impression',
      subject_key: subjectKey,
      metadata: {},
    });
    capture(EVENTS.COMMS_IMPRESSION, {
      message_id: messageId,
      content_id: contentId,
    });
  };

  const onClick = (messageId: string, contentId: string) => {
    batcherRef.current?.track({
      message_id: messageId,
      content_id: contentId,
      event_type: 'click',
      subject_key: subjectKey,
      metadata: {},
    });
    capture(EVENTS.COMMS_CLICK, {
      message_id: messageId,
      content_id: contentId,
    });
  };

  const onDismiss = (messageId: string, contentId: string) => {
    batcherRef.current?.track({
      message_id: messageId,
      content_id: contentId,
      event_type: 'dismiss',
      subject_key: subjectKey,
      metadata: {},
    });
    capture(EVENTS.COMMS_DISMISS, {
      message_id: messageId,
      content_id: contentId,
    });
  };

  return (
    <>
      <TopBanner lang={lang} onImpression={onImpression} onClick={onClick} onDismiss={onDismiss} />
      <BottomBanner
        lang={lang}
        onImpression={onImpression}
        onClick={onClick}
        onDismiss={onDismiss}
      />
      <CommsModal lang={lang} onImpression={onImpression} onClick={onClick} onDismiss={onDismiss} />
    </>
  );
}
