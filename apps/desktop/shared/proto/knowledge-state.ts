/**
 * The state of the Knowledge screen and the pure rule that changes it. The screen keeps a WORKING copy of a slice (its rule and seeds);
 * the store holds the saved one. Nothing here reaches the store. Pure: no clock, no random number, no file.
 *
 * Two ways to pick, one working rule:
 *  - "Pick on the graph": the person picks pages (`picks`), and the rule is INFERRED from them (slice-infer.ts) each time the pick changes.
 *  - "Build a rule": the person changes the three handles by hand. A change by hand ends the pick: the rule stays, `picks` empties.
 */
import { inferRule } from './slice-infer.js';
import type { Handle } from './slice-infer.js';
import { combinePicks } from './slice-lasso.js';
import type { LassoMode } from './slice-lasso.js';
import { pagesInFolder, pagesWithTag, setHops, toggleFolder, toggleTag, toggleType } from './slice-tree.js';
import type { Slice, SliceRule, WikiPage } from './types.js';

/** The rule that picks nothing. */
export const EMPTY_RULE: SliceRule = Object.freeze({ folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }) as SliceRule;

/** Which way to pick is showing. */
export type Way = 'graph' | 'rule';

export interface KnowledgeState {
  /** The id of the saved slice being worked on, or null for a new slice that has no id until it is saved. */
  readonly chosenId: string | null;
  /** The name for a new slice. For a saved slice it is the saved name. */
  readonly name: string;
  readonly way: Way;
  readonly rule: SliceRule;
  readonly seeds: readonly string[];
  /** The pages picked on the graph or in the list. Empty when the rule was built by hand. */
  readonly picks: readonly string[];
  /** Offers the person accepted, so they stay in the rule when the pick changes. */
  readonly accepted: readonly Handle[];
  readonly lasso: boolean;
  /** The page whose folder and tags the list actions use. */
  readonly focusPage: string | null;
  /** The list shows the pages in the slice, or every page. */
  readonly list: 'slice' | 'all';
  readonly query: string;
}

export type KnowledgeAction =
  | { readonly type: 'choose'; readonly slice: Slice }
  | { readonly type: 'newSlice' }
  | { readonly type: 'rename'; readonly name: string }
  | { readonly type: 'reset'; readonly slice: Slice | null }
  | { readonly type: 'way'; readonly way: Way }
  | { readonly type: 'lasso'; readonly on: boolean }
  | { readonly type: 'lassoResult'; readonly ids: readonly string[]; readonly mode: LassoMode }
  | { readonly type: 'togglePick'; readonly id: string }
  | { readonly type: 'pickFolder'; readonly folder: string }
  | { readonly type: 'pickTag'; readonly tag: string }
  | { readonly type: 'clearPicks' }
  | { readonly type: 'acceptOffer'; readonly handle: Handle }
  | { readonly type: 'dropOffer'; readonly handle: Handle }
  | { readonly type: 'hops'; readonly hops: 0 | 1 | 2 }
  | { readonly type: 'toggleFolder'; readonly folder: string }
  | { readonly type: 'toggleType'; readonly value: string }
  | { readonly type: 'toggleTag'; readonly tag: string }
  | { readonly type: 'removeSeed'; readonly id: string }
  | { readonly type: 'clearSeeds' }
  | { readonly type: 'focusPage'; readonly id: string | null }
  | { readonly type: 'list'; readonly list: 'slice' | 'all' }
  | { readonly type: 'query'; readonly query: string };

/** What the reducer needs to know about the world. */
export interface KnowledgeContext { readonly pages: readonly WikiPage[] }

const clone = (rule: SliceRule): SliceRule => structuredClone(rule);

function loaded(slice: Slice, keep: KnowledgeState | null): KnowledgeState {
  return {
    chosenId: slice.id, name: slice.name, way: keep?.way ?? 'graph', rule: clone(slice.rule), seeds: [...slice.seeds], picks: [], accepted: [],
    lasso: keep?.lasso ?? false, focusPage: null, list: keep?.list ?? 'slice', query: '',
  };
}

/** The state when the screen opens: the first slice is chosen, or an empty new slice when there are none. */
export function initialKnowledge(slices: readonly Slice[]): KnowledgeState {
  const first = slices[0];
  if (first !== undefined) return loaded(first, null);
  return { chosenId: null, name: '', way: 'graph', rule: clone(EMPTY_RULE), seeds: [], picks: [], accepted: [], lasso: false, focusPage: null, list: 'slice', query: '' };
}

/** The working copy as a slice, for the numbers and the lit pages. */
export const workingSlice = (s: KnowledgeState): Pick<Slice, 'id' | 'name' | 'seeds' | 'rule'> => ({ id: s.chosenId ?? '', name: s.name, seeds: s.seeds, rule: s.rule });

const empty = (rule: SliceRule, seeds: readonly string[]): boolean =>
  rule.folders.length === 0 && rule.pageTypesAndTags.types.length === 0 && rule.pageTypesAndTags.tags.length === 0 && rule.linksFromSeeds === null && seeds.length === 0;

const sortedIds = (list: readonly string[]): string[] => [...list].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const x = sortedIds(a), y = sortedIds(b);
  return x.every((id, i) => id === y[i]);
};

/** True when two lists hold the same ids, whatever the order. Picked pages are a set: pick a page, remove it, pick it again, and nothing has changed. */
export const sameSeeds = sameSet;

