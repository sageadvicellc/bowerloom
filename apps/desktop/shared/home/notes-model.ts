/**
 * The model behind "Choose notes": what a person switched on, turned into the one saved-choice rule the store already understands, and back.
 * A person works with three things: TOPICS switched on (with parts "left out"), single notes ticked BY HAND, and, when the agent already reads notes that
 * were chosen another way (by kind, label or link), that set "kept from before". The rule keeps its three handles (spec 6.9): a topic is a folder, a part
 * left out turns the topic into its other parts, a hand pick is a seed page, and "kept from before" is the page types, tags and link reach of the old rule.
 * So `matchPages` (shared/proto/slicerule.ts) counts it, with no second matcher, and a page is in the choice when ANY handle picks it.
 * Pure: no React, no DOM, no clock, no random number. Nothing here changes its input.
 */
import type { SliceRule, Slice, WikiPage } from '../proto/types.js';
import { estimateMapTokens, memoMatch } from '../proto/slice-preview.js';
import { matchPages } from '../proto/slicerule.js';
import { joinWords } from '../proto/words.js';
import { buildTopics, partOf, plainTitles, topicOf } from './notes-topics.js';
import type { Topic } from './notes-topics.js';
import { countWords } from './textbudget.js';

/** What an old choice picked besides folders and single pages: page types, tags, and how far links are followed. */
export interface OtherHandles { readonly types: readonly string[]; readonly tags: readonly string[]; readonly hops: 1 | 2 | null }
export const NO_OTHER: OtherHandles = Object.freeze({ types: [], tags: [], hops: null });

/** What the screen works from: the pages, their topics and plain titles, and the old choice's other handles. Built once per open. */
export interface Basis {
  readonly pages: readonly WikiPage[];
  readonly topics: readonly Topic[];
  readonly titles: ReadonlyMap<string, string>;
  readonly other: OtherHandles;
}

/** What the person has switched on. `on` lists topic ids in the order they were switched on. `leftOut` lists the folders of the parts left out. */
export interface Selection {
  readonly on: readonly string[];
  readonly leftOut: readonly string[];
  readonly hand: readonly string[];
  readonly keepOther: boolean;
}

/** The rule and the seed pages a selection stands for. */
export interface Choice { readonly rule: SliceRule; readonly seeds: readonly string[] }

export const EMPTY_SELECTION: Selection = Object.freeze({ on: [], leftOut: [], hand: [], keepOther: false });

const clean = (folder: string): string => folder.replace(/\/+$/, '');
const hasOther = (o: OtherHandles): boolean => o.types.length > 0 || o.tags.length > 0 || o.hops !== null;
const inside = (folder: string, within: string): boolean => folder === within || folder.startsWith(`${within}/`);

/** The other handles of a saved choice (what is not a folder and not a single page). */
export function otherOf(slice: Slice | undefined): OtherHandles {
  if (slice === undefined) return NO_OTHER;
  const { types, tags } = slice.rule.pageTypesAndTags, hops = slice.rule.linksFromSeeds === null ? null : slice.rule.linksFromSeeds.hops;
  return { types: [...types], tags: [...tags], hops };
}

/** Everything the screen needs to know about a page list and the choice it starts from. */
export function makeBasis(pages: readonly WikiPage[], slice: Slice | undefined): Basis {
  const topics = buildTopics(pages);
  return { pages, topics, titles: plainTitles(pages, topics), other: otherOf(slice) };
}

/** What a saved choice looks like as switches: the topics it names, the parts it leaves out, its single pages, and whether it keeps its other handles. */
export function selectionFromSlice(slice: Slice | undefined, basis: Basis): Selection {
  if (slice === undefined) return EMPTY_SELECTION;
  const listed = slice.rule.folders.map(clean).filter(f => f !== '');
  const on: string[] = [], leftOut: string[] = [];
  for (const topic of basis.topics) {
    if (listed.includes(topic.id)) { on.push(topic.id); continue; }
    const held = topic.parts.filter(p => !p.direct && listed.some(f => inside(f, p.folder) || inside(p.folder, f)));
    if (held.length === 0) continue;
    on.push(topic.id);
    if (held.length < topic.parts.length) for (const p of topic.parts) if (!held.includes(p)) leftOut.push(p.folder);
  }
  return { on, leftOut, hand: [...slice.seeds], keepOther: hasOther(basis.other) };
}

