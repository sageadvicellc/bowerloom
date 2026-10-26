/**
 * The topics of "Choose notes". The wiki holds hundreds of pages in folders, and a person cannot read 700 dots. So the pages are shown as a few TOPICS
 * (the top folders) and, inside a topic, a few PARTS (its sub-folders), each with a plain name and a count. The sample's folder names ("alderhythe/gorse")
 * are invented words, so this file gives each of them a plain name, the way plain.ts does for agents and skills. A folder it does not know becomes words
 * ("fern-hill" becomes "Fern Hill"). It also gives every page a plain title, built from its part and its kind, because the sample's own titles are nonsense.
 * Pure: no React, no DOM, no clock, no random number.
 */
import type { WikiPage } from '../proto/types.js';
import { itemTitle } from './titles.js';

/** One part of a topic: a sub-folder. `folder` is its full path ("alderhythe/gorse"), which is also how the slice rule names it. */
export interface TopicPart { readonly folder: string; readonly name: string; readonly count: number; /** True for pages that sit in the topic folder itself, with no sub-folder. */ readonly direct: boolean }

/** One topic: a top folder, its plain name, how many notes it holds, and its parts, biggest first. */
export interface Topic { readonly id: string; readonly name: string; readonly count: number; readonly parts: readonly TopicPart[] }

type PartNames = Readonly<Record<string, string>>;
/** The plain names of the sample's folders. The key is the invented folder name; the parts are keyed by their own invented names. */
const TABLE: Readonly<Record<string, { readonly name: string; readonly parts: PartNames }>> = Object.freeze({
  alderhythe: { name: 'Clients', parts: { gorse: 'Active clients', linnet: 'Past clients', pennon: 'Prospects', kestrel: 'Contracts' } },
  brindle: { name: 'Company', parts: { furrow: 'Hiring', gorse: 'Handbook', galley: 'Culture' } },
  tarnwick: { name: 'Work', parts: { heddle: 'Current work', harrow: 'Planning', furrow: 'Reviews', dunlin: 'Finished', pennon: 'Archived', ostler: 'Templates' } },
  sedgefield: { name: 'Meetings', parts: { galley: 'Weekly', sloe: 'One to one', kestrel: 'Kickoffs', mizzen: 'Reviews', wicklow: 'Interviews', dapple: 'Archived' } },
  fennrow: { name: 'Research', parts: { rushlight: 'Articles', wicklow: 'Interviews', heddle: 'Surveys', thrum: 'Ideas', ostler: 'Archived' } },
  quillmoor: { name: 'Writing', parts: { yarrow: 'Drafts', rushlight: 'Published', heddle: 'Style notes' } },
  cinderlow: { name: 'Money', parts: { linnet: 'Invoices', heddle: 'Budgets', inglenook: 'Receipts' } },
  marrowdeep: { name: 'Travel', parts: { ostler: 'Trips', kestrel: 'Places', pennon: 'Packing lists' } },
});

/** The words that name a page by its kind, in the plain titles. A Map, because a page's type is the person's own word and can be constructor or __proto__. */
const KIND_WORDS: ReadonlyMap<string, string> = new Map([
  ['concept', 'overview'], ['guide', 'how-to'], ['record', 'record'], ['recipe', 'checklist'], ['survey', 'summary'], ['sketch', 'draft'],
]);

/** What the lone part of loose pages is called. */
export const OTHER_NOTES = 'Other notes';
const MAX_PART_WORDS = 3;

const fit = (text: string, words: number): string => text.split(/\s+/).filter(w => w !== '').slice(0, words).join(' ');
const topicName = (id: string): string => (Object.hasOwn(TABLE, id) ? TABLE[id]!.name : fit(itemTitle(id), MAX_PART_WORDS));
function partName(topic: string, sub: string): string {
  const known = Object.hasOwn(TABLE, topic) && Object.hasOwn(TABLE[topic]!.parts, sub) ? TABLE[topic]!.parts[sub] : undefined;
  return known ?? fit(itemTitle(sub), MAX_PART_WORDS);
}

const byCountThenName = (a: { count: number; name: string }, b: { count: number; name: string }): number => b.count - a.count || a.name.localeCompare(b.name);

/**
 * The topics of a page list, biggest first. A page with no folder at all belongs to no topic (a rule picks folders, so only a hand pick can reach it).
 * A page deeper than two levels counts in the part that holds its second folder. The topic ids are the sample's own top folders, which is what a rule names.
 */
export function buildTopics(pages: readonly WikiPage[]): Topic[] {
  const by = new Map<string, Map<string, number>>();
  for (const p of pages) {
    if (p.folder === '') continue;
    const [top = '', sub = ''] = p.folder.split('/');
    const parts = by.get(top) ?? new Map<string, number>();
    parts.set(sub, (parts.get(sub) ?? 0) + 1);
    by.set(top, parts);
  }
  const topics = [...by].map(([id, parts]): Topic => {
    const list = [...parts].map(([sub, count]): TopicPart => (sub === ''
      ? { folder: id, name: OTHER_NOTES, count, direct: true }
      : { folder: `${id}/${sub}`, name: partName(id, sub), count, direct: false })).sort(byCountThenName);
    return { id, name: topicName(id), count: list.reduce((n, p) => n + p.count, 0), parts: list };
  });
  return topics.sort(byCountThenName);
}

/** The topic a page belongs to, or undefined for a page with no folder. */
export function topicOf(topics: readonly Topic[], page: WikiPage): Topic | undefined {
  const top = page.folder.split('/')[0] ?? '';
  return topics.find(t => t.id === top);
}

/** The part a page belongs to, or undefined for a page with no folder. */
export function partOf(topic: Topic, page: WikiPage): TopicPart | undefined {
  const [top = '', sub = ''] = page.folder.split('/');
  return topic.parts.find(p => p.folder === (sub === '' ? top : `${top}/${sub}`));
}

/**
 * A plain title for every page: its part and its kind, with a number when a part holds more than one of that kind ("Active clients how-to 3").
 * A part name that two topics share is said with its topic ("Work archived how-to 2").
 * The number counts up through the pages in list order, so it is the same every time.
 */
export function plainTitles(pages: readonly WikiPage[], topics: readonly Topic[]): ReadonlyMap<string, string> {
  const seen = new Map<string, number>(), totals = new Map<string, number>();
  const key = (p: WikiPage): string => `${p.folder}\u0000${p.type}`;
  for (const p of pages) totals.set(key(p), (totals.get(key(p)) ?? 0) + 1);
  const shared = new Map<string, number>();
  for (const t of topics) for (const part of t.parts) shared.set(part.name, (shared.get(part.name) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const p of pages) {
    const topic = topicOf(topics, p), part = topic === undefined ? undefined : partOf(topic, p);
    // A part name that two topics use ("Archived") is said with its topic, so two titles never match.
    const place = part === undefined ? (topic === undefined ? OTHER_NOTES : topic.name) : (shared.get(part.name) ?? 0) > 1 && topic !== undefined ? `${topic.name} ${part.name.toLowerCase()}` : part.name;
    const kind = KIND_WORDS.get(p.type) ?? p.type;
    const n = (seen.get(key(p)) ?? 0) + 1;
    seen.set(key(p), n);
    out.set(p.id, `${place} ${kind}${(totals.get(key(p)) ?? 0) > 1 ? ` ${n}` : ''}`);
  }
  return out;
}
