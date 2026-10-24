/**
 * Which pages a knowledge slice holds (spec 6.9). The store and the screen must never disagree on a count, so there is ONE matcher:
 * `matchPages` in slicerule.ts. This file only adapts it to a World and keeps the order of `World.wikiPages`.
 * The rule: a page joins when ANY handle picks it. Folders (a subfolder counts), page types and tags, and links of 1 or 2 hops from the seeds.
 * Seeds always match. An empty rule picks nothing. Pure: no clock, no random number.
 */
import { matchPages, selectPages } from './slicerule.js';
import type { Slice, SliceRule, WikiPage, World } from './types.js';

/** The pages a rule and its seeds pick right now, ignoring any pin. */
export function liveMatch(world: World, slice: { readonly seeds: readonly string[]; readonly rule: SliceRule }): WikiPage[] {
  return selectPages(matchPages(slice.rule, slice.seeds, world.wikiPages), world.wikiPages);
}

/** The pages a slice really holds: its frozen list when pinned (pages that are gone are dropped), else the live match. */
export function slicePages(world: World, slice: Slice): WikiPage[] {
  if (!slice.pinned || slice.pinnedPageIds === undefined) return liveMatch(world, slice);
  const frozen = new Set(slice.pinnedPageIds);
  return world.wikiPages.filter(p => frozen.has(p.id));
}