/** True when two rules pick the same way: the same folders, types and tags (as sets), and the same link reach. */
export function sameRule(a: SliceRule, b: SliceRule): boolean {
  return sameSet(a.folders, b.folders) && sameSet(a.pageTypesAndTags.types, b.pageTypesAndTags.types) && sameSet(a.pageTypesAndTags.tags, b.pageTypesAndTags.tags)
    && (a.linksFromSeeds?.hops ?? 0) === (b.linksFromSeeds?.hops ?? 0);
}

/**
 * True when the working copy differs from the saved slice (or, for a new slice, when it holds anything worth saving).
 * This is the one rule for "unsaved" on the Knowledge screen: seeds and the lists of a rule are compared as sets, not in order.
 */
export function isDirty(s: KnowledgeState, saved: Slice | null): boolean {
  if (saved === null) return s.name.trim() !== '' || !empty(s.rule, s.seeds);
  return !sameRule(s.rule, saved.rule) || !sameSeeds(s.seeds, saved.seeds);
}

function infer(s: KnowledgeState, picks: readonly string[], ctx: KnowledgeContext, hops: 0 | 1 | 2, accepted: readonly Handle[]): KnowledgeState {
  const r = inferRule(picks, ctx.pages, { hops, accept: accepted });
  return { ...s, picks, accepted, rule: r.rule, seeds: r.seeds };
}

const hopsOf = (rule: SliceRule): 0 | 1 | 2 => (rule.linksFromSeeds === null ? 0 : rule.linksFromSeeds.hops);
/** A change by hand: the new rule stays as it is, and the pick ends. */
const byHand = (s: KnowledgeState, rule: SliceRule): KnowledgeState => ({ ...s, rule, picks: [], accepted: [] });
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** The pure rule of the screen: a state and an action in, the next state out. Never changes its inputs. An action that changes nothing returns the same state. */
export function reduceKnowledge(s: KnowledgeState, a: KnowledgeAction, ctx: KnowledgeContext): KnowledgeState {
  switch (a.type) {
    case 'choose': return loaded(a.slice, s);
    case 'newSlice': return { ...initialKnowledge([]), way: s.way, lasso: s.lasso, list: s.list };
    case 'rename': return a.name === s.name ? s : { ...s, name: a.name };
    case 'reset': return a.slice === null ? { ...initialKnowledge([]), way: s.way, lasso: s.lasso, list: s.list } : loaded(a.slice, s);
    case 'way': return a.way === s.way ? s : { ...s, way: a.way };
    case 'lasso': return a.on === s.lasso ? s : { ...s, lasso: a.on };
    case 'lassoResult': {
      const picks = combinePicks(s.picks, a.ids, a.mode);
      if (same(picks, s.picks)) return s;
      return infer(s, picks, ctx, hopsOf(s.rule), s.accepted);
    }
    case 'togglePick': {
      if (s.way === 'rule') {
        const seeds = s.seeds.includes(a.id) ? s.seeds.filter(x => x !== a.id) : [...s.seeds, a.id];
        return { ...s, seeds, picks: [] };
      }
      return infer(s, combinePicks(s.picks, [a.id], s.picks.includes(a.id) ? 'remove' : 'add'), ctx, hopsOf(s.rule), s.accepted);
    }
    case 'pickFolder': {
      const picks = combinePicks(s.picks, pagesInFolder(ctx.pages, a.folder), 'add');
      return same(picks, s.picks) ? s : infer(s, picks, ctx, hopsOf(s.rule), s.accepted);
    }
    case 'pickTag': {
      const picks = combinePicks(s.picks, pagesWithTag(ctx.pages, a.tag), 'add');
      return same(picks, s.picks) ? s : infer(s, picks, ctx, hopsOf(s.rule), s.accepted);
    }
    case 'clearPicks': return infer(s, [], ctx, hopsOf(s.rule), []);
    case 'acceptOffer': {
      if (s.accepted.some(h => h.kind === a.handle.kind && h.value === a.handle.value)) return s;
      return infer(s, s.picks, ctx, hopsOf(s.rule), [...s.accepted, a.handle]);
    }
    case 'dropOffer': return infer(s, s.picks, ctx, hopsOf(s.rule), s.accepted.filter(h => !(h.kind === a.handle.kind && h.value === a.handle.value)));
    case 'hops': {
      if (hopsOf(s.rule) === a.hops) return s;
      return s.picks.length > 0 ? infer(s, s.picks, ctx, a.hops, s.accepted) : { ...s, rule: setHops(s.rule, a.hops) };
    }
    case 'toggleFolder': return byHand(s, toggleFolder(s.rule, a.folder));
    case 'toggleType': return byHand(s, toggleType(s.rule, a.value));
    case 'toggleTag': return byHand(s, toggleTag(s.rule, a.tag));
    case 'removeSeed': return s.seeds.includes(a.id) ? { ...s, seeds: s.seeds.filter(x => x !== a.id), picks: s.picks.filter(x => x !== a.id) } : s;
    case 'clearSeeds': return s.seeds.length === 0 ? s : { ...s, seeds: [], picks: [] };
    case 'focusPage': return a.id === s.focusPage ? s : { ...s, focusPage: a.id };
    case 'list': return a.list === s.list ? s : { ...s, list: a.list };
    case 'query': return a.query === s.query ? s : { ...s, query: a.query };
  }
}
