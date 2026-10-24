/**
 * The one rule the Knowledge screen uses for "is the working copy different from the saved slice". Picked pages and the lists of a rule are
 * sets, so the same pages in another order are the same slice: pick a page, remove it, pick it again, and nothing has changed.
 * (`isDirty` in shared/proto/knowledge-state.ts compares seeds in order. It should be aligned with this rule; the screen does not call it.)
 */
import type { KnowledgeState } from '../../shared/proto/knowledge-state.js';
import { isDirty } from '../../shared/proto/knowledge-state.js';
import type { Slice, SliceRule } from '../../shared/proto/types.js';

const sorted = (list: readonly string[]): string[] => [...list].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && sorted(a).every((x, i) => x === sorted(b)[i]);

/** True when two lists hold the same ids, whatever the order. */
export const sameSeeds = sameSet;

/** True when two rules pick the same way: the same folders, types and tags, and the same link reach. */
export function sameRule(a: SliceRule, b: SliceRule): boolean {
  return sameSet(a.folders, b.folders) && sameSet(a.pageTypesAndTags.types, b.pageTypesAndTags.types) && sameSet(a.pageTypesAndTags.tags, b.pageTypesAndTags.tags)
    && (a.linksFromSeeds?.hops ?? 0) === (b.linksFromSeeds?.hops ?? 0);
}

/** True when the working copy differs from the saved slice. For a new slice (`saved` is null): when it holds anything worth saving. */
export function sliceDirty(state: KnowledgeState, saved: Slice | null): boolean {
  if (saved === null) return isDirty(state, null);
  return !sameRule(state.rule, saved.rule) || !sameSeeds(state.seeds, saved.seeds);
}
