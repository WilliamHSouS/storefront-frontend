import { describe, it, expect, beforeEach } from 'vitest';
import {
  $commsMessages,
  $dismissedMessages,
  $topBannerMessages,
  $bottomBannerMessages,
  $modalMessages,
  $toastMessages,
  $inlineCartMessages,
  $inlineCheckoutMessages,
} from './comms';
import type { CommsMessage } from './comms';

function makeMessage(overrides: Partial<CommsMessage> & { id: string }): CommsMessage {
  return {
    priority: 0,
    dismissible: true,
    dismiss_duration: null,
    contents: [],
    ...overrides,
  };
}

describe('comms store', () => {
  beforeEach(() => {
    $commsMessages.set([]);
    $dismissedMessages.set({});
  });

  it('filters messages by surface correctly', () => {
    $commsMessages.set([
      makeMessage({
        id: 'msg-1',
        contents: [
          {
            id: 'c1',
            surface: 'top_banner',
            headline: 'Top',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'info',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
      makeMessage({
        id: 'msg-2',
        contents: [
          {
            id: 'c2',
            surface: 'bottom_banner',
            headline: 'Bottom',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'success',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
    ]);

    const top = $topBannerMessages.get();
    expect(top).toHaveLength(1);
    expect(top[0].content.headline).toBe('Top');

    const bottom = $bottomBannerMessages.get();
    expect(bottom).toHaveLength(1);
    expect(bottom[0].content.headline).toBe('Bottom');

    expect($modalMessages.get()).toHaveLength(0);
    expect($toastMessages.get()).toHaveLength(0);
    expect($inlineCartMessages.get()).toHaveLength(0);
    expect($inlineCheckoutMessages.get()).toHaveLength(0);
  });

  it('filters out dismissed messages', () => {
    $commsMessages.set([
      makeMessage({
        id: 'msg-1',
        contents: [
          {
            id: 'c1',
            surface: 'top_banner',
            headline: 'Hello',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'info',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
    ]);

    // Dismiss with expiry far in the future
    $dismissedMessages.set({ 'msg-1': Date.now() + 60_000 });

    expect($topBannerMessages.get()).toHaveLength(0);
  });

  it('shows message if dismiss expiry has passed', () => {
    $commsMessages.set([
      makeMessage({
        id: 'msg-1',
        contents: [
          {
            id: 'c1',
            surface: 'top_banner',
            headline: 'Back again',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'warning',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
    ]);

    // Dismissed but expiry is in the past
    $dismissedMessages.set({ 'msg-1': Date.now() - 1000 });

    const top = $topBannerMessages.get();
    expect(top).toHaveLength(1);
    expect(top[0].content.headline).toBe('Back again');
  });

  it('returns highest priority first (lower number = higher priority)', () => {
    $commsMessages.set([
      makeMessage({
        id: 'msg-low',
        priority: 10,
        contents: [
          {
            id: 'c1',
            surface: 'top_banner',
            headline: 'Low priority',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'info',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
      makeMessage({
        id: 'msg-high',
        priority: 1,
        contents: [
          {
            id: 'c2',
            surface: 'top_banner',
            headline: 'High priority',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'urgent',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
      makeMessage({
        id: 'msg-mid',
        priority: 5,
        contents: [
          {
            id: 'c3',
            surface: 'top_banner',
            headline: 'Mid priority',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'info',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
    ]);

    const top = $topBannerMessages.get();
    expect(top).toHaveLength(3);
    expect(top[0].content.headline).toBe('High priority');
    expect(top[1].content.headline).toBe('Mid priority');
    expect(top[2].content.headline).toBe('Low priority');
  });

  it('handles multi-surface messages (same message with contents for different surfaces)', () => {
    $commsMessages.set([
      makeMessage({
        id: 'msg-multi',
        priority: 1,
        contents: [
          {
            id: 'c1',
            surface: 'top_banner',
            headline: 'Top version',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'promotional',
            custom_colors: {},
            extra: {},
          },
          {
            id: 'c2',
            surface: 'modal',
            headline: 'Modal version',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'promotional',
            custom_colors: {},
            extra: {},
          },
          {
            id: 'c3',
            surface: 'toast',
            headline: 'Toast version',
            body: '',
            cta_label: '',
            cta_url: '',
            theme: 'promotional',
            custom_colors: {},
            extra: {},
          },
        ],
      }),
    ]);

    const top = $topBannerMessages.get();
    expect(top).toHaveLength(1);
    expect(top[0].content.headline).toBe('Top version');
    expect(top[0].message.id).toBe('msg-multi');

    const modal = $modalMessages.get();
    expect(modal).toHaveLength(1);
    expect(modal[0].content.headline).toBe('Modal version');
    expect(modal[0].message.id).toBe('msg-multi');

    const toast = $toastMessages.get();
    expect(toast).toHaveLength(1);
    expect(toast[0].content.headline).toBe('Toast version');

    // Surfaces not included should be empty
    expect($bottomBannerMessages.get()).toHaveLength(0);
    expect($inlineCartMessages.get()).toHaveLength(0);
    expect($inlineCheckoutMessages.get()).toHaveLength(0);
  });
});
