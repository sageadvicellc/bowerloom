/**
 * The words for a set of notes that a person chose in "Choose notes": a name that says what it holds and a hint that says how much, instead of the name the
 * store gave it ("Report builder notes", which only says who reads it). The topics it covers are the top folders of its rule, named by the plain layer of
 * the topics (notes-topics.ts): "Meetings and Travel notes", and up to three topics are listed ("Meetings, Travel and Clients notes"). More than that, or names too long for five words: the biggest and a count, "Meetings and 2 more notes". A name has at most
 * five words and a hint at most twelve. The set keeps its stored name; only the words on a card and on the Save bar change, and both come from here.
 * Pure: no React, no DOM, no clock.
 */
import type { Slice, WikiPage } from '../proto/types.js';
import { memoMatch } from '../proto/slice-preview.js';
import { otherOf, selectionFromSlice } from './notes-model.js';
import type { Basis } from './notes-model.js';
import { buildTopics } from './notes-topics.js';
import type { Topic } from './notes-topics.js';
import { countWords } from './textbudget.js';

/** What a card says about a set of notes. */
export interface NotesLabel { readonly name: string; readonly hint: string }

export const NOTES_LABEL_WORDS = Object.freeze({ byHand: 'Notes you picked', hintTail: 'it can read.', none: 'No notes yet.' });
const MAX_WORDS = 5;

const fits = (text: string): boolean => countWords(text) <= MAX_WORDS;

// The topics of a page list are worked out once for each list: the shelf asks for every agent on every change.
const topicsOf = new WeakMap<readonly WikiPage[], readonly Topic[]>();
function basisOf(pages: readonly WikiPage[], slice: Slice): Basis {
  let topics = topicsOf.get(pages);
  if (topics === undefined) { topics = buildTopics(pages); topicsOf.set(pages, topics); }
  return { pages, topics, titles: new Map(), other: otherOf(slice) };
}

/**
 * The name for a list of topic names, biggest first: up to three are listed ("Meetings, Travel and Clients notes"). When five words do not hold them, the first two and a
 * count ("Meetings, Travel and 2 more notes"), else the first and a count ("Meetings and 3 more notes").
 */
function nameOf(topics: readonly string[]): string {
  const [first = '', second = '', third = ''] = topics;
  const options = topics.length === 1 ? [`${first} notes`]
    : topics.length === 2 ? [`${first} and ${second} notes`, `${first} and 1 more notes`]
      : topics.length === 3 ? [`${first}, ${second} and ${third} notes`, `${first} and 2 more notes`]
        : [`${first}, ${second} and ${topics.length - 2} more notes`, `${first} and ${topics.length - 1} more notes`];
  // A topic with a long name can still push past five words; the last resort is the first topic alone, cut to five words.
  return options.find(fits) ?? `${first.split(/\s+/).slice(0, MAX_WORDS - 1).join(' ')} notes`;
}

const countText = (n: number): string => (n === 0 ? NOTES_LABEL_WORDS.none : `${n} ${n === 1 ? 'note' : 'notes'} ${NOTES_LABEL_WORDS.hintTail}`);

/**
 * The name and hint of a chosen set of notes, or null when it names no topic and no single note (a set chosen only by page types, tags or links), so the
 * caller keeps the name it has. `pages` are the pages of the world the set belongs to.
 */
export function notesLabel(slice: Slice, pages: readonly WikiPage[]): NotesLabel | null {
  const basis = basisOf(pages, slice);
  const topics = selectionFromSlice(slice, basis).on.flatMap(id => basis.topics.find(t => t.id === id)?.name ?? []);
  const count = memoMatch(pages, slice.rule, slice.seeds).size;
  if (topics.length > 0) return { name: nameOf(topics), hint: countText(count) };
  // Single notes picked by hand are the whole choice only when no kind, tag or link also picks pages; otherwise there is no honest short name.
  const other = basis.other, onlyByHand = other.types.length === 0 && other.tags.length === 0 && other.hops === null;
  if (slice.seeds.length > 0 && onlyByHand) return { name: NOTES_LABEL_WORDS.byHand, hint: countText(count) };
  return null;
}
