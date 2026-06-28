"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  tabKey: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class TabErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[TabErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.tabKey !== this.props.tabKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Something went wrong in this tab.
          </p>
          <button
            onClick={this.handleReset}
            className="rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            Reload tab
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
