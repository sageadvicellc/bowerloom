/**
 * The state of the preview on the person's own folders before anything was read: nothing found, nothing made, and no claim about the programs (they read "Not read yet").
 * It is the start of real mode, so an address typed by hand never shows the sample's names as if they were the person's.
 */
import { NOT_CHECKED_NOTE } from '../../../shared/harness/real-map.js';
import { createSampleWorld } from '../../../shared/harness/sample.js';
import type { HarnessState, Stamp } from '../../../shared/harness/types.js';

export function blankRealState(now: Stamp): HarnessState {
  const sample = createSampleWorld(now);
  return {
    ...sample, parts: [], harnesses: [], projects: [], installs: [], runs: [], history: [], sources: [], chosenSourceIds: [], nextId: 100,
    interfaces: sample.interfaces.map(i => ({ ...i, foundAt: 'Not read yet', health: 'not-found' as const, healthWords: 'Not read yet', on: false, cannotUseNote: NOT_CHECKED_NOTE })),
    real: { couldNotRead: 0, stoppedEarly: false, notes: [], textsCut: 0 },
  };
}
