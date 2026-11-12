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

/** The prefix of a local models channel: `bowerloom-local:<call>`. */
const LOCAL_PREFIX = 'bowerloom-local:';

const local = (name: string, arity: number, returns: ReturnKind): CallSpec => Object.freeze({ name, arity, optionalArgs: 0, channel: `${LOCAL_PREFIX}${name}`, returns });

/**
 * The calls of the third bridge, `bowerloomLocal`, added in 0.9. They are not engine calls and not reader calls: the 39 engine calls and the 3 reader calls above stay
 * frozen, and `callSpec` does not find these. `localModels` answers a `LocalModelsReport` (packages/local-models) as plain data. A server that is down is a state in the
 * report, never a refusal. The only refusals are the call's own: see `LOCAL_CALL_REFUSAL_CODES`.
 */
export const LOCAL_CALLS: readonly CallSpec[] = Object.freeze([
  local('localModels', 0, 'plain'),
]);

/** The spec of a local call, or undefined for a name the list does not hold. Own names only. */
export function localCallSpec(name: string): CallSpec | undefined {
  return LOCAL_CALLS.find(c => c.name === name);
}

/** The prefix of a runs channel: `bowerloom-runs:<call>`. */
const RUNS_PREFIX = 'bowerloom-runs:';

const run = (name: string, arity: number): CallSpec => Object.freeze({ name, arity, optionalArgs: 0, channel: `${RUNS_PREFIX}${name}`, returns: 'plain' as ReturnKind });

/**
 * The calls of the fourth bridge, `bowerloomRuns`, added in 0.9.0-beta.1: the manual record of runs and the figures read from an engine's own session log. They are not engine calls,
 * reader calls or local calls: those lists stay frozen, and `callSpec` and `localCallSpec` do not find these. Every call answers plain data and takes the arguments of its arity as
 * one value each. The only refusals are the call's own: see `RUN_CALL_REFUSAL_CODES`.
 */
export const RUN_CALLS: readonly CallSpec[] = Object.freeze([
  run('listRuns', 0), run('recordRun', 1), run('updateRun', 2), run('readRunFigures', 1), run('startNewRunList', 0),
]);

/** The spec of a runs call, or undefined for a name the list does not hold. Own names only. */
export function runCallSpec(name: string): CallSpec | undefined {
  return RUN_CALLS.find(c => c.name === name);
}

/** The prefix of a modules channel: `bowerloom-modules:<call>`. */
const MODULES_PREFIX = 'bowerloom-modules:';

const moduleCall = (name: string, arity: number): CallSpec => Object.freeze({ name, arity, optionalArgs: 0, channel: `${MODULES_PREFIX}${name}`, returns: 'plain' as ReturnKind });

/**
 * The calls of the fifth bridge, `bowerloomModules`, added in 0.9.0-beta.1: the read scope of a module. A module reads only what the person picks, plus home-folder places the person approved once for that module.
 * `listModulePlaces` lists the approved places of a module, `approveModulePlace` opens main's own folder chooser and records the pick, `revokeModulePlace` removes one place, and `readModuleFile` reads one text file
 * inside an approved place. The page never passes a path to approve: the pick is main's. They are not engine calls, reader calls, local calls or runs calls: those lists stay frozen, and `callSpec`, `localCallSpec` and
 * `runCallSpec` do not find these. Every call answers plain data. The only refusals are the call's own: see `MODULE_CALL_REFUSAL_CODES`.
 */
export const MODULE_CALLS: readonly CallSpec[] = Object.freeze([
  moduleCall('listModulePlaces', 1), moduleCall('approveModulePlace', 1), moduleCall('revokeModulePlace', 2), moduleCall('readModuleFile', 3),
]);

/**
 * The one call added to the bowerloomModules bridge by the Memory explorer (lane 4 of v0.9): `listModuleFiles` lists the markdown files of an approved place, by relative path, so a module can read them one by one
 * with `readModuleFile`. It is a separate list with its own golden file (`golden/module-list-calls.json`) and is not part of `MODULE_CALLS`, whose golden file stays as lane 2 wrote it. The bridge holds both lists.
 * It answers plain data and is refused with the codes of the modules calls.
 */
export const MODULE_LIST_CALLS: readonly CallSpec[] = Object.freeze([moduleCall('listModuleFiles', 2)]);

/** The spec of a modules call, or undefined for a name the list does not hold. Own names only. */
export function moduleCallSpec(name: string): CallSpec | undefined {
  return MODULE_CALLS.find(c => c.name === name);
}

/** The spec of a call on either side, or undefined for a name the contract does not hold. Own names only: `constructor` and `__proto__` are not calls. */
export function callSpec(name: string): CallSpec | undefined {
  return ENGINE_API_CALLS.find(c => c.name === name) ?? READER_API_CALLS.find(c => c.name === name);
}
