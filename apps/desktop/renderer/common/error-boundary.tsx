/**
 * The last line of defence: if any screen throws while it draws, the window shows a plain message instead of going blank.
 * It offers a Reload and shows the error text small. It makes no claim about what was written: on the person's own folders a write may have finished before the window stopped.
 */
import { Component } from 'react';
import type { ErrorInfo, ReactElement, ReactNode } from 'react';

export const CRASH_TITLE = 'Something went wrong.';

/** What a reload does, in words that are true for the launch: the sample starts again from the sample data and wrote nothing; a launch on the person's own folders starts again, and the person looks at the folder to see what was written. */
export const crashLine = (real: boolean): string => (real
  ? 'Reload to start again. If you were saving or installing, open the folder again to see what was written.'
  : 'Reload to start again from the sample data. Nothing was written.');

interface State { readonly error: Error | null }

export class ErrorBoundary extends Component<{ children?: ReactNode; real?: boolean }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A screen stopped drawing.', error, info.componentStack);
  }

  override render(): ReactElement | ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="page" role="alert">
        <h1 tabIndex={-1}>{CRASH_TITLE}</h1>
        <p>{crashLine(this.props.real === true)}</p>
        <p><button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button></p>
        <p className="small muted">{error.message}</p>
      </div>
    );
  }
}