/** The parts of a topic that a selection includes. */
export function includedParts(sel: Selection, topic: Topic): Topic['parts'] {
  return topic.parts.filter(p => !sel.leftOut.includes(p.folder));
}

/** Turns a selection into the rule and seed pages the store keeps. */
export function toChoice(sel: Selection, basis: Basis): Choice {
  const folders: string[] = [], seeds = new Set<string>(sel.hand);
  for (const topic of basis.topics) {
    if (!sel.on.includes(topic.id)) continue;
    const mine = topic.parts.filter(p => sel.leftOut.includes(p.folder));
    if (mine.length === 0) { folders.push(topic.id); continue; }
    for (const part of includedParts(sel, topic)) {
      if (!part.direct) folders.push(part.folder);
      else for (const p of basis.pages) if (p.folder === topic.id) seeds.add(p.id);
    }
  }
  const o = sel.keepOther ? basis.other : NO_OTHER;
  const rule: SliceRule = { folders, pageTypesAndTags: { types: [...o.types], tags: [...o.tags] }, linksFromSeeds: o.hops === null ? null : { hops: o.hops } };
  return { rule, seeds: [...seeds] };
}

/** The ids of the pages a selection picks, counted by `matchPages` itself. */
export function matchedOf(sel: Selection, basis: Basis): ReadonlySet<string> {
  const { rule, seeds } = toChoice(sel, basis);
  return memoMatch(basis.pages, rule, seeds);
}

