"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Unhandled app error", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <main className="mx-auto min-h-screen max-w-2xl px-6 py-16">
          <div className="rounded-2xl border border-red-400/40 bg-red-50 p-6 text-red-900">
            <h1 className="font-display text-2xl">Something went wrong.</h1>
            <p className="mt-2 text-sm text-red-900/80">
              Please refresh the page. If the issue persists, reconnect your wallet and try again.
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="mt-4 rounded-full bg-red-900 px-5 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
