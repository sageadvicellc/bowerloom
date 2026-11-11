/**
 * The calls of the fourth bridge, `bowerloomRuns`: the manual record of runs and the figures read from an engine's own session log (beta.2). A run is something the person
 * records after they paste a Start command into their own Terminal; Bowerloom starts nothing and cannot see a process. The 39 engine calls with their golden file, the 3 reader calls
 * and the local calls stay as they are: nothing is added to them.
 *
 * What crosses the bridge is plain data. A run holds what the person wrote (the instruction, the notes) and what main knows about the folder (its name and its `~` label, never its full path).
 * Figures come from the session log of the engine, as numbers and short words only: no prompt text and no reply text is read into the answer, stored or logged.
 * Only types, constants and one plain function are here, and only type imports, no Electron and no Node module, so the preload, main and the page read one table. The checks of an argument are in
 * shared/api/runs-shape.ts, which the preload does not load.
 */
import type { EngineId } from '../engine/types.js';

export const RUN_CALLS = Object.freeze(['listRuns', 'recordRun', 'updateRun', 'readRunFigures'] as const);
export type RunCall = (typeof RUN_CALLS)[number];

/** How many arguments each call takes. A call with another count is refused BAD_ARGUMENT. */
export const RUN_ARITY: Readonly<Record<RunCall, number>> = Object.freeze({ listRuns: 0, recordRun: 1, updateRun: 2, readRunFigures: 1 });

/** One channel for each call, in the namespace of this bridge. */
export const RUN_CHANNELS: Readonly<Record<RunCall, string>> = Object.freeze({
  listRuns: 'bowerloom-runs:listRuns', recordRun: 'bowerloom-runs:recordRun', updateRun: 'bowerloom-runs:updateRun', readRunFigures: 'bowerloom-runs:readRunFigures',
});

/**
 * The short codes a runs call can be refused with. NOT_ALLOWED: the sender is not the app page. BAD_ARGUMENT: the count or the shape of the arguments is wrong.
 * UNKNOWN_FOLDER: main did not give out that folder id. UNKNOWN_RUN: no record has that id. FAILED: anything else (main logs the class of the cause, and the page never sees a message).
 */
export const RUN_REFUSAL_CODES = ['NOT_ALLOWED', 'BAD_ARGUMENT', 'UNKNOWN_FOLDER', 'UNKNOWN_RUN', 'FAILED'] as const;
export type RunRefusalCode = (typeof RUN_REFUSAL_CODES)[number];
export const RUN_REFUSALS: readonly string[] = Object.freeze([...RUN_REFUSAL_CODES]);

/** The person sets a run "done"; Bowerloom cannot see a process, so no run is ever "running". */
export type RecordedStatus = 'recorded' | 'done';
export type RunRating = 'better' | 'same' | 'worse';
export const RECORDED_STATUSES: readonly RecordedStatus[] = Object.freeze(['recorded', 'done']);
export const RUN_RATINGS: readonly RunRating[] = Object.freeze(['better', 'same', 'worse']);

/** The longest instruction and the longest note, in characters. The page and main both check them. */
export const RUN_INSTRUCTION_LIMIT = 4000;
export const RUN_NOTES_LIMIT = 2000;
/** The most runs main keeps. A record past it is refused, never a silent drop of an older one. */
export const RUN_RECORD_LIMIT = 500;

/** One recorded run, as the page sees it. */
export interface RunView {
  readonly id: string;
  readonly engine: EngineId;
  readonly instruction: string;
  /** The folder's name, and the folder written with `~` for the home folder. Never the full path. */
  readonly projectName: string;
  readonly projectLabel: string;
  /** An ISO time: when the person says the run started. */
  readonly startedAt: string;
  readonly status: RecordedStatus;
  /** Runs of one instruction in one project share a group, for Compare. */
  readonly groupId: string;
  readonly rating: RunRating | null;
  readonly notes: string;
}

export interface RecordRunInput {
  readonly folderId: string;
  readonly engine: EngineId;
  readonly instruction: string;
  /** An ISO time, or null for "now". */
  readonly startedAt: string | null;
}

export interface RunPatch { readonly status?: RecordedStatus; readonly rating?: RunRating | null; readonly notes?: string }

/**
 * How a read of the session log ended. `found`: a log was matched and read. `not-found`: no log, no engine home or no folder was there. `unreadable`: a log was there and could not be
 * read (permission, a shape Bowerloom does not know, too large). `not-available`: the engine has no reader of its log here. In the last three every figure is null: never a zero.
 */
export type FiguresState = 'found' | 'not-found' | 'unreadable' | 'not-available';
export type RunOutcome = 'finished' | 'stopped' | 'unknown';

/** The figures of one run. Each is null when the log did not hold it. Nothing here is text from the chat. */
export interface RunFigures {
  readonly state: FiguresState;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** A model name, cut to a short plain token, or null. */
  readonly model: string | null;
  readonly outcome: RunOutcome;
}

export const NO_FIGURES = (state: FiguresState): RunFigures => Object.freeze({ state, startedAt: null, endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' as const });

/** The object `bowerloomRuns` holds in the page. */
export interface RunsBridge {
  listRuns(): Promise<readonly RunView[]>;
  recordRun(input: RecordRunInput): Promise<RunView>;
  updateRun(id: string, patch: RunPatch): Promise<RunView>;
  readRunFigures(id: string): Promise<RunFigures>;
}