const flip = (list: readonly string[], value: string): string[] => (list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

/** Switches a topic on or off. Switching it off forgets the parts it left out. */
export function toggleTopic(sel: Selection, topic: Topic): Selection {
  if (sel.on.includes(topic.id)) {
    const mine = new Set(topic.parts.map(p => p.folder));
    return { ...sel, on: sel.on.filter(id => id !== topic.id), leftOut: sel.leftOut.filter(f => !mine.has(f)) };
  }
  return { ...sel, on: [...sel.on, topic.id] };
}

/** Leaves a part out of its topic, or puts it back. */
export const toggleLeaveOut = (sel: Selection, folder: string): Selection => ({ ...sel, leftOut: flip(sel.leftOut, folder) });
/** Ticks or unticks one note picked by hand. */
export const toggleHand = (sel: Selection, id: string): Selection => ({ ...sel, hand: flip(sel.hand, id) });
/** Keeps or drops the notes that were chosen another way before. */
export const toggleKeep = (sel: Selection): Selection => ({ ...sel, keepOther: !sel.keepOther });
/** Takes away every single note picked by hand. */
export const clearHand = (sel: Selection): Selection => (sel.hand.length === 0 ? sel : { ...sel, hand: [] });

const sorted = (list: readonly string[]): string => JSON.stringify([...list].sort());
/** True when two selections switch the same things (the order of switching on does not matter). */
export function sameSelection(a: Selection, b: Selection): boolean {
  return sorted(a.on) === sorted(b.on) && sorted(a.leftOut) === sorted(b.leftOut) && sorted(a.hand) === sorted(b.hand) && a.keepOther === b.keepOther;
}

/** True when nothing is switched on at all. */
export const isEmpty = (sel: Selection, basis: Basis): boolean => sel.on.length === 0 && sel.hand.length === 0 && !(sel.keepOther && hasOther(basis.other));

/** How many notes the old choice's other handles pick on their own, not counting single pages. */
export function keptCount(sel: Selection, basis: Basis): number {
  const o = basis.other;
  if (!hasOther(o)) return 0;
  const rule: SliceRule = { folders: [], pageTypesAndTags: { types: [...o.types], tags: [...o.tags] }, linksFromSeeds: o.hops === null ? null : { hops: o.hops } };
  const mine = matchPages(rule, sel.hand, basis.pages);
  let n = 0;
  for (const id of mine) if (!sel.hand.includes(id)) n += 1;
  return n;
}

/** How many notes a topic switches on, with this selection's parts left out. */
export const topicCount = (sel: Selection, topic: Topic): number => includedParts(sel, topic).reduce((n, p) => n + p.count, 0);

/** The notes a topic adds on top of everything else the selection picks: what the person would lose by switching it off. */
export function addsOf(sel: Selection, topic: Topic, basis: Basis): number {
  const without = sel.on.includes(topic.id) ? toggleTopic(sel, topic) : sel;
  const full = sel.on.includes(topic.id) ? sel : toggleTopic(sel, topic);
  return matchedOf(full, basis).size - matchedOf(without, basis).size;
}

/** One line of the preview list. */
export interface PreviewNote { readonly id: string; readonly title: string; readonly place: string }

/** The numbers and the list of the preview. */
export interface Preview {
  readonly count: number;
  readonly total: number;
  /** The share of all notes, 0 to 1. */
  readonly share: number;
  /** About how many pages of reading the agent keeps in mind at once. 0 when it reads nothing. */
  readonly pages: number;
  readonly notes: readonly PreviewNote[];
}

/** About how many tokens one page of reading holds. The estimate in the preview is only a rough guide. */
export const PAGE_SIZE = 500;

/**
 * The preview of a selection. The notes come newest-topic first (so a click shows its effect at the top), then single picks, then the kept set.
 * `pages` is the size of the list the agent keeps in mind (a title and one line for each note), in pages of reading.
 */
export function previewOf(sel: Selection, basis: Basis): Preview {
  const matched = matchedOf(sel, basis), total = basis.pages.length;
  const recent = [...sel.on].reverse();
  const rank = (p: WikiPage): number => {
    const topic = topicOf(basis.topics, p);
    if (topic !== undefined && sel.on.includes(topic.id) && !sel.leftOut.includes(partOf(topic, p)?.folder ?? '')) return recent.indexOf(topic.id);
    return sel.hand.includes(p.id) ? recent.length : recent.length + 1;
  };
  const chosen = basis.pages.filter(p => matched.has(p.id));
  const order = chosen.map((p, i) => ({ p, i, r: rank(p) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.p);
  const notes = order.map((p): PreviewNote => {
    const topic = topicOf(basis.topics, p);
    return { id: p.id, title: basis.titles.get(p.id) ?? p.title, place: topic === undefined ? '' : topic.name };
  });
  const tokens = estimateMapTokens(chosen);
  return { count: chosen.length, total, share: total === 0 ? 0 : chosen.length / total, pages: chosen.length === 0 ? 0 : Math.max(1, Math.round(tokens / PAGE_SIZE)), notes };
}

const RULE_WORDS = 12;
const fits = (text: string): boolean => countWords(text) <= RULE_WORDS;

/** The left-out part names in a sentence of at most 12 words: all of them, else the first two and a count, else only a count. */
function exceptions(name: string, left: readonly string[]): string {
  const lead = `All notes about ${name}, except`;
  const options = [`${lead} ${joinWords(left)}.`, `${lead} ${left.slice(0, 2).join(', ')} and ${left.length - 2} more.`, `${lead} ${left.length} parts.`];
  return options.find(fits) ?? options[2]!;
}

/** The choice in plain words, one line for each thing switched on. Every line has at most 12 words. */
export function ruleLines(sel: Selection, basis: Basis): string[] {
  const lines: string[] = [];
  for (const topic of basis.topics) {
    if (!sel.on.includes(topic.id)) continue;
    const left = topic.parts.filter(p => sel.leftOut.includes(p.folder)).map(p => p.name);
    if (left.length === 0) lines.push(`All notes about ${topic.name}.`);
    else if (left.length === topic.parts.length) lines.push(`Nothing from ${topic.name}.`);
    else lines.push(exceptions(topic.name, left));
  }
  if (sel.hand.length > 0) lines.push(`${sel.hand.length} ${sel.hand.length === 1 ? 'note' : 'notes'} picked by hand.`);
  if (sel.keepOther && hasOther(basis.other)) { const n = keptCount(sel, basis); lines.push(`${n} ${n === 1 ? 'note' : 'notes'} kept from before.`); }
  return lines;
}
