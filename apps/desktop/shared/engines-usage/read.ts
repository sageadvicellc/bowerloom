/**
 * How the Engines and usage module reads usage. It uses only the two read calls of the runs bridge that already exist: `listRuns` and `readRunFigures` (shared/api/runs.ts). It adds no call to any bridge,
 * and it never calls `recordRun`, `updateRun` or `startNewRunList`. It reads the logs of the newest runs, one at a time, so two reads never run together, and a failure of one run is that run's own state.
 * Pure but for the calls it is given: no clock, no file, no random number. `alive` says whether the screen is still there; a read stops when it is not.
 */
import { runsCode } from '../api/runs-shape.js';
import type { RunView, RunsBridge } from '../api/runs.js';
import { USAGE_RUN_CAP } from './model.js';
import type { FigureRead, UsageSource } from './model.js';

/** What a read answers: the source for the view, or `stopped` when the screen went away before the read ended. */
export type UsageRead = UsageSource | { readonly kind: 'stopped' };

/** The source before any read: the sample has no logs, a window with no runs bridge cannot read any, and otherwise a read is about to start. */
export function initialSource(sample: boolean, bridge: RunsBridge | null): UsageSource {
  return sample ? { kind: 'sample' } : bridge === null ? { kind: 'no-bridge' } : { kind: 'loading' };
}

/** Runs a call that may throw at once or reject, as one promise. */
const call = <T>(make: () => Promise<T>): Promise<T> => new Promise<T>(resolve => resolve(make()));

/** Newest first by the time the person recorded; the same time is put in order of the id, so the order never changes between reads. */
const newestFirst = (a: RunView, b: RunView): number => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function readUsage(bridge: RunsBridge, alive: () => boolean): Promise<UsageRead> {
  let runs: readonly RunView[];
  try { runs = await call(() => bridge.listRuns()); } catch (error) { return { kind: 'failed', code: runsCode(error) }; }
  const reads = new Map<string, FigureRead>();
  for (const run of [...runs].sort(newestFirst).slice(0, USAGE_RUN_CAP)) {
    if (!alive()) return { kind: 'stopped' };
    try { reads.set(run.id, { kind: 'figures', figures: await call(() => bridge.readRunFigures(run.id)) }); } catch (error) { reads.set(run.id, { kind: 'refused', code: runsCode(error) }); }
  }
  return alive() ? { kind: 'ready', runs, reads, total: runs.length } : { kind: 'stopped' };
}
