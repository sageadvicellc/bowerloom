/**
 * The five calls of the `bowerloomRuns` bridge, answered in the main process (shared/api/runs.ts names them). Registered for the default launch only.
 * Each call:
 *  - is answered only for the app's own page, in its main frame, before anything else happens;
 *  - takes exactly its number of arguments, and each argument is checked for its shape (shared/api/runs.ts) before main acts on it;
 *  - hands back plain data, or one short code (NOT_ALLOWED, BAD_ARGUMENT, UNKNOWN_FOLDER, UNKNOWN_RUN, FAILED). A failure is logged here by call name and error class, never by its message.
 * The page knows a folder only by the id main gave out (main/engine-service.ts) and never holds a full path: main works the full path out from the folder's label (main/run-folder.ts), keeps it in the saved
 * record and uses it to find the session log.
 * `recordRun` and `updateRun` write the file of runs in the state folder (main/run-store.ts) and nothing else; `readRunFigures` reads a session log (main/run-logs.ts) and writes nothing.
 * No call starts a program, reads a process, or reads or keeps a line of a chat.
 */
import { FIGURES_REASONS, FIGURES_STATES, NO_FIGURES, RUN_ARITY, RUN_CALLS, RUN_CHANNELS, RUN_INSTRUCTION_LIMIT, RUN_NOTES_LIMIT } from '../shared/api/runs.js';
import { isRunId, parseRecordInput, parseRunPatch } from '../shared/api/runs-shape.js';
import type { FiguresReason, FiguresState, RunCall, RunFigures, RunListReset, RunOutcome, RunView } from '../shared/api/runs.js';
import { readFigures } from './run-logs.js';
import type { FigureQuery } from './run-logs.js';
import { RunStoreError, createRunStore } from './run-store.js';
import type { RunStore, StoredRun } from './run-store.js';
import type { RealIpc } from './real-ipc.js';
import { isAllowedRealSender } from './security.js';

/** What main knows about a folder it gave out: its full path, its name, and the path written with `~`. */
export interface FolderRef { readonly dir: string; readonly name: string; readonly label: string }

/** Why a folder cannot be used for a record. */
export interface FolderProblemRef { readonly problem: 'UNKNOWN_FOLDER' | 'FOLDER_CHARACTER' | 'FOLDER_LINK' }

export interface RunsIpcDeps {
  readonly ipc: RealIpc;
  readonly appIndexUrl: string;
  readonly home: string;
  /** The state folder that holds `runs/runs.json`. */
  readonly stateRoot: string;
  /** The folder main gave out under that id, or null. Async: main asks the engine service for its list of folders. */
  readonly folder: (id: string) => Promise<FolderRef | FolderProblemRef | null>;
  readonly now?: () => number;
  /** Where a failure is logged. Main passes its stderr line writer. The default writes to stderr. */
  readonly tell?: (line: string) => void;
  /** Test use: another store, and another reader of figures. They default to the real ones. */
  readonly store?: RunStore;
  readonly figures?: (query: FigureQuery) => Promise<RunFigures>;
}

/** The class of a failure as a short word, for the log. Never the message, which can hold a path. A store error adds its reason and the errno code, which are words of ours and hold no path. */
const causeClass = (error: unknown): string => {
  if (!(error instanceof Error)) return 'NotAnError';
  const name = /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : 'Error';
  if (!(error instanceof RunStoreError)) return name;
  return `${name}, ${error.reason}${/^[A-Z0-9]{2,20}$/.test(error.code) ? `, ${error.code}` : ''}`;
};

/** The code the page gets for a store error that has one of its own. Any other store error is FAILED. */
const STORE_CODES: Readonly<Record<string, string>> = { damaged: 'STORE_DAMAGED', full: 'RUN_LIMIT', 'unknown-run': 'UNKNOWN_RUN', 'rating-needs-done': 'BAD_ARGUMENT', 'not-damaged': 'BAD_ARGUMENT' };
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** True when the value has the shape of the call except that a text is over its limit, so the page is told TOO_LONG and not only BAD_ARGUMENT. */
const overLimit = (v: unknown, key: 'instruction' | 'notes', limit: number): boolean => isPlain(v) && typeof v[key] === 'string' && (v[key] as string).length > limit;

/** A refusal with a code the page may see. Anything else thrown by an answer is FAILED. */
class Refusal extends Error {}

/** What the page sees of a saved run: never the full path. */
export const viewOf = (r: StoredRun): RunView => Object.freeze({
  id: r.id, engine: r.engine, instruction: r.instruction, projectName: r.projectName, projectLabel: r.projectLabel,
  startedAt: r.startedAt, status: r.status, groupId: r.groupId, rating: r.rating, notes: r.notes,
});

const OUTCOMES: readonly RunOutcome[] = ['finished', 'stopped', 'unknown'];
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1e12 && !Object.is(v, -0) ? v : null);
const iso = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : null);

