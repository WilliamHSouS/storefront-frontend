import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { $toasts, showToast, dismissToast, _resetForTesting } from './toast';

// crypto.randomUUID is available in happy-dom
describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    $toasts.set([]);
    _resetForTesting();
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

  it('auto-dismisses error toasts after 8 seconds', () => {
    showToast('auto-dismiss me', 'error');
    expect($toasts.get()).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect($toasts.get()).toHaveLength(1); // Still visible at 4s
    vi.advanceTimersByTime(4000);
    expect($toasts.get()).toHaveLength(0); // Gone at 8s
  });

  it('auto-dismisses success toasts after 4 seconds', () => {
    showToast('done!', 'success');
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

  it('deduplicates identical messages within 2 seconds', () => {
    showToast('Connection failed');
    showToast('Connection failed');
    showToast('Connection failed');
    expect($toasts.get()).toHaveLength(1);
    expect($toasts.get()[0].message).toBe('Connection failed');
  });

  it('allows same message after dedup window expires', () => {
    showToast('Connection failed');
    expect($toasts.get()).toHaveLength(1);
    vi.advanceTimersByTime(2100);
    showToast('Connection failed');
    expect($toasts.get()).toHaveLength(2);
  });

  it('allows different messages within dedup window', () => {
    showToast('Error A');
    showToast('Error B');
    expect($toasts.get()).toHaveLength(2);
  });
});
