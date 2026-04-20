import { Component, type ReactNode } from 'react';

import { logError } from '@/lib/observability';

type Props = { fallback: ReactNode; children: ReactNode };
type State = { hasError: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo): void {
    logError(err, { tag: 'error-boundary', componentStack: info.componentStack });
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