/** Whatever a reader answered, cut to the figures: each field is copied by name and checked, so nothing else it held (a message, a path, a line of a chat) can reach the page. */
export function cleanFigures(raw: unknown): RunFigures {
  if (typeof raw !== 'object' || raw === null) return NO_FIGURES('unreadable');
  const r = raw as Record<string, unknown>;
  if (!FIGURES_STATES.includes(r.state as FiguresState)) return NO_FIGURES('unreadable');
  const reason = FIGURES_REASONS.includes(r.reason as FiguresReason) ? (r.reason as FiguresReason) : null;
  if (r.state !== 'found') return NO_FIGURES(r.state as FiguresState, reason);
  return Object.freeze({
    state: 'found' as const, reason, startedAt: iso(r.startedAt), endedAt: iso(r.endedAt), durationMs: count(r.durationMs), inputTokens: count(r.inputTokens), outputTokens: count(r.outputTokens),
    model: typeof r.model === 'string' && MODEL.test(r.model) ? r.model : null, outcome: OUTCOMES.includes(r.outcome as RunOutcome) ? (r.outcome as RunOutcome) : 'unknown',
  });
}

export function registerRunsIpc(deps: RunsIpcDeps): void {
  const now = deps.now ?? ((): number => Date.now());
  const tell = deps.tell ?? ((line: string): void => { try { process.stderr.write(`${line}\n`); } catch { /* a closed stderr never stops a call */ } });
  const store = deps.store ?? createRunStore({ stateRoot: deps.stateRoot });
  const figures = deps.figures ?? ((query: FigureQuery): Promise<RunFigures> => readFigures({ home: deps.home, tell }, query));
  const refuse = (code: string): never => { throw new Refusal(code); };

  const answers: Readonly<Record<RunCall, (...args: unknown[]) => Promise<unknown>>> = {
    listRuns: async () => store.list().map(viewOf),
    recordRun: async input => {
      const checked = parseRecordInput(input, now());
      if (checked === null) return refuse(overLimit(input, 'instruction', RUN_INSTRUCTION_LIMIT) ? 'TOO_LONG' : 'BAD_ARGUMENT');
      const folder = await deps.folder(checked.folderId);
      if (folder === null) return refuse('UNKNOWN_FOLDER');
      if ('problem' in folder) return refuse(folder.problem);
      return viewOf(store.add({ engine: checked.engine, instruction: checked.instruction, projectPath: folder.dir, projectName: folder.name, projectLabel: folder.label, startedAt: checked.startedAt ?? new Date(now()).toISOString() }));
    },
    updateRun: async (id, patch) => {
      const checked = parseRunPatch(patch);
      if (!isRunId(id) || checked === null) return refuse(isRunId(id) && overLimit(patch, 'notes', RUN_NOTES_LIMIT) ? 'TOO_LONG' : 'BAD_ARGUMENT');
      return viewOf(store.update(id, checked));
    },
    readRunFigures: async id => {
      if (!isRunId(id)) return refuse('BAD_ARGUMENT');
      const run = store.get(id);
      if (run === undefined) return refuse('UNKNOWN_RUN');
      // The other runs of this engine in this project, so one log is never given to two runs.
      const siblings = store.list().filter(r => r.id !== run.id && r.engine === run.engine && r.projectPath === run.projectPath).map(r => ({ startedAt: r.startedAt }));
      try { return cleanFigures(await figures({ engine: run.engine, projectDir: run.projectPath, startedAt: run.startedAt, siblings })); } catch (error) {
        // A log that could not be read is a state of the figures, not a refusal. The log line names the class of the cause and nothing else.
        try { tell(`Bowerloom: the runs call readRunFigures failed (${causeClass(error)}).`); } catch { /* the log never changes the answer */ }
        return NO_FIGURES('unreadable');
      }
    },
    startNewRunList: async (): Promise<RunListReset> => ({ asideName: store.startNewList() }),
  };

  for (const call of RUN_CALLS) {
    deps.ipc.handle(RUN_CHANNELS[call], async (event, ...args) => {
      const frame = event.senderFrame;
      if (frame === null || frame.parent !== null || !isAllowedRealSender(true, frame.url, deps.appIndexUrl)) throw new Error('NOT_ALLOWED');
      if (args.length !== RUN_ARITY[call]) throw new Error('BAD_ARGUMENT');
      try {
        return await answers[call](...args);
      } catch (error) {
        if (error instanceof Refusal) throw new Error(error.message);
        try { tell(`Bowerloom: the runs call ${call} failed (${causeClass(error)}).`); } catch { /* the log never changes the answer */ }
        throw new Error(error instanceof RunStoreError ? STORE_CODES[error.reason] ?? 'FAILED' : 'FAILED');
      }
    });
  }
}
