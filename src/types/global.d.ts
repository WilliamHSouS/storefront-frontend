/** Global window augmentations used across islands. */

interface Window {
  __MERCHANT__?: import('./merchant').MerchantConfig;
  __LANG__?: string;
  __sous_address_hydrated__?: boolean;
  posthog?: {
    capture: (event: string, properties: Record<string, unknown>) => void;
    identify: (...args: unknown[]) => void;
  };
}
