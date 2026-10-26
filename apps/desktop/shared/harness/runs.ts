/**
 * Selectors and words for runs (S8 Start, S9 Runs and Compare). Pure functions of the state, so the list, the details and Compare always say the same thing.
 * A run has one status (running, done, closed). A rating is locked until the run is done. Runs that were started together for one instruction share a group.
 */
import { harnessById, interfaceById, projectById } from './status.js';
import type { Tone } from './status.js';
import { minutesOpen, startedWords } from './time.js';
import type { HarnessState, Rating, Run, RunStatus, Stamp } from './types.js';

/** The runs of one instruction that were started together, or one run on its own (`id` is null then). Compare shows a group of two or more. */
export interface RunGroup {
  readonly id: string | null;
  readonly runs: readonly Run[];
  readonly instruction: string;
  /** True when Compare has something to compare: two or more runs. */
  readonly comparable: boolean;
}

/** The runs in the order of the list, with the runs of one group kept together at the place of the first one. */
export function runGroups(state: HarnessState): RunGroup[] {
  const out: { id: string | null; runs: Run[]; instruction: string }[] = [];
  const byId = new Map<string, (typeof out)[number]>();
  for (const run of state.runs) {
    if (run.groupId === null) { out.push({ id: null, runs: [run], instruction: run.instruction }); continue; }
    const known = byId.get(run.groupId);
    if (known !== undefined) { known.runs.push(run); continue; }
    const made = { id: run.groupId, runs: [run], instruction: run.instruction };
    byId.set(run.groupId, made); out.push(made);
  }
  return out.map(g => ({ ...g, comparable: g.id !== null && g.runs.length > 1 }));
}

/** The runs of one group, in the order they were started. Empty for an unknown group. */
export const runsOfGroup = (state: HarnessState, groupId: string): Run[] => state.runs.filter(r => r.groupId === groupId);

export const runById = (state: HarnessState, runId: string): Run | undefined => state.runs.find(r => r.id === runId);

/** The group a run belongs to, when Compare has something to show for it. */
export function compareGroupOf(state: HarnessState, run: Run): string | null {
  return run.groupId !== null && runsOfGroup(state, run.groupId).length > 1 ? run.groupId : null;
}

const STATUS_WORDS: Readonly<Record<RunStatus, string>> = { running: 'Running', done: 'Done', closed: 'Closed' };
export const runStatusWords = (status: RunStatus): string => STATUS_WORDS[status];
/** A run that is running has the accent dot. A run that is done or closed is quiet. */
export const runTone = (status: RunStatus): Tone => (status === 'running' ? 'good' : 'quiet');

/** The rating is locked until the run is done. A closed run was done first, so it can be rated. */
export const canRate = (run: Run): boolean => run.status !== 'running';

export const RATINGS: readonly Rating[] = Object.freeze(['better', 'same', 'worse']);
const RATING_WORDS: Readonly<Record<Rating, string>> = { better: 'Better', same: 'Same', worse: 'Worse' };
export const ratingWords = (rating: Rating): string => RATING_WORDS[rating];

/** The name of a run in a list: "Weekly report crew in Claude Code". */
export function runName(state: HarnessState, run: Run): string {
  return `${harnessById(state, run.harnessId)?.name ?? 'Harness'} in ${interfaceById(state, run.interfaceId)?.name ?? run.interfaceId}`;
}

/** "Weekly report crew in bowerloom". */
export function runWhere(state: HarnessState, run: Run): string {
  return `${harnessById(state, run.harnessId)?.name ?? 'Harness'} in ${projectById(state, run.projectId)?.name ?? run.projectId}`;
}

/** "bowerloom · started 10:42", the second line of a row. */
export function runMeta(state: HarnessState, run: Run): string {
  return `${projectById(state, run.projectId)?.name ?? run.projectId} · ${startedWords(run.started)}`;
}

/** "Claude Code run", the title of the details. */
export const runTitle = (state: HarnessState, run: Run): string => `${interfaceById(state, run.interfaceId)?.name ?? run.interfaceId} run`;

/** "3 runs. Runs of one instruction are grouped for Compare." */
export const runsHint = (n: number): string => (n === 0 ? 'No runs yet.' : `${n} ${n === 1 ? 'run' : 'runs'}. Runs of one instruction are grouped for Compare.`);

/** "Started 10:42. Open for 12 minutes." The time open is read from `now`, so a page that keeps its own clock draws it fresh. A closed run says so. */
export function compareStartedLine(run: Run, now: Stamp): string {
  const started = startedWords(run.started);
  const first = `${started.charAt(0).toUpperCase()}${started.slice(1)}.`;
  if (run.status === 'closed') return `${first} The window is closed.`;
  const minutes = minutesOpen(run, now);
  if (minutes < 1) return `${first} Open for less than a minute.`;
  if (minutes < 60) return `${first} Open for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  if (minutes < 1440) { const hours = Math.floor(minutes / 60); return `${first} Open for ${hours} ${hours === 1 ? 'hour' : 'hours'}.`; }
  const days = Math.floor(minutes / 1440);
  return `${first} Open for ${days} ${days === 1 ? 'day' : 'days'}.`;
}

/** "Same instruction in both runs", "Same instruction in all 3 runs". */
export const sameInstructionWords = (n: number): string => (n === 2 ? 'Same instruction in both runs' : `Same instruction in all ${n} runs`);

/** The line above the rating of one run. */
export const rateQuestion = (run: Run): string => (canRate(run) ? 'How did it do?' : 'How did it do? You can rate it when the run is done.');
