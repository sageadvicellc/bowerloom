/**
 * What the buttons of Read do, apart from the screen: make a harness from each of some sources and give back the first one made, and run a make once however fast the button is pressed.
 * A make that gives nothing back is said, not skipped over.
 */

/** Makes a harness from each source, in order. Gives the id of the first one made, or null when none was. */
export function makeSources(store: { createHarnessFromSource(sourceId: string): string | null }, ids: readonly string[]): string | null {
  let first: string | null = null;
  for (const id of ids) { const made = store.createHarnessFromSource(id); if (first === null) first = made; }
  return first;
}

/** Runs `make` unless one is already running. A make that gave an id goes on (the screen is left, so the flag stays up); one that gave nothing puts the flag down and says so. */
export function makeOnce(flag: { current: boolean }, make: () => string | null, onMade: (id: string) => void, onNone: () => void): void {
  if (flag.current) return;
  flag.current = true;
  const id = make();
  if (id === null) { flag.current = false; onNone(); } else onMade(id);
}
