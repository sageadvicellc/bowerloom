/**
 * Undo for one change, alone. The Save bar lists the changes that wait, and each row can be taken back without touching the others.
 *
 * Method: the store remembers the edits that made the draft, in order (`draftActions`, shared/proto/store.ts). To undo one row this finds the edit (or the
 * two edits) that make the row, replays the others from the saved world, and keeps the result only when the list of rows is then exactly the old list
 * without that row. If taking the edit out also takes other rows with it (a skill that was added to the library and then to an agent: the second row
 * needs the first), the row cannot be undone alone and says so in plain words: the later change goes first. A row that no edit makes on its own (two
 * edits to the same notes) can only go with "Undo all changes". Nothing is guessed: every answer is checked by replaying.
 * Pure: no React, no DOM, no clock.
 */
import type { StoreState } from '../proto/store.js';
import { draftActions, replayActions } from '../proto/store.js';
import { barSentence, changeSentence } from './changes.js';
import type { Change } from './changes.js';
import { libraryChangeList, librarySentence } from './library-changes.js';

/** The words of the rows that cannot be undone alone. At most 12 words each. */
export const UNDO_WORDS = Object.freeze({
  later: 'Undo the later change first.',
  whole: 'Use Undo all changes for this one.',
  unknown: 'This change cannot be undone alone.',
});

/**
 * What the Save bar says about the changes that wait: the sentence for one or two ("Removed A and B"), "Added 7 items" for a run of things put in the library on no
 * agent by one press, else null (the bar then says "3 changes" and is a button that opens the list). A run of removals is not a sentence: three removals are "3 changes".
 */
export function barSaid(changes: readonly Change[], count: number): string | null {
  const shared = barSentence(changes, count);
  if (shared !== null || count <= 2 || changes.length !== count) return shared;
  return changes.every(c => c.verb === 'added' && c.to === undefined) ? `Added ${count} items` : null;
}

/**
 * One row of the list. One press can make several changes at once (adding seven things from the web is seven changes of the Save bar), and they can only go
 * together, so they are one row. `undo` is the edits to take out (their places in the list of edits), or null when the row cannot be undone alone.
 */
export interface ChangeEntry {
  readonly key: string;
  readonly text: string;
  /** How many changes of the Save bar this row stands for. */
  readonly changes: number;
  readonly undo: { readonly at: readonly number[] } | null;
  /** Why `undo` is null, in plain words. Null when the row can be undone. */
  readonly reason: string | null;
}

/** Past this many edits the search for two edits that make one row is skipped (it is a pair search). */
const PAIR_LIMIT = 14;

const keyOf = (c: Change): string => `${c.verb}|${c.what}|${c.to ?? ''}`;
const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every(x => b.has(x));
const sentenceOf = (group: readonly Change[]): string => {
  if (group.length === 1) return changeSentence(group[0]!);
  return librarySentence(group, group.length) ?? `${group.length} changes together`;
};

/** The rows of the Save bar for a state, each with what undoing it would do. The changes are the ones `libraryChangeList` gives; changes that only go together are one row. */
export function changeEntries(state: StoreState): ChangeEntry[] {
  const rows = libraryChangeList(state.committed, state.draft);
  const log = draftActions(state);
  const alone = (c: Change, reason: string): ChangeEntry => ({ key: keyOf(c), text: changeSentence(c), changes: 1, undo: null, reason });
  if (log === null) return rows.map(c => alone(c, UNDO_WORDS.unknown));
  const all = new Set(rows.map(keyOf));
  const rowsWithout = (skip: readonly number[]): Set<string> => {
    const skipped = new Set(skip);
    const world = replayActions(state.committed, log.filter((_, i) => !skipped.has(i)));
    return new Set(libraryChangeList(state.committed, world).map(keyOf));
  };
  // What taking out each edit (and each pair of edits, for a row that no single edit makes) removes from the list.
  const removing: { readonly at: readonly number[]; readonly gone: ReadonlySet<string> }[] = [];
  const take = (at: readonly number[]): void => {
    const now = rowsWithout(at);
    const gone = new Set([...all].filter(k => !now.has(k)));
    // An edit whose removal also adds rows is not a clean undo of anything.
    if (gone.size > 0 && [...now].every(k => all.has(k))) removing.push({ at, gone });
  };
  for (let i = 0; i < log.length; i += 1) take([i]);
  const owner = new Map<string, { readonly at: readonly number[]; readonly gone: ReadonlySet<string> }>();
  const claim = (): void => {
    for (const k of all) {
      if (owner.has(k)) continue;
      let best: (typeof removing)[number] | undefined;
      for (const r of removing) if (r.gone.has(k) && (best === undefined || r.gone.size < best.gone.size)) best = r;
      if (best !== undefined) owner.set(k, best);
    }
  };
  claim();
  if ([...all].some(k => !owner.has(k)) && log.length <= PAIR_LIMIT) {
    for (let i = 0; i < log.length; i += 1) for (let j = i + 1; j < log.length; j += 1) take([i, j]);
    claim();
  }
  // Rows that the same removal owns are one row. A removal that also takes rows another edit owns cannot be undone alone: that edit comes first.
  const entries: ChangeEntry[] = [];
  const done = new Set<string>();
  for (const c of rows) {
    const key = keyOf(c);
    if (done.has(key)) continue;
    const mine = owner.get(key);
    if (mine === undefined) { done.add(key); entries.push(alone(c, UNDO_WORDS.whole)); continue; }
    const group = rows.filter(r => owner.get(keyOf(r)) === mine);
    for (const r of group) done.add(keyOf(r));
    const foreign = [...mine.gone].some(k => owner.get(k) !== mine);
    entries.push({ key: group.map(keyOf).join('\n'), text: sentenceOf(group), changes: group.length, undo: foreign ? null : { at: mine.at }, reason: foreign ? UNDO_WORDS.later : null });
  }
  return entries;
}

/**
 * The place in the list of edits of one edit the screen made earlier (it kept the object), or -1 when that edit is no longer part of the draft. The note after
 * "Remove" uses it: it undoes that edit if it is still there.
 */
export function placeOf(state: StoreState, action: object): number {
  const log = draftActions(state);
  return log === null ? -1 : log.indexOf(action as never);
}

/**
 * True while one edit the screen made earlier is still part of the draft. It is also true when the store cannot say which edits made the draft (it keeps no list
 * then), so a note is never taken away only because the list is missing. The note after "Remove" asks this after every change, so it never describes a change that
 * Ctrl+Z, an Undo in the list or "Go back" has already taken away.
 */
export function stillInDraft(state: StoreState, action: object): boolean {
  const log = draftActions(state);
  return log === null ? true : log.indexOf(action as never) >= 0;
}
