/**
 * Keeps the places the person chose on the map. Moves that come close together are gathered, merged with what was saved, and
 * written once after a short wait. `flush` writes at once (when the screen goes away or the window is left). Nothing is lost
 * when two moves land inside the wait, because every pending place is kept until it is written.
 */
import type { Place } from './maplayout.js';

export interface KeeperOptions {
  /** The wait before writing, in milliseconds. */
  delay: number;
  /** The places saved so far, read each time a write is made. */
  saved(): Record<string, Place>;
  /** Writes the whole set of places. Null forgets them all. */
  commit(layout: Record<string, Place> | null): void;
  /** Timer functions, so a test can control time. */
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}
export interface Keeper { keep(places: Record<string, Place>): void; flush(): void; forget(): void; pending(): boolean }

export function createKeeper(options: KeeperOptions): Keeper {
  const set = options.setTimer ?? ((run: () => void, ms: number): unknown => setTimeout(run, ms));
  const clear = options.clearTimer ?? ((handle: unknown): void => { clearTimeout(handle as ReturnType<typeof setTimeout>); });
  // `session` holds every place kept since the last reset. The saved places come back from the settings a moment after a write,
  // so a second write that landed before then still includes the first.
  let session: Record<string, Place> = {}, handle: unknown = null, has = false;
  const write = (): void => {
    if (handle !== null) { clear(handle); handle = null; }
    if (!has) return;
    const next = { ...options.saved(), ...session }; has = false;
    options.commit(next);
  };
  return {
    keep(places) { session = { ...session, ...places }; has = true; if (handle !== null) clear(handle); handle = set(write, options.delay); },
    flush: write,
    forget() { if (handle !== null) { clear(handle); handle = null; } session = {}; has = false; options.commit(null); },
    pending: () => has,
  };
}
