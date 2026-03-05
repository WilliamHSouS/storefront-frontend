export interface CommsFixture {
  id: string;
  priority: number;
  dismissible: boolean;
  dismiss_duration: string | null;
  contents: Array<{
    id: string;
    surface: string;
    headline: string;
    body: string;
    cta_label: string;
    cta_url: string;
    theme: string;
    custom_colors: Record<string, string>;
    extra: Record<string, unknown>;
  }>;
}

export function topBannerMessage(overrides: Partial<CommsFixture> = {}): CommsFixture {
  return {
    id: 'comms-banner-1',
    priority: 0,
    dismissible: true,
    dismiss_duration: '1:00:00',
    contents: [
      {
        id: 'cnt-banner-1',
        surface: 'top_banner',
        headline: 'Free delivery this weekend!',
        body: 'Orders over €25 ship free.',
        cta_label: 'Shop now',
        cta_url: '/nl/collection/weekend-deals',
        theme: 'info',
        custom_colors: {},
        extra: {},
      },
    ],
    ...overrides,
  };
}

export function bottomBannerMessage(overrides: Partial<CommsFixture> = {}): CommsFixture {
  return {
    id: 'comms-bottom-1',
    priority: 0,
    dismissible: true,
    dismiss_duration: '0:30:00',
    contents: [
      {
        id: 'cnt-bottom-1',
        surface: 'bottom_banner',
        headline: 'New: order tracking!',
        body: '',
        cta_label: '',
        cta_url: '',
        theme: 'success',
        custom_colors: {},
        extra: {},
      },
    ],
    ...overrides,
  };
}

export function modalMessage(overrides: Partial<CommsFixture> = {}): CommsFixture {
  return {
    id: 'comms-modal-1',
    priority: 0,
    dismissible: true,
    dismiss_duration: null,
    contents: [
      {
        id: 'cnt-modal-1',
        surface: 'modal',
        headline: 'Welcome!',
        body: 'First order? Get 10% off.',
        cta_label: 'Claim offer',
        cta_url: '/nl/',
        theme: 'promotional',
        custom_colors: {},
        extra: {},
      },
    ],
    ...overrides,
  };
}

export function allSurfaceMessages(): CommsFixture[] {
  return [topBannerMessage(), bottomBannerMessage(), modalMessage()];
}
