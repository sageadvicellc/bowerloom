/**
 * The last line of defence: if any screen throws while it draws, the window shows a plain message instead of going blank.
 * It says nothing was saved (the prototype keeps everything in memory), offers a Reload, and shows the error text small.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';

export const CRASH_TITLE = 'Something went wrong. Nothing was saved.';

interface State { readonly error: Error | null }

export class ErrorBoundary extends Component<{ children?: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('The prototype stopped drawing.', error, info.componentStack);
  }

  override render(): ReactElement | ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="page" role="alert">
        <h1 tabIndex={-1}>{CRASH_TITLE}</h1>
        <p>The prototype stopped drawing this window. Reload to start again from the sample data.</p>
        <p><button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button></p>
        <p className="small muted">{error.message}</p>
      </div>
    );
  }
}
