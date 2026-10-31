/**
 * The entry of the window. The page address picks the mode: `#app` and `#sample` are the harness-first app (on the person's own folders, and on made-up folders).
 * Main always loads one of them. A bare address is the app on the person's own folders, so a page that somehow loses its address never turns into the sample.
 */
import { REAL_BASE, isHarnessHash } from '../shared/harness/route.js';
import { mountHarness } from './harness/mount.js';
import { applyMotionTokens } from './motion-tokens.js';

const root = document.getElementById('root')!;

/** Follows the computer's light or dark setting: the app has no theme setting of its own. */
function applyTheme(): void {
  document.documentElement.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyMotionTokens();
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => applyMotionTokens());
applyTheme();
if (!isHarnessHash(location.hash)) location.hash = REAL_BASE;
mountHarness(root);
