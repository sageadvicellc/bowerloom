/**
 * Where the window gets the calls of the adopt and install sheets on the person's own folders: `bowerloomEngine`, put there by the real-mode preload and nowhere
 * else. It is read from the window by name. In the sample launch it is never read: the sample answers the same calls in memory (shared/engine/sample.ts).
 */
import { ENGINE_CALLS } from '../../../shared/engine/types.js';
import type { EngineBridge } from '../../../shared/engine/types.js';

/** The engine bridge of this window, or null when it has none or a partial one. */
export function getEngineBridge(): EngineBridge | null {
  const found = typeof window === 'undefined' ? undefined : (window as unknown as { bowerloomEngine?: EngineBridge }).bowerloomEngine;
  if (found === undefined || found === null || found.mode !== 'real') return null;
  return ENGINE_CALLS.every(call => typeof found[call] === 'function') ? found : null;
}

/** The short code of an error from a call ('BAD_ARGUMENT', 'UNKNOWN_FOLDER', ...), or 'FAILED'. */
export function engineCodeOf(error: unknown): string {
  const found = String(error instanceof Error ? error.message : error).match(/\b(NOT_ALLOWED|BAD_ARGUMENT|UNKNOWN_FOLDER)\b/);
  return found === null ? 'FAILED' : found[1]!;
}
