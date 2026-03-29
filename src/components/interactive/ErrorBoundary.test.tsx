import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ErrorBoundary } from './ErrorBoundary';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Render explosion');
  return <div data-testid="child">OK</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
  });

  it('renders children when no error', () => {
    const { getByTestId } = render(
      <ErrorBoundary name="test">
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(getByTestId('child').textContent).toBe('OK');
  });

  it('renders fallback UI when child throws', () => {
    const { getByText } = render(
      <ErrorBoundary name="test">
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(getByText('Something went wrong')).toBeTruthy();
  });

  it('calls onError callback when child throws', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary name="test" onError={onError}>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'test');
  });

  it('recovers after retry button is clicked', async () => {
    let throwCount = 0;
    function ConditionalThrow() {
      throwCount++;
      if (throwCount <= 1) throw new Error('First render fails');
      return <div data-testid="recovered">Recovered</div>;
    }

    const { getByRole, getByTestId } = render(
      <ErrorBoundary name="test">
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    const retryBtn = getByRole('button', { name: /try again/i });
    expect(retryBtn).toBeTruthy();

    fireEvent.click(retryBtn);
    expect(getByTestId('recovered').textContent).toBe('Recovered');
  });
});
