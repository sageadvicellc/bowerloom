/**
 * The rows of the Version history drawer, in plain words. The store keeps a list of save points ordered by a logical counter (no clock), so "when" is relative
 * to the newest point: "just now", "1 save ago", "2 saves ago", and "when you began" for the first. What changed comes from `diffVersions` between a
 * point and the one it grew from. Pure: no React, no DOM, no clock.
 */
import type { Version, World } from '../proto/types.js';
import { diffVersions } from '../proto/versions-diff.js';
import type { DiffChange } from '../proto/versions-diff.js';
import type { NameOf } from './add-model.js';
import { BAR_NAMES, barSentence, changeSentence } from './changes.js';
import type { Change } from './changes.js';
import { countWords } from './textbudget.js';

/** The words these rows are built from. `renderer/home/words.ts` has the table that the text-budget test reads. */
export const POINT_WORDS = Object.freeze({
  justNow: 'just now', whenBegan: 'when you began', began: 'Your agents as Bowerloom found them.', nothing: 'Nothing changed.', wentBack: 'Went back to', restoredPrefix: 'Restored: ',
});

/** One row. `current` is the newest point: the world is there now. */
export interface SavePointRow {
  readonly id: string; readonly name: string; readonly when: string; readonly changes: string; readonly current: boolean;
  /** The time the point was made, in words read from the screen's clock when it was saved ("Today, 8:42 AM"); empty for a point that has none (the one a session starts with). */
  readonly madeAt?: string;
}

const VERB: Readonly<Record<DiffChange, string>> = { added: 'Added', removed: 'Removed', changed: 'Changed' };
const lower = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

/** "3 saves ago"; the newest reads "just now". */
export const whenOf = (behind: number): string => (behind <= 0 ? POINT_WORDS.justNow : `${behind} ${behind === 1 ? 'save' : 'saves'} ago`);
/** "3 things changed". */
export const manyChanged = (n: number): string => `${n} things changed`;

/** The name of a point: the label the person's save was given, and "Went back to <name>" for a point made by going back. */
export function pointName(label: string): string {
  return label.startsWith(POINT_WORDS.restoredPrefix) ? `${POINT_WORDS.wentBack} ${pointName(label.slice(POINT_WORDS.restoredPrefix.length))}` : label;
}

function changesOf(world: World, version: Version, nameOf: NameOf): string {
  const parent = version.parentId === null ? undefined : world.versions.find(v => v.id === version.parentId);
  if (parent === undefined) return POINT_WORDS.began;
  const diff = diffVersions(parent, version);
  if (diff.unreadable) return '';
  if (diff.entries.length === 0) return POINT_WORDS.nothing;
  if (diff.entries.length > 2) return manyChanged(diff.entries.length);
  const parts = diff.entries.map((e, i) => {
    const what = e.kind === 'override' ? e.name : nameOf(e.name);
    const verb = i > 0 && diff.entries[0]!.change === e.change ? '' : VERB[e.change];
    return i === 0 ? `${verb} ${what}` : verb === '' ? what : `${lower(verb)} ${what}`;
  });
  return parts.join(' and ');
}

/** The save points of the saved world, newest first. */
export function savePointRows(world: World, nameOf: NameOf): SavePointRow[] {
  const head = world.versions.reduce((most, v) => Math.max(most, v.counter), 0);
  return [...world.versions].sort((a, b) => b.counter - a.counter).map(v => ({
    id: v.id,
    name: pointName(v.label),
    when: v.counter === head ? POINT_WORDS.justNow : v.parentId === null ? POINT_WORDS.whenBegan : whenOf(head - v.counter),
    changes: changesOf(world, v, nameOf),
    current: v.counter === head,
    madeAt: v.madeAt ?? '',
  }));
}

/** The most words a description of changes may have (the hint limit of the text budget). */
const DESCRIPTION_LIMIT = 12;

/**
 * The changes that wait, as one line of at most 12 words that names what they are: "Removed Write a reply and List action items" for two, "Removed A, B and 2 more" for
 * a run of one kind, "Removed A, added B and 2 more" for a mix. A line that would run past 12 words names fewer things, and the last resort is null (the caller says how many).
 * It is the name a save point is given when more than two things changed, and the words under "Changes you have not saved will go away", so neither says only "3 changes".
 */
export function describeChanges(list: readonly Change[]): string | null {
  const [a, b] = list;
  if (a === undefined) return null;
  if (list.length <= BAR_NAMES) return barSentence(list, list.length);
  const head = (c: Change): string => changeSentence({ verb: c.verb, what: c.what });
  const rest = list.length - 2;
  const options = [
    `${head(a)}${b !== undefined && a.verb === b.verb ? `, ${b!.what}` : `, ${lower(head(b!))}`} and ${rest} more`,
    `${head(a)} and ${list.length - 1} more`,
  ];
  return options.find(text => countWords(text) <= DESCRIPTION_LIMIT) ?? null;
}
