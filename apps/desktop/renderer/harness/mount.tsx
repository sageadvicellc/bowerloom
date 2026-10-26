/**
 * Puts the harness-first preview into the page. Called once, when the page address starts with #prototype-v3 (launch mode --prototype-v3).
 * The preview has no bridge, no file, no network and no storage: everything is the in-memory sample (shared/harness/sample.ts).
 */
import { createRoot } from 'react-dom/client';
import { isHarnessHash } from '../../shared/harness/route.js';
import { ErrorBoundary } from '../proto/error-boundary.js';
import { wireSkipLink } from '../home/route-latch.js';
import { HarnessApp } from './HarnessApp.js';

export { isHarnessHash };

export function mountHarness(root: HTMLElement): void {
  wireSkipLink(document);
  createRoot(root).render(<ErrorBoundary><HarnessApp /></ErrorBoundary>);
}
