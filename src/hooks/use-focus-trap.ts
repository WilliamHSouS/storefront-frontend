import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE_SELECTOR = 'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])';

// Ref-counted scroll lock — multiple nested dialogs can each request a lock
// without the inner one accidentally restoring scroll while the outer is open.
let scrollLockCount = 0;

/** Reset scroll lock count — exported for testing only. */
export function _resetScrollLockCount(): void {
  scrollLockCount = 0;
}

/** Get current scroll lock count — exported for testing only. */
export function _getScrollLockCount(): number {
  return scrollLockCount;
}

export function _lockScroll(): void {
  if (scrollLockCount++ === 0) {
    document.body.style.overflow = 'hidden';
  }
}

export function _unlockScroll(): void {
  if (--scrollLockCount <= 0) {
    scrollLockCount = 0;
    document.body.style.overflow = '';
  }
}

/**
 * Traps Tab focus within `ref` while `isActive` is true.
 * Calls `onEscape` when the Escape key is pressed.
 * Uses ref-counted scroll lock so nested traps don't conflict.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  isActive: boolean,
  onEscape: () => void,
): void {
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
        return;
      }

      if (e.key === 'Tab' && ref.current) {
        const focusable = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    _lockScroll();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      _unlockScroll();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, onEscape]);
}
