/**
 * The calls of the engine API: the 39 calls the window makes on the engine, and the 3 calls of the reader of existing setups. Taken from the base release
 * (apps/desktop/shared/engine/types.ts: ENGINE_CALLS, ENGINE_ARITY, ENGINE_CHANNELS. apps/desktop/shared/real/types.ts: REAL_CALLS, REAL_CHANNELS, and the guarded handlers of
 * apps/desktop/main/real-ipc.ts). A test in apps/desktop compares these lists with the real ones, and packages/engine-api/golden holds the lists as the base source gave them.
 */
import type { CallSpec, ReturnKind } from './types.js';

/** The prefix of an engine channel: `bowerloom-engine:<call>`. */
const ENGINE_PREFIX = 'bowerloom-engine:';

const engine = (name: string, arity: number, returns: ReturnKind, optionalArgs = 0): CallSpec => Object.freeze({ name, arity, optionalArgs, channel: `${ENGINE_PREFIX}${name}`, returns });
const reader = (name: string, arity: number, channel: string): CallSpec => Object.freeze({ name, arity, optionalArgs: 0, channel, returns: 'plain' as const });

/** The engine calls, in the order of the base. */
export const ENGINE_API_CALLS: readonly CallSpec[] = Object.freeze([
  engine('folders', 0, 'list'),
  engine('chooseFolder', 0, 'answer-or-null', 1),
  engine('planAdoption', 2, 'answer'), engine('runAdoption', 4, 'answer'), engine('planAdoptionRecovery', 1, 'answer'), engine('runAdoptionRecovery', 2, 'answer'),
  engine('planProjection', 2, 'answer'), engine('runProjection', 3, 'answer'), engine('planRemoval', 1, 'answer'), engine('runRemoval', 2, 'answer'),
  engine('planRecovery', 2, 'answer'), engine('runRecovery', 3, 'answer'), engine('planMerge', 1, 'answer'), engine('runMerge', 2, 'answer'), engine('recordCheck', 2, 'boolean'),
  engine('planSave', 2, 'answer'), engine('runSave', 3, 'answer'), engine('listVersions', 1, 'answer'), engine('planRestore', 2, 'answer'), engine('runRestore', 3, 'answer'),
  engine('planSetAside', 1, 'answer'), engine('runSetAside', 2, 'answer'),
  engine('chooseNotesFolder', 1, 'answer-or-null'), engine('notesSummary', 1, 'answer'), engine('planCreateNotes', 1, 'answer'), engine('runCreateNotes', 2, 'answer'),
  engine('planNotesHistory', 1, 'answer'), engine('runNotesHistory', 2, 'answer'), engine('openNotesReport', 1, 'answer'),
  engine('planExport', 1, 'answer'), engine('runExport', 3, 'answer'), engine('chooseBundle', 0, 'answer-or-null'), engine('planImport', 3, 'answer'), engine('runImport', 5, 'answer'),
  engine('discardBundle', 1, 'boolean'), engine('savedScan', 0, 'saved-scan'), engine('checkSavedScan', 0, 'saved-scan-check'),
  engine('showStartCommand', 3, 'answer'), engine('startCommandToClipboard', 3, 'answer'),
]);

/** The reader's calls, in the order the page makes them. */
export const READER_API_CALLS: readonly CallSpec[] = Object.freeze([
  reader('discoverPlaces', 0, 'bowerloom-real:discover-places'),
  reader('pickFolder', 0, 'bowerloom-real:pick-folder'),
  reader('readSelected', 1, 'bowerloom-real:read-selected'),
]);

/** The spec of a call on either side, or undefined for a name the contract does not hold. Own names only: `constructor` and `__proto__` are not calls. */
export function callSpec(name: string): CallSpec | undefined {
  return ENGINE_API_CALLS.find(c => c.name === name) ?? READER_API_CALLS.find(c => c.name === name);
}
