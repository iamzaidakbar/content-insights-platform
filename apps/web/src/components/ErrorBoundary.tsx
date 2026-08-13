import { Component, type ErrorInfo, type ReactNode } from 'react';

import Button from './ui/button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI error boundary caught', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-foreground">
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {this.state.error.message || 'An unexpected error occurred while rendering this page.'}
          </p>
          <Button className="mt-2" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
