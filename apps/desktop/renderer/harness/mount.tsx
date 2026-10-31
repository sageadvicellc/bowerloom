/**
 * Puts the harness-first preview into the page. Called once, when the page address starts with #prototype-v3 (launch mode --prototype-v3) or #prototype-v3-real (--prototype-v3-real).
 * The sample launch has no bridge, no file, no network and no storage: everything is the in-memory sample (shared/harness/sample.ts), and it ignores a bridge if one were there.
 * The launch on the person's own folders has the bridge of three read-only calls, and the engine calls of the adopt and install sheets, which read only until a person approves a plan. The mode is the address's: a real address with no bridge (or a partial one) shows the no-bridge error, never the sample.
 */
import { createRoot } from 'react-dom/client';
import { isHarnessHash, isRealHash } from '../../shared/harness/route.js';
import { ErrorBoundary } from '../proto/error-boundary.js';
import { wireSkipLink } from '../home/route-latch.js';
import { getBridge } from '../home/real/bridge.js';
import { HarnessApp } from './HarnessApp.js';
import { getEngineBridge } from './real/engine-bridge.js';

export { isHarnessHash };

export function mountHarness(root: HTMLElement): void {
  wireSkipLink(document);
  const realMode = isRealHash(location.hash);
  createRoot(root).render(<ErrorBoundary real={realMode}><HarnessApp realMode={realMode} real={realMode ? getBridge() : null} engine={realMode ? getEngineBridge() : undefined} /></ErrorBoundary>);
}
