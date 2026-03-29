import { Component, type ComponentChildren, type FunctionComponent } from 'preact';

interface Props {
  children: ComponentChildren;
  name: string;
  onError?: (error: Error, name: string) => void;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onError?.(error, this.props.name);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div class="flex items-center justify-center p-4 text-sm text-muted-foreground">
          <div class="text-center">
            <p>Something went wrong</p>
            <button
              type="button"
              onClick={this.handleRetry}
              class="mt-2 text-xs underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * HOC that wraps a component with ErrorBoundary internally.
 *
 * Use this instead of wrapping islands with `<ErrorBoundary client:idle>`
 * in Astro templates. Astro only hydrates the outermost `client:` component
 * as an island — nested Preact components become static slot content and
 * never hydrate. This HOC keeps each component as its own island while
 * still providing crash resilience.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic HOC requires any to bridge Preact's IntrinsicAttributes constraint
export function withErrorBoundary<P extends Record<string, any>>(
  WrappedComponent: FunctionComponent<P>,
  name: string,
): FunctionComponent<P> {
  function Wrapped(props: P) {
    return (
      <ErrorBoundary name={name}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  }
  Wrapped.displayName = `withErrorBoundary(${name})`;
  return Wrapped;
}
// eslint-enable @typescript-eslint/no-explicit-any -- end withErrorBoundary HOC generic constraint
