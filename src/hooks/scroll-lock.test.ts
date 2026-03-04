/**
 * Tests for the ref-counted scroll lock used by useFocusTrap.
 *
 * The scroll lock functions are exported (with underscore prefix) from
 * use-focus-trap.ts for testing. We test them directly here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  _lockScroll as lockScroll,
  _unlockScroll as unlockScroll,
  _resetScrollLockCount as resetScrollLockCount,
  _getScrollLockCount as getScrollLockCount,
} from './use-focus-trap';

describe('ref-counted scroll lock', () => {
  beforeEach(() => {
    resetScrollLockCount();
    document.body.style.overflow = '';
  });

  it('locks scroll on first call', () => {
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('does not double-lock on second call', () => {
    lockScroll();
    lockScroll();
    expect(document.body.style.overflow).toBe('hidden');
    expect(getScrollLockCount()).toBe(2);
  });

  it('does not unlock until all locks are released', () => {
    lockScroll();
    lockScroll();
    unlockScroll();
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('unlocks when all locks are released', () => {
    lockScroll();
    lockScroll();
    unlockScroll();
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });

  it('clamps count at zero on extra unlocks', () => {
    lockScroll();
    unlockScroll();
    unlockScroll(); // extra unlock — should not go negative
    unlockScroll(); // another extra
    expect(document.body.style.overflow).toBe('');
    expect(getScrollLockCount()).toBe(0);
  });

  it('works correctly after reset from over-unlock', () => {
    lockScroll();
    unlockScroll();
    unlockScroll(); // over-unlock
    lockScroll(); // new lock after over-unlock
    expect(document.body.style.overflow).toBe('hidden');
    unlockScroll();
    expect(document.body.style.overflow).toBe('');
  });
});
