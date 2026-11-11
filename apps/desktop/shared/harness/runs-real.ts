/**
 * Selectors and words for the runs of the person's own folders (beta.2). A run here is a manual record (shared/api/runs.ts): the person adds it, and Bowerloom cannot see a process, so a run
 * is "Recorded" or "Done" and never "Running". Pure functions of the list main answered, so Runs and Compare always say the same thing.
 * The figures of a run come from the engine's own session log. A figure the log did not hold is shown as "Not read", never as a zero.
 */
import { ENGINE_NAMES } from '../engine/types.js';
import type { FiguresState, RecordedStatus, RunFigures, RunOutcome, RunRating, RunView } from '../api/runs.js';

/** The runs of one instruction in one project, newest first. Compare shows a group of two or more. */
export interface RealGroup {
  readonly id: string;
  readonly runs: readonly RunView[];
  readonly instruction: string;
  readonly projectName: string;
  /** True when Compare has something to compare: two or more runs. */
  readonly comparable: boolean;
}

/** The runs in the order of the list, with the runs of one group kept together at the place of the first one. */
export function realGroups(runs: readonly RunView[]): RealGroup[] {
  const order: string[] = [], byId = new Map<string, RunView[]>();
  for (const run of runs) {
    const known = byId.get(run.groupId);
    if (known === undefined) { byId.set(run.groupId, [run]); order.push(run.groupId); } else known.push(run);
  }
  return order.map(id => { const rs = byId.get(id)!; return { id, runs: rs, instruction: rs[0]!.instruction, projectName: rs[0]!.projectName, comparable: rs.length > 1 }; });
}

export const realGroupById = (runs: readonly RunView[], id: string): RealGroup | undefined => realGroups(runs).find(g => g.id === id);
export const realRunById = (runs: readonly RunView[], id: string): RunView | undefined => runs.find(r => r.id === id);
/** The group a run belongs to, when Compare has something to show for it. */
export const realCompareGroupOf = (runs: readonly RunView[], run: RunView): string | null => (realGroups(runs).find(g => g.id === run.groupId)?.comparable === true ? run.groupId : null);

export const engineName = (run: Pick<RunView, 'engine'>): string => ENGINE_NAMES[run.engine];

const STATUS: Readonly<Record<RecordedStatus, string>> = { recorded: 'Recorded', done: 'Done' };
export const realStatusWords = (status: RecordedStatus): string => STATUS[status];
/** A rating needs a run that is done. */
export const canRateReal = (run: Pick<RunView, 'status'>): boolean => run.status === 'done';
export const realRateQuestion = (run: Pick<RunView, 'status'>): string => (canRateReal(run) ? 'How did it do?' : 'How did it do? Mark the run as done to rate it.');

const OUTCOME: Readonly<Record<RunOutcome, string>> = { finished: 'Finished', stopped: 'Stopped', unknown: 'Not read' };
export const outcomeWords = (outcome: RunOutcome): string => OUTCOME[outcome];

/** "45 seconds", "4 minutes", "1 hour 5 minutes". Null in, "Not read" out. */
export function durationWords(ms: number | null): string {
  if (ms === null) return 'Not read';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} ${m === 1 ? 'minute' : 'minutes'}`;
  const h = Math.floor(m / 60), rest = m % 60;
  return `${h} ${h === 1 ? 'hour' : 'hours'}${rest === 0 ? '' : ` ${rest} ${rest === 1 ? 'minute' : 'minutes'}`}`;
}

/** "12,345". Null in, "Not read" out. */
export const countWords = (n: number | null): string => (n === null ? 'Not read' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
/** A model name, or "Not read". */
export const modelWords = (model: string | null): string => model ?? 'Not read';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
/** "Nov 11, 10:30", in the computer's own time zone. An unreadable time is "Unknown time". */
export function startedAtWords(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Unknown time';
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The value of a `datetime-local` field ("2026-11-11T10:30", in the computer's time zone) as the ISO time main takes, or null. */
export function localInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (m === null) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
/** The value for a `datetime-local` field for a moment, in the computer's time zone. */
export function isoToLocalInput(ms: number): string {
  const d = new Date(ms), two = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The line that says why no figure is shown, or null when the log was read. */
export function figuresStateWords(state: FiguresState): string | null {
  switch (state) {
    case 'found': return null;
    case 'not-found': return 'No session log found. Details stay as you recorded them.';
    case 'unreadable': return 'Could not read the log.';
    case 'not-available': return 'Figures are not available for this engine.';
  }
}

export interface FigureRow { readonly key: 'duration' | 'input' | 'output' | 'model' | 'outcome'; readonly label: string; readonly value: string }
/** The rows of the figures: always the same five, each "Not read" when the log did not hold it or was not read. */
export function figureRows(figures: RunFigures | null): FigureRow[] {
  return [
    { key: 'duration', label: 'Time taken', value: durationWords(figures?.durationMs ?? null) },
    { key: 'input', label: 'Input', value: countWords(figures?.inputTokens ?? null) },
    { key: 'output', label: 'Output', value: countWords(figures?.outputTokens ?? null) },
    { key: 'model', label: 'Model', value: modelWords(figures?.model ?? null) },
    { key: 'outcome', label: 'Outcome', value: outcomeWords(figures?.outcome ?? 'unknown') },
  ];
}

export const REAL_RATINGS: readonly RunRating[] = Object.freeze(['better', 'same', 'worse']);
/** "Write a weekly report in team", the name of a run in a list. */
export const realRunName = (run: RunView): string => `${engineName(run)} in ${run.projectName}`;
