import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { $toasts, showToast, dismissToast } from './toast';

// crypto.randomUUID is available in happy-dom
describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    $toasts.set([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('showToast adds a toast to the store', () => {
    showToast('Something went wrong');
    const toasts = $toasts.get();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Something went wrong');
    expect(toasts[0].type).toBe('error');
  });

  it('showToast supports success type', () => {
    showToast('Added!', 'success');
    expect($toasts.get()[0].type).toBe('success');
  });

  it('dismissToast removes a toast by ID', () => {
    showToast('first');
    showToast('second');
    const [first] = $toasts.get();
    dismissToast(first.id);
    const remaining = $toasts.get();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('second');
  });

  it('auto-dismisses after 4 seconds', () => {
    showToast('auto-dismiss me');
    expect($toasts.get()).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect($toasts.get()).toHaveLength(0);
  });

  it('caps visible toasts at 3', () => {
    showToast('one');
    showToast('two');
    showToast('three');
    showToast('four');
    const toasts = $toasts.get();
    expect(toasts).toHaveLength(3);
    expect(toasts[0].message).toBe('two');
    expect(toasts[2].message).toBe('four');
  });
});
