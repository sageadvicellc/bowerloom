/**
 * Puts the harness-first preview into the page. Called once, when the page address starts with #sample (launch mode --sample) or #app (the default launch).
 * The sample launch has no bridge, no file, no network and no storage: everything is the in-memory sample (shared/harness/sample.ts), and it ignores a bridge if one were there.
 * The launch on the person's own folders has the bridge of three read-only calls, and the engine calls of the adopt and install sheets, which read only until a person approves a plan. The mode is the address's: a real address with no bridge (or a partial one) shows the no-bridge error, never the sample.
 */
import { createRoot } from 'react-dom/client';
// The style sheets of the shared kit load first, so the harness sheets that restyle a kit part (for example `.hxf-steps .kit-step`) come after them in the cascade and win a tie of
// specificity. The order of the sheets is the order of the first import, so it must not depend on which screen imports the kit part first.
import '../home/home-tokens.css';
import '../home/kit/kit.css';
import '../home/home.css';
import '../home/kit/menu.css';
import '../home/shell/shell.css';
import '../home/kit/stepper.css';
import { isHarnessHash, isRealHash } from '../../shared/harness/route.js';
import { ErrorBoundary } from '../common/error-boundary.js';
import { wireSkipLink } from '../home/route-latch.js';
import { getApiClient } from '../api/client.js';
import { HarnessApp } from './HarnessApp.js';
// The website's look on the app's parts. It loads after every screen's own sheet, so it wins a tie of specificity.
import './brand-layer.css';

export { isHarnessHash };

export function mountHarness(root: HTMLElement): void {
  wireSkipLink(document);
  const realMode = isRealHash(location.hash);
  const api = realMode ? getApiClient() : null;
  createRoot(root).render(<ErrorBoundary real={realMode}><HarnessApp realMode={realMode} real={api === null ? null : api.reader} engine={api === null ? undefined : api.engine} local={api === null ? undefined : api.local} runs={api === null ? undefined : api.runs} /></ErrorBoundary>);
}
