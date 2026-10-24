/**
 * Inferring a slice rule from the pages a person picked (spec 6.9, "Pick on the graph"). Pure: no clock, no random number, no file.
 *
 * The person picks pages (by a loop on the graph, a click, or a list). The app turns the pick into a rule with the three handles:
 *  1. A folder is a handle when the pick covers most of its pages (at least `COVER_SHARE`, and at least `MIN_PICKED` pages). A whole domain
 *     folder wins over its subfolders. The rule then brings in the folder's other pages too, and the preview shows that.
 *  2. A page type or a tag is a handle on the pages left over, by the same cover test.
 *  3. A type or tag that makes up most of the leftover pages but covers little of its own pages is only OFFERED. The person accepts it with
 *     `options.accept`. This keeps "I picked 20 pages" from silently becoming "87 pages".
 *  4. The pages that no handle covers stay as seeds.
 * Links from the seeds are a separate choice (`options.hops`). With hops set, every picked page is a seed, so the walk starts from all of them.
 * The result always matches every picked page. The order of the picks does not change the rule.
 */
import type { SliceRule, WikiPage } from './types.js';
import { folderPlace } from './slicerule.js';

/** A folder, tag or type counts as picked when at least this share of its pages is picked. */
export const COVER_SHARE = 0.6;
/** A handle needs at least this many picked pages behind it. */
export const MIN_PICKED = 2;
/** A type or tag is offered when at least this share of the leftover pages carries it, and at least `MIN_OFFER` do. */
export const OFFER_SHARE = 0.6;
export const MIN_OFFER = 3;

/** A page type or a tag that could be a handle. */
export interface Handle { readonly kind: 'tag' | 'type'; readonly value: string }

/** A handle the app suggests but did not apply: how many of the picked pages carry it, and how many pages carry it in all. */
export interface Offer extends Handle { readonly picked: number; readonly total: number }

/** One folder the rule uses: how many of its pages were picked, and how many it holds. */
export interface FolderUse { readonly folder: string; readonly picked: number; readonly total: number }

/** What the inference gives back. `leftover` is the picked pages that no handle covers; `seeds` is the leftover, or every picked page when hops are set. */
export interface Inference {
  readonly rule: SliceRule;
  readonly seeds: readonly string[];
  readonly leftover: readonly string[];
  readonly folders: readonly FolderUse[];
  readonly used: readonly Offer[];
  readonly offers: readonly Offer[];
  readonly picked: number;
}

/** The choices that are not the pick itself: the links and the offers the person accepted. */
export interface InferOptions { readonly hops?: 0 | 1 | 2; readonly accept?: readonly Handle[] }

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const prefixesOf = (folder: string): string[] => { const parts = folder.split('/').filter(p => p !== ''), out: string[] = []; for (let n = 1; n <= parts.length; n += 1) out.push(parts.slice(0, n).join('/')); return out; };

