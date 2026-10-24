/**
 * Which pages a knowledge slice holds (spec 6.9). A slice rule has three handles, and a page joins when ANY handle picks it:
 * 1. the page sits in one of the rule's folders (a subfolder counts);
 * 2. the page's type is one of the rule's types, or one of its tags is one of the rule's tags;
 * 3. the page is a seed, or lies one or two links away from a seed (following the links a page points to).
 * An empty rule picks nothing. The result keeps the order of `World.wikiPages`. Pure: no clock, no random number.
 */
import type { Slice, SliceRule, WikiPage, World } from './types.js';

/** The pages a rule and its seeds pick right now, ignoring any pin. */
export function liveMatch(world: World, slice: { readonly seeds: readonly string[]; readonly rule: SliceRule }): WikiPage[] {
  const { rule } = slice;
  const byId = new Map(world.wikiPages.map(p => [p.id, p]));
  const picked = new Set<string>();
  for (const page of world.wikiPages) {
    const inFolder = rule.folders.some(f => page.folder === f || page.folder.startsWith(`${f}/`));
    const byType = rule.pageTypesAndTags.types.includes(page.type) || page.tags.some(t => rule.pageTypesAndTags.tags.includes(t));
    if (inFolder || byType) picked.add(page.id);
  }
  let frontier = slice.seeds.filter(id => byId.has(id));
  for (const id of frontier) picked.add(id);
  const hops = rule.linksFromSeeds === null ? 0 : rule.linksFromSeeds.hops;
  for (let hop = 0; hop < hops; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) for (const target of byId.get(id)?.links ?? []) if (byId.has(target) && !picked.has(target)) { picked.add(target); next.push(target); }
    frontier = next;
  }
  return world.wikiPages.filter(p => picked.has(p.id));
}

/** The pages a slice really holds: its frozen list when pinned (pages that are gone are dropped), else the live match. */
export function slicePages(world: World, slice: Slice): WikiPage[] {
  if (!slice.pinned || slice.pinnedPageIds === undefined) return liveMatch(world, slice);
  const frozen = new Set(slice.pinnedPageIds);
  return world.wikiPages.filter(p => frozen.has(p.id));
}
