import { Component, type ReactNode } from 'react';
import { Button, Notice } from '@/ui';

/** Shows what went wrong instead of an empty page when a screen fails to render. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="max-w-2xl px-4 pt-8 sm:px-8">
        <Notice tone="red" action={<Button size="sm" onClick={() => window.location.reload()}>Reload</Button>}>
          <span className="font-medium">This page could not be shown.</span>
          <span className="mono text-meta">{this.state.error.message}</span>
        </Notice>
      </div>
    );
  }
}