/** Infers a rule from the picked page ids. Ids that are not pages are ignored. */
export function inferRule(pickedIds: readonly string[], pages: readonly WikiPage[], options: InferOptions = {}): Inference {
  const wanted = new Set(pickedIds);
  const picked = pages.filter(p => wanted.has(p.id));
  const hops = options.hops ?? 0;

  // Handle 1: folders, from the top down. A folder under a chosen folder is skipped.
  const totals = new Map<string, number>(), got = new Map<string, number>();
  for (const p of pages) for (const f of prefixesOf(p.folder)) totals.set(f, (totals.get(f) ?? 0) + 1);
  for (const p of picked) for (const f of prefixesOf(p.folder)) got.set(f, (got.get(f) ?? 0) + 1);
  const candidates = [...got.keys()].sort((a, b) => a.split('/').length - b.split('/').length || byName(a, b));
  const folders: FolderUse[] = [];
  for (const f of candidates) {
    if (folders.some(c => f === c.folder || f.startsWith(`${c.folder}/`))) continue;
    const n = got.get(f)!, total = totals.get(f)!;
    if (n >= MIN_PICKED && n / total >= COVER_SHARE) folders.push({ folder: f, picked: n, total });
  }
  const inFolder = (p: WikiPage): boolean => folders.some(c => p.folder === c.folder || p.folder.startsWith(`${c.folder}/`));
  let rest = picked.filter(p => !inFolder(p));

  // Handles 2: types and tags on what is left. First what the person accepted, then what covers most of its own pages.
  const carries = (p: WikiPage, h: Handle): boolean => (h.kind === 'type' ? p.type === h.value : p.tags.includes(h.value));
  const totalOf = new Map<string, number>(), pickedOf = new Map<string, number>();
  const key = (h: Handle): string => `${h.kind}\u0000${h.value}`;
  const count = (into: Map<string, number>, p: WikiPage): void => {
    into.set(key({ kind: 'type', value: p.type }), (into.get(key({ kind: 'type', value: p.type })) ?? 0) + 1);
    for (const t of new Set(p.tags)) into.set(key({ kind: 'tag', value: t }), (into.get(key({ kind: 'tag', value: t })) ?? 0) + 1);
  };
  for (const p of pages) count(totalOf, p);
  for (const p of picked) count(pickedOf, p);
  const handleOf = (k: string): Handle => { const [kind, value] = k.split('\u0000'); return { kind: kind === 'tag' ? 'tag' : 'type', value: value! }; };
  const used: Offer[] = [];
  const use = (h: Handle): void => {
    if (used.some(u => key(u) === key(h))) return;
    used.push({ ...h, picked: pickedOf.get(key(h)) ?? 0, total: totalOf.get(key(h)) ?? 0 });
    rest = rest.filter(p => !carries(p, h));
  };
  for (const h of options.accept ?? []) if (totalOf.has(key(h))) use(h);
  const everyPage = pages.length;
  const ranked = [...pickedOf.keys()].map(k => ({ h: handleOf(k), n: pickedOf.get(k)!, total: totalOf.get(k)! }))
    .filter(c => c.total < everyPage && c.n >= MIN_PICKED && c.n / c.total >= COVER_SHARE)
    .sort((a, b) => b.n - a.n || byName(key(a.h), key(b.h)));
  for (const c of ranked) if (rest.filter(p => carries(p, c.h)).length >= MIN_PICKED) use(c.h);

  // Offers: a type or a tag that most of the leftover carries but that covers little of its own pages. At most one tag and one type.
  const offers: Offer[] = [];
  for (const kind of ['tag', 'type'] as const) {
    let best: Offer | null = null;
    for (const k of totalOf.keys()) {
      const h = handleOf(k);
      if (h.kind !== kind || used.some(u => key(u) === k) || totalOf.get(k)! >= everyPage) continue;
      const n = rest.filter(p => carries(p, h)).length;
      if (n < MIN_OFFER || n / rest.length < OFFER_SHARE) continue;
      if (best === null || n > best.picked || (n === best.picked && byName(h.value, best.value) < 0)) best = { ...h, picked: n, total: totalOf.get(k)! };
    }
    if (best !== null) offers.push(best);
  }

  const leftover = rest.map(p => p.id);
  const rule: SliceRule = {
    folders: folders.map(f => f.folder).sort(byName),
    pageTypesAndTags: { types: used.filter(u => u.kind === 'type').map(u => u.value).sort(byName), tags: used.filter(u => u.kind === 'tag').map(u => u.value).sort(byName) },
    linksFromSeeds: hops === 0 ? null : { hops },
  };
  return { rule, seeds: hops === 0 ? leftover : picked.map(p => p.id), leftover, folders, used, offers, picked: picked.length };
}

const count = (n: number, one: string, many: string): string => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The reasons for the rule, in plain short sentences, for a person who does not read code. */
export function explainInference(result: Inference): string[] {
  if (result.picked === 0) return ['No pages are picked yet.'];
  const out = [`You picked ${count(result.picked, 'page', 'pages')}.`];
  for (const f of result.folders) out.push(`You picked ${f.picked} of the ${count(f.total, 'page', 'pages')} in ${folderPlace(f.folder)}, so the rule uses the whole folder.`);
  for (const u of result.used) out.push(`You picked ${u.picked} of the ${count(u.total, 'page', 'pages')} with the ${u.kind === 'tag' ? 'tag' : 'type'} ${u.value}, so the rule uses all of them.`);
  if (result.leftover.length > 0) out.push(`${count(result.leftover.length, 'page stays as a single page', 'pages stay as single pages')}.`);
  if (result.rule.linksFromSeeds !== null) out.push(`The rule also adds the pages that your picked pages have links to (${count(result.rule.linksFromSeeds.hops, 'hop', 'hops')}).`);
  return out;
}
