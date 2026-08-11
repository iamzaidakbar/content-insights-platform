import { Component, type ErrorInfo, type ReactNode } from 'react';

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
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p className="max-w-md text-sm text-[var(--text-secondary)]">
            {this.state.error.message || 'An unexpected error occurred while rendering this page.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-[var(--radius-button)] bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
