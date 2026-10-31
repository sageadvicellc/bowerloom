/**
 * The folder tree and the checklists of the rule builder (spec 6.9, "Build a rule"), and the small edits a click makes to a rule.
 * Pure: every function returns a new rule and leaves its input alone. A folder name is a path with slashes, for example "alder/tidepool".
 */
import type { SliceRule, WikiPage } from './types.js';

/** One folder of the tree. `count` is the number of pages in it and everything below it. */
export interface FolderNode { readonly folder: string; readonly name: string; readonly count: number; readonly children: readonly FolderNode[] }

/** One value of a checklist and how many pages carry it. */
export interface FacetValue { readonly value: string; readonly count: number }

const clean = (folder: string): string => folder.replace(/\/+$/, '');
const inside = (page: WikiPage, folder: string): boolean => page.folder === folder || page.folder.startsWith(`${folder}/`);
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The domain folders with their subfolders, sorted by name. Pages at the top level (no folder) are not in the tree. */
export function buildFolderTree(pages: readonly WikiPage[]): FolderNode[] {
  interface Draft { count: number; children: Map<string, Draft> }
  const root: Draft = { count: 0, children: new Map() };
  for (const p of pages) {
    if (p.folder === '') continue;
    let at = root;
    for (const part of p.folder.split('/')) {
      let next = at.children.get(part);
      if (next === undefined) { next = { count: 0, children: new Map() }; at.children.set(part, next); }
      next.count += 1; at = next;
    }
  }
  const make = (d: Draft, base: string): FolderNode[] => [...d.children.keys()].sort(byName).map(name => {
    const child = d.children.get(name)!, folder = base === '' ? name : `${base}/${name}`;
    return { folder, name, count: child.count, children: make(child, folder) };
  });
  return make(root, '');
}

/** The page types and the tags that appear, each with a count, sorted by name. */
export function facetCounts(pages: readonly WikiPage[]): { types: FacetValue[]; tags: FacetValue[] } {
  const types = new Map<string, number>(), tags = new Map<string, number>();
  for (const p of pages) { types.set(p.type, (types.get(p.type) ?? 0) + 1); for (const t of new Set(p.tags)) tags.set(t, (tags.get(t) ?? 0) + 1); }
  const list = (m: Map<string, number>): FacetValue[] => [...m.keys()].sort(byName).map(value => ({ value, count: m.get(value)! }));
  return { types: list(types), tags: list(tags) };
}

/** The ids of the pages in a folder or below it. */
export const pagesInFolder = (pages: readonly WikiPage[], folder: string): string[] => pages.filter(p => inside(p, clean(folder))).map(p => p.id);
/** The ids of the pages that carry a tag. */
export const pagesWithTag = (pages: readonly WikiPage[], tag: string): string[] => pages.filter(p => p.tags.includes(tag)).map(p => p.id);
/** The ids of the pages of a page type. */
export const pagesOfType = (pages: readonly WikiPage[], type: string): string[] => pages.filter(p => p.type === type).map(p => p.id);

/**
 * How a folder stands in a rule: `on` (it is listed), `under` (a folder above it is listed, so it is included already),
 * `partial` (only some folders below it are listed), or `off`.
 */
export function folderState(rule: SliceRule, folder: string): 'on' | 'under' | 'partial' | 'off' {
  const f = clean(folder), listed = rule.folders.map(clean).filter(x => x !== '');
  if (listed.includes(f)) return 'on';
  if (listed.some(x => f.startsWith(`${x}/`))) return 'under';
  if (listed.some(x => x.startsWith(`${f}/`))) return 'partial';
  return 'off';
}

/** Lists a folder, or unlists it. Listing a folder drops the folders below it, because it includes them. A folder under a listed folder cannot be toggled. */
export function toggleFolder(rule: SliceRule, folder: string): SliceRule {
  const f = clean(folder), state = folderState(rule, f);
  if (state === 'under') return rule;
  const folders = state === 'on' ? rule.folders.filter(x => clean(x) !== f) : [...rule.folders.filter(x => !clean(x).startsWith(`${f}/`)), f];
  return { ...rule, folders };
}

const flip = (list: readonly string[], value: string): string[] => (list.includes(value) ? list.filter(v => v !== value) : [...list, value]);

/** Adds a page type to the rule, or takes it out. */
export const toggleType = (rule: SliceRule, value: string): SliceRule => ({ ...rule, pageTypesAndTags: { ...rule.pageTypesAndTags, types: flip(rule.pageTypesAndTags.types, value) } });
/** Adds a tag to the rule, or takes it out. */
export const toggleTag = (rule: SliceRule, value: string): SliceRule => ({ ...rule, pageTypesAndTags: { ...rule.pageTypesAndTags, tags: flip(rule.pageTypesAndTags.tags, value) } });
/** Sets how far the rule follows links from the seed pages: 0 for not at all, else 1 or 2 hops. */
export const setHops = (rule: SliceRule, hops: 0 | 1 | 2): SliceRule => ({ ...rule, linksFromSeeds: hops === 0 ? null : { hops } });
