/**
 * The rows of the Version history drawer, in plain words. The store keeps a list of save points ordered by a logical counter (no clock), so "when" is relative
 * to the newest point: "just now", "1 save ago", "2 saves ago", and "when you began" for the first. What changed comes from `diffVersions` between a
 * point and the one it grew from. Pure: no React, no DOM, no clock.
 */
import type { Version, World } from '../proto/types.js';
import { diffVersions } from '../proto/versions-diff.js';
import type { DiffChange } from '../proto/versions-diff.js';
import type { NameOf } from './add-model.js';

/** The words these rows are built from. `renderer/home/words.ts` has the table that the text-budget test reads. */
export const POINT_WORDS = Object.freeze({
  justNow: 'just now', whenBegan: 'when you began', began: 'Your agents as Bowerloom found them.', nothing: 'Nothing changed.', wentBack: 'Went back to', restoredPrefix: 'Restored: ',
});

/** One row. `current` is the newest point: the world is there now. */
export interface SavePointRow { readonly id: string; readonly name: string; readonly when: string; readonly changes: string; readonly current: boolean }

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
  }));
}
