import { Component, type ComponentChildren } from 'preact';

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
