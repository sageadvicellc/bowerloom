/**
 * What the shell calls to put the loader into the page: `mountReal(root, onWorld)`. `onWorld` gets the world the home screens read and the whole result.
 * `mountRealHarness(root)` puts the bare test page there instead. `isRealHash` says whether an address is one of the real-mode pages.
 */
import { createRoot } from 'react-dom/client';
import type { World } from '../../../shared/world/types.js';
import { REAL_HARNESS_HASH, REAL_HASH } from '../../../shared/real/types.js';
import type { RealResult } from '../../../shared/real/types.js';
import { ErrorBoundary } from '../../common/error-boundary.js';
import { RealHarness } from './RealHarness.js';
import { RealLoader } from './RealLoader.js';

/** True for `#prototype-v2/real` and `#prototype-v2/real-harness`. */
export const isRealHash = (hash: string): boolean => hash === REAL_HASH || hash === REAL_HARNESS_HASH;

export function mountReal(root: HTMLElement, onWorld: (world: World, result: RealResult) => void): void {
  createRoot(root).render(<ErrorBoundary><RealLoader onWorld={onWorld} /></ErrorBoundary>);
}

export function mountRealHarness(root: HTMLElement): void {
  createRoot(root).render(<ErrorBoundary><RealHarness /></ErrorBoundary>);
}
