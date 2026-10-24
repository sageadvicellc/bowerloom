/**
 * What the Knowledge screen shows about a slice (spec 6.9, "Preview"): the page count, a rough token estimate, how many pages joined since the
 * last visit, the links that leave the slice, and what each interface does with the slice. Pure: no clock, no random number.
 */
import type { Enforcement, InterfaceInfo, SliceRule, WikiPage } from './types.js';
import { cutLinks, estimateTokens, joinedSince, matchPages } from './slicerule.js';
import { interfaceName } from './words.js';

/** An outside page and how many links from the slice point at it. */
export interface OutsidePage { readonly id: string; readonly title: string; readonly links: number }

/** The numbers of the preview panel. */
export interface Preview {
  readonly count: number;
  readonly tokens: number;
  /** The rough size of the map alone: a title and one line for each page. */
  readonly mapTokens: number;
  readonly joined: number;
  readonly cutCount: number;
  readonly cut: readonly { readonly from: string; readonly to: string }[];
  readonly topOutside: readonly OutsidePage[];
}

/** How many outside pages the panel lists. */
export const TOP_OUTSIDE = 5;

/** The rough size of the map the agent gets: a title and a summary for each page, at four characters to the token. */
export function estimateMapTokens(pages: readonly WikiPage[]): number {
  let total = 0;
  for (const p of pages) total += Math.ceil((p.title.length + p.summary.length + 4) / 4);
  return total;
}

/** Everything the preview panel needs, for the pages in `lit`. */
export function buildPreview(pages: readonly WikiPage[], lit: ReadonlySet<string>): Preview {
  const inSlice = pages.filter(p => lit.has(p.id));
  const cut = cutLinks(lit, pages);
  const into = new Map<string, number>();
  for (const l of cut) into.set(l.to, (into.get(l.to) ?? 0) + 1);
  const title = new Map(pages.map(p => [p.id, p.title] as const));
  const topOutside = [...into.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_OUTSIDE).map(([id, links]) => ({ id, title: title.get(id) ?? id, links }));
  return { count: inSlice.length, tokens: estimateTokens(inSlice), mapTokens: estimateMapTokens(inSlice), joined: joinedSince(lit, pages), cutCount: cut.length, cut, topOutside };
}

const cache = new WeakMap<readonly WikiPage[], Map<string, ReadonlySet<string>>>();
const KEEP = 64;

/** The pages a rule and its seeds pick, kept per page list so a repeated rule costs nothing. The same inputs give the very same set. */
export function memoMatch(pages: readonly WikiPage[], rule: SliceRule, seeds: readonly string[]): ReadonlySet<string> {
  let mine = cache.get(pages);
  if (mine === undefined) { mine = new Map(); cache.set(pages, mine); }
  const key = JSON.stringify([rule.folders, rule.pageTypesAndTags.types, rule.pageTypesAndTags.tags, rule.linksFromSeeds, seeds]);
  const known = mine.get(key);
  if (known !== undefined) return known;
  const fresh = matchPages(rule, seeds, pages);
  if (mine.size >= KEEP) mine.delete(mine.keys().next().value as string);
  mine.set(key, fresh);
  return fresh;
}

/** A whole number with thousands commas: 12400 becomes "12,400". */
export function formatCount(n: number): string {
  const text = String(Math.abs(Math.trunc(n))), out: string[] = [];
  for (let end = text.length; end > 0; end -= 3) out.unshift(text.slice(Math.max(0, end - 3), end));
  return `${n < 0 ? '-' : ''}${out.join(',')}`;
}

/** "about 12,400 tokens. This is a rough estimate." */
export const tokenSentence = (tokens: number): string => `about ${formatCount(tokens)} ${tokens === 1 ? 'token' : 'tokens'}. This is a rough estimate.`;

const MEANING: Readonly<Record<Enforcement, string>> = {
  'blocks reads': 'The agent cannot read pages outside this slice. The interface refuses the read.',
  'advisory only': 'The agent is told to stay inside this slice, but nothing stops it from reading other pages.',
};

/** The badge for one interface: its label ("Claude Code: blocks reads") and one sentence on what that means. */
export function badgeFor(info: InterfaceInfo): { readonly label: string; readonly meaning: string; readonly enforcement: Enforcement; readonly installed: boolean } {
  return { label: `${interfaceName(info.id)}: ${info.enforcement}`, meaning: MEANING[info.enforcement], enforcement: info.enforcement, installed: info.installed === 'installed' };
}

/** What a frozen slice says about itself: how many pages it holds, and how many the rule would pick today. */
export function frozenSentence(frozen: number, live: number): string {
  const diff = live - frozen;
  const base = `Frozen at ${frozen} ${frozen === 1 ? 'page' : 'pages'}.`;
  if (diff === 0) return `${base} The rule picks the same ${frozen === 1 ? 'page' : 'pages'} today.`;
  return `${base} The rule would pick ${live} ${live === 1 ? 'page' : 'pages'} today, ${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'}.`;
}
