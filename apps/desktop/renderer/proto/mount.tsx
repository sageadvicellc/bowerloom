/** Puts the prototype into the page. Called once, when the page address ends in #prototype. */
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary } from './error-boundary.js';

export function mountPrototype(root: HTMLElement): void {
  createRoot(root).render(<ErrorBoundary><App /></ErrorBoundary>);
}
