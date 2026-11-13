/**
 * How the Engines and usage module reads usage. It uses only the two read calls of the runs bridge that already exist: `listRuns` and `readRunFigures` (shared/api/runs.ts). It adds no call to any bridge,
 * and it never calls `recordRun`, `updateRun` or `startNewRunList`. It reads the logs of the newest runs of the engines the app knows, one at a time, so two reads never run together, and a failure of one run is that run's own state.
 * What a call answers is checked before it is used: a list that is no list, a run with a bad shape, and figures with a bad shape are refused with the code FAILED, so a bad answer never reaches the view.
 * Nothing in `readUsage` rejects: every failure is a state. Pure but for the calls it is given: no clock, no file, no random number. `alive` says whether the screen is still there; a read stops when it is not.
 */
import { ENGINE_IDS } from '../engine/engines.js';
import { runsCode } from '../api/runs-shape.js';
import { FIGURES_REASONS, FIGURES_STATES } from '../api/runs.js';
import type { RunFigures, RunView, RunsBridge } from '../api/runs.js';
import { USAGE_RUN_CAP } from './model.js';
import type { FigureRead, UsageSource } from './model.js';

/** What a read answers: the source for the view, or `stopped` when the screen went away before the read ended. */
export type UsageRead = UsageSource | { readonly kind: 'stopped' };

/** The source before any read: the sample has no logs, a window with no runs bridge cannot read any, and otherwise a read is about to start. */
export function initialSource(sample: boolean, bridge: RunsBridge | null): UsageSource {
  return sample ? { kind: 'sample' } : bridge === null ? { kind: 'no-bridge' } : { kind: 'loading' };
}

/**
 * The source after a read ends. A read that was stopped changes nothing. A read that failed after a good one keeps the good figures and notes the code, so a failed "Read again" never wipes what was read.
 * Any other answer replaces the source, and a good read clears the note.
 */
export function nextSource(before: UsageSource, read: UsageRead): UsageSource {
  if (read.kind === 'stopped') return before;
  if (read.kind === 'failed' && before.kind === 'ready') return { ...before, lastReadFailed: read.code };
  return read;
}

/** Runs a call that may throw at once or reject, as one promise. */
const call = <T>(make: () => Promise<T>): Promise<T> => new Promise<T>(resolve => resolve(make()));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOrNull = (value: unknown): boolean => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
const textOrNull = (value: unknown): boolean => value === null || typeof value === 'string';
const OUTCOMES: readonly unknown[] = ['finished', 'stopped', 'unknown'];

/** True when the value has the shape of `RunFigures`: a known state and reason, numbers that are whole counts or null, and text or null. */
export function validFigures(value: unknown): value is RunFigures {
  if (!isObject(value)) return false;
  return (FIGURES_STATES as readonly unknown[]).includes(value.state) && (value.reason === null || (FIGURES_REASONS as readonly unknown[]).includes(value.reason))
    && numberOrNull(value.durationMs) && numberOrNull(value.inputTokens) && numberOrNull(value.outputTokens) && textOrNull(value.model) && textOrNull(value.startedAt) && textOrNull(value.endedAt) && OUTCOMES.includes(value.outcome);
}

/** True when the value can be a run of the list: an object with a text id, a text engine and a text start. */
const validRun = (value: unknown): value is RunView => isObject(value) && typeof value.id === 'string' && typeof value.engine === 'string' && typeof value.startedAt === 'string';

const isEngine = (id: string): boolean => (ENGINE_IDS as readonly string[]).includes(id);
/** Newest first by the time the person recorded; the same time is put in order of the id, so the order never changes between reads. */
const newestFirst = (a: RunView, b: RunView): number => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function readUsage(bridge: RunsBridge, alive: () => boolean): Promise<UsageRead> {
  try {
    let runs: readonly RunView[];
    try {
      const answer: unknown = await call(() => bridge.listRuns());
      if (!Array.isArray(answer) || !answer.every(validRun)) return { kind: 'failed', code: 'FAILED' };
      runs = answer;
    } catch (error) { return { kind: 'failed', code: runsCode(error) }; }
    const reads = new Map<string, FigureRead>();
    // A run of a name that is no engine of the app is left out before the cap, so it takes no place from a real run. The view counts it from the whole list.
    for (const run of runs.filter(r => isEngine(r.engine)).sort(newestFirst).slice(0, USAGE_RUN_CAP)) {
      if (!alive()) return { kind: 'stopped' };
      try {
        const figures: unknown = await call(() => bridge.readRunFigures(run.id));
        reads.set(run.id, validFigures(figures) ? { kind: 'figures', figures } : { kind: 'refused', code: 'FAILED' });
      } catch (error) { reads.set(run.id, { kind: 'refused', code: runsCode(error) }); }
    }
    return alive() ? { kind: 'ready', runs, reads, total: runs.length } : { kind: 'stopped' };
  } catch { return { kind: 'failed', code: 'FAILED' }; }
}
