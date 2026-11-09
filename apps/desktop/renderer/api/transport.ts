/**
 * The transport of the page: the one file that reads `bowerloomReal` and `bowerloomEngine` from the window by name. The real-mode preload puts them there and nowhere else.
 * In the sample launch and in any other window they are missing. This file only hands back what it finds, unchecked. renderer/api/client.ts checks it.
 */

/** What the window holds under the two names, as found. */
export interface RawBridges {
  readonly reader: unknown;
  readonly engine: unknown;
}

/** The two bridges of this window, or undefined for each one that is missing. */
export function pageTransport(): RawBridges {
  const found = typeof window === 'undefined' ? undefined : (window as unknown as { bowerloomReal?: unknown; bowerloomEngine?: unknown });
  return { reader: found?.bowerloomReal, engine: found?.bowerloomEngine };
}
