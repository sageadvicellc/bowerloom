/**
 * What the reader hands from the main process to the world builder: one place, with the records and notes found in it. Plain data, no file handle.
 * Also the plain words about a place that went partly unread. Pure.
 */
import type { RawRecord } from './adapters.js';
import type { RealApp, RealCounts, RealPlaceKind } from './types.js';

/** A record with the time its file was last changed, in milliseconds (a number the main process read; the shared code never reads a clock). */
export type StampedRecord = RawRecord & { readonly mtimeMs: number };

/** One markdown page of a place. In step one only `rel`, `folder` and the file name matter; in step two the title, summary and tags come from the head of the file. */
export interface NoteEntry {
  /** Relative to the place folder, with `/`. */
  readonly rel: string;
  /** The folder of the page below the place folder, with `/`, or '' at the top. */
  readonly folder: string;
  readonly title: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly type: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

/** The facts the world builder needs about a place. `path` is written with `~` for the home folder. */
export interface PlaceMeta { readonly id: string; readonly kind: RealPlaceKind; readonly label: string; readonly path: string; readonly apps: readonly RealApp[] }

export interface PlaceRead {
  readonly place: PlaceMeta;
  readonly records: readonly StampedRecord[];
  readonly notes: readonly NoteEntry[];
  /** Pages found beyond the number handed on. */
  readonly notesLeftOut: number;
  readonly partlyRead: number;
  /** The tool folders and files found, by name. */
  readonly folders: readonly string[];
  readonly tally: Readonly<{ tooBig: number; binary: number; unreadable: number; linksOutside: number; stoppedEarly: boolean; truncated: boolean; overBytes?: boolean }>;
}

export const emptyCounts = (): RealCounts => ({ agents: 0, skills: 0, tools: 0, hooks: 0, notes: 0 });

/** The counts of a place from its records and notes. A connection and a saved prompt are both tools; a hook is counted apart. */
export function countsOf(records: readonly RawRecord[], notes: number): RealCounts {
  let agents = 0, skills = 0, tools = 0, hooks = 0;
  for (const r of records) {
    if (r.kind === 'agent') agents += 1;
    else if (r.kind === 'skill') skills += 1;
    else if (r.kind === 'hook') hooks += 1;
    else tools += 1;
  }
  return { agents, skills, tools, hooks, notes };
}

/** The topics of a set of notes: the first folder of each, biggest first. A page at the top of the place is "Top level". At most `limit` topics. */
export function topicsOf(notes: readonly NoteEntry[], limit = 12): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of notes) { const top = n.folder === '' ? 'Top level' : n.folder.split('/')[0]!; counts.set(top, (counts.get(top) ?? 0) + 1); }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, limit);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** One plain sentence for each kind of thing that went unread in a place. Empty when all went well. */
export function tallyWords(t: PlaceRead['tally']): string[] {
  const out: string[] = [];
  if (t.linksOutside > 0) out.push(`${plural(t.linksOutside, 'shortcut that leads', 'shortcuts that lead')} outside this folder ${t.linksOutside === 1 ? 'was' : 'were'} not followed.`);
  if (t.tooBig > 0) out.push(`${plural(t.tooBig, 'file over 2 MB was', 'files over 2 MB were')} skipped.`);
  if (t.binary > 0) out.push(`${plural(t.binary, 'file that is', 'files that are')} not text ${t.binary === 1 ? 'was' : 'were'} skipped.`);
  if (t.unreadable > 0) out.push(`${plural(t.unreadable, 'thing', 'things')} could not be opened.`);
  if (t.truncated) out.push('This folder is big, so only part of it was looked at.');
  if (t.overBytes === true) out.push('It stopped early to stay within its size limit.');
  else if (t.stoppedEarly) out.push('It stopped early to stay within its time limit.');
  return out;
}
