/**
 * Where the page gets its three calls. The bridge is `bowerloomReal`, put there by the real-mode preload and nowhere else; in any other mode it is missing and the
 * loader says so in plain words. It is read from the global object by name, so no screen holds a reference to Electron or to the normal bridge.
 */
import type { RealBridge } from '../../../shared/real/types.js';

/** The real-mode bridge, or null when this window has none. */
export function getBridge(): RealBridge | null {
  const found = (globalThis as { bowerloomReal?: RealBridge }).bowerloomReal;
  return found !== undefined && typeof found.discoverPlaces === 'function' && typeof found.pickFolder === 'function' && typeof found.readSelected === 'function' ? found : null;
}

/** The short code in an error from the bridge ('BUSY', 'NOT_ALLOWED', ...), or 'FAILED'. */
export function codeOf(error: unknown): string {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_PLACE|TOO_MANY|BUSY|NO_HOME|NO_BRIDGE)\b/);
  return found === null ? 'FAILED' : found[1]!;
}
