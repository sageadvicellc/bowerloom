/**
 * The slice rule engine of the prototype (spec 6.9). Pure functions over plain data: no file, no clock, no random number.
 *
 * How a rule matches. A rule has three handles: folders, page types and tags, and links from the seed pages.
 * The handles combine with OR: a page is in the slice when ANY handle picks it.
 *  - folders: a page matches when its folder equals a listed folder or sits below one ("a/b" is below "a", but "ab" is not).
 *    A trailing slash is ignored. An empty folder name matches nothing.
 *  - types and tags: a page matches when its type is listed OR any one of its tags is listed.
 *  - linksFromSeeds: the pages reachable from the seed pages by following 1 or 2 outgoing links are added. Only the seeds start the walk.
 * The seed pages themselves always match, whatever the handles say. A seed id that is not a page is ignored.
 */
import type { SliceRule, WikiPage } from './types.js';

/** Live evaluation of a rule over a page list. Returns the ids of the matching pages. Nothing in the inputs changes. */
export function matchPages(rule: SliceRule, seeds: readonly string[], pages: readonly WikiPage[]): ReadonlySet<string> {
  const byId = new Map<string, WikiPage>();
  for (const p of pages) byId.set(p.id, p);
  const matched = new Set<string>();

  // Seeds always match.
  const start: string[] = [];
  for (const id of seeds) if (byId.has(id)) { matched.add(id); start.push(id); }

  // Handle 1: folders, the folder itself or anything below it.
  const folders = rule.folders.map(f => f.replace(/\/+$/, '')).filter(f => f !== '');
  // Handle 2: page types and tags, either one is enough.
  const types = new Set(rule.pageTypesAndTags.types), tags = new Set(rule.pageTypesAndTags.tags);
  if (folders.length > 0 || types.size > 0 || tags.size > 0) {
    for (const p of pages) {
      if (matched.has(p.id)) continue;
      if (folders.some(f => p.folder === f || p.folder.startsWith(`${f}/`)) || types.has(p.type) || p.tags.some(t => tags.has(t))) matched.add(p.id);
    }
  }

  // Handle 3: walk the outgoing links from the seeds, one or two steps.
  if (rule.linksFromSeeds !== null) {
    let frontier = new Set(start);
    for (let step = 0; step < rule.linksFromSeeds.hops; step += 1) {
      const nextFrontier = new Set<string>();
      for (const id of frontier) for (const to of byId.get(id)!.links) if (byId.has(to)) { matched.add(to); nextFrontier.add(to); }
      frontier = nextFrontier;
    }
  }
  return matched;
}

/** How many pages a rule matches. */
export function countMatches(rule: SliceRule, seeds: readonly string[], pages: readonly WikiPage[]): number {
  return matchPages(rule, seeds, pages).size;
}

/** The pages of a matched set, in the order of the page list. */
export function selectPages(matched: ReadonlySet<string>, pages: readonly WikiPage[]): WikiPage[] {
  return pages.filter(p => matched.has(p.id));
}

/**
 * A rough count of the tokens (the small pieces of text a model reads) in a set of pages.
 * PLACEHOLDER: spec 6.9 gives no formula. This sums ceil(bytes / 4) per page. The real source of the estimate is the 0.7 estimator in
 * packages/context-slices/src/estimate.ts. It is not imported here, so the prototype stays free of it.
 */
export function estimateTokens(pages: readonly WikiPage[]): number {
  let total = 0;
  for (const p of pages) total += Math.ceil(p.bytes / 4);
  return total;
}

/**
 * The links that leave the slice: from a matched page to a page that exists and is not matched. These are the dashed lines.
 * In page order, then link order. A repeated link counts once. A link to the page itself or to a page that does not exist is dropped.
 */
export function cutLinks(matched: ReadonlySet<string>, pages: readonly WikiPage[]): readonly { from: string; to: string }[] {
  const ids = new Set(pages.map(p => p.id)), out: { from: string; to: string }[] = [];
  for (const p of pages) {
    if (!matched.has(p.id)) continue;
    const seen = new Set<string>();
    for (const to of p.links) {
      if (to === p.id || !ids.has(to) || matched.has(to) || seen.has(to)) continue;
      seen.add(to); out.push({ from: p.id, to });
    }
  }
  return out;
}

/** How many matched pages joined the slice since the last visit. */
export function joinedSince(matched: ReadonlySet<string>, pages: readonly WikiPage[]): number {
  let n = 0;
  for (const p of pages) if (p.joinedSinceVisit && matched.has(p.id)) n += 1;
  return n;
}

const count = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const joinWords = (items: readonly string[], last: string): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`);

function describeFolder(folder: string, pages: readonly WikiPage[]): string {
  const clean = folder.replace(/\/+$/, ''), parts = clean.split('/');
  const inside = pages.filter(p => p.folder === clean || p.folder.startsWith(`${clean}/`)).length;
  const place = parts.length === 1 ? `the ${clean} folder` : `the ${parts[parts.length - 1]} folder inside ${parts.slice(0, -1).join(' / ')}`;
  return `${place} (${inside === 0 ? 'no pages yet' : count(inside, 'page', 'pages')})`;
}

/**
 * The rule in plain words for a person who does not read code, for example
 * "Everything in the harbor folder (12 pages), plus pages with the tag amber, plus the pages that your picked pages have links to."
 * The page list is used to say how many pages each folder holds today.
 */
export function describeRule(rule: SliceRule, pages: readonly WikiPage[]): string {
  const clauses: { lead: string; more: string }[] = [];
  const folders = rule.folders.filter(f => f.replace(/\/+$/, '') !== '');
  if (folders.length > 0) { const where = joinWords(folders.map(f => describeFolder(f, pages)), 'and'); clauses.push({ lead: `Everything in ${where}`, more: `everything in ${where}` }); }
  const { types, tags } = rule.pageTypesAndTags;
  if (types.length > 0) { const t = `pages of the ${types.length === 1 ? 'type' : 'types'} ${joinWords(types, 'or')}`; clauses.push({ lead: `All ${t}`, more: t }); }
  if (tags.length > 0) { const t = `pages with the ${tags.length === 1 ? 'tag' : 'tags'} ${joinWords(tags, 'or')}`; clauses.push({ lead: `All ${t}`, more: t }); }
  if (rule.linksFromSeeds !== null) {
    const more = rule.linksFromSeeds.hops === 1 ? 'the pages that your picked pages have links to' : 'the pages that your picked pages have links to, and the pages those pages have links to in turn';
    clauses.push({ lead: `The pages you picked, plus ${more}`, more });
  }
  if (clauses.length === 0) return 'Only the pages you pick by hand are in this slice.';
  return `${clauses.map((c, i) => (i === 0 ? c.lead : `plus ${c.more}`)).join(', ')}.`;
}
