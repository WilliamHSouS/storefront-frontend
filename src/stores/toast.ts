import { atom } from 'nanostores';

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success';
}

export const $toasts = atom<Toast[]>([]);

const MAX_VISIBLE = 3;

export function showToast(message: string, type: 'error' | 'success' = 'error') {
  const id = crypto.randomUUID();
  const next = [...$toasts.get(), { id, message, type }];
  $toasts.set(next.length > MAX_VISIBLE ? next.slice(-MAX_VISIBLE) : next);
  // Error toasts stay longer — island hydration in preview mode can take >4s
  setTimeout(() => dismissToast(id), type === 'error' ? 8000 : 4000);
}

export function dismissToast(id: string) {
  $toasts.set($toasts.get().filter((t) => t.id !== id));
}
