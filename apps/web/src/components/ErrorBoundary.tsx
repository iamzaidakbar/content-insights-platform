import { Component, type ErrorInfo, type ReactNode } from 'react';

import { isProduction } from '../lib/env';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// React error boundaries must be class components — there's no hook equivalent for
// componentDidCatch/getDerivedStateFromError. Wraps the router so a render error
// anywhere in the app falls back to this screen instead of an unrecoverable blank page.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // No client-side error-reporting service is wired up in this codebase yet — this is
    // the one place it would plug in. console.error is the correct fallback until then,
    // since this only ever runs in the browser (never leaked to a server log).
    console.error('Unhandled render error caught by ErrorBoundary:', error, errorInfo);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-400">
            An unexpected error occurred. Reloading the page usually fixes this.
          </p>
          {!isProduction ? (
            <pre className="mt-4 max-h-40 overflow-auto rounded-md border border-slate-800 bg-slate-900/60 p-3 text-left text-xs text-red-400">
              {error.message}
            </pre>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
