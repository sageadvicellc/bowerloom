/**
 * The plain layer for a real setup. The home screens' plain layer (shared/home/plain.ts) is keyed by the SAMPLE's ids; an id it does not know falls back to a stored
 * name and a generic line. This file gives a thing that came from a real setup a readable name, a one-line hint, a word for what it may do, and the programs it works
 * in, all worked out from the item itself. It is not wired into the screens: the shell calls `registerRealResult` when the world arrives, and a one-line hook in each of
 * a few lookups (see the list in the report) asks `realPlainById` and friends before it falls back.
 *
 * Rules held here: a name has at most 5 words and a hint at most 12 (the text budget of the screens). Text from a file is data: it is cut and cleaned, never run, and
 * never read as markup. Pure: no clock, no random number, no file.
 */
import type { AgentItem, HarnessItem, InterfaceId, Slice, WikiPage, World } from '../world/types.js';
import { matchPages } from '../world/slicerule.js';
import { countWords } from '../home/textbudget.js';
import { PROGRAM_NAMES, PROGRAM_ORDER } from '../home/plain-details.js';
import { itemTitle } from '../home/titles.js';
import { firstSentence, parseFrontmatter } from './frontmatter.js';
import { cleanLine } from './redact.js';
import type { RealResult } from './types.js';

export interface RealPlain {
  readonly name: string;
  readonly hint: string;
  /** A word for what the thing may do when it runs on its own; null when the attachment decides (a connection) or it does nothing alone. */
  readonly access: string | null;
  /** The programs it works in, as a person names them, in the order the details show them. */
  readonly where: readonly string[];
}

export type RealPlainKind = 'agent' | 'skill' | 'tool' | 'note';

const NAME_WORDS = 5, HINT_WORDS = 12;

/** True for an id this reader made. The sample's ids never start this way. */
export const isRealId = (id: string): boolean => id.startsWith('real-') || id.startsWith('item-real-') || id.startsWith('scope-real-');

function cutWords(text: string, max: number): string {
  const words = cleanLine(text).split(' ').filter(w => w !== '');
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ').replace(/[\s,;:.-]+$/, '')}…`;
}

/** A name as a person reads it. A name with a space or a capital is kept (at most 5 words); a file-style name becomes words. */
export function readableOf(name: string): string {
  const base = cleanLine(name.replace(/[:/]+/g, ' '));
  if (base === '') return 'Unnamed';
  if (/[\sA-Z]/.test(base)) { const kept = base.split(' ').slice(0, NAME_WORDS).join(' '); return `${kept.charAt(0).toUpperCase()}${kept.slice(1)}`; }
  return itemTitle(base);
}

const HOOK_WHEN: Readonly<Record<string, readonly [when: string, name: string]>> = Object.freeze({
  PreToolUse: ['before a tool runs', 'Before a tool'], PostToolUse: ['after a tool runs', 'After a tool'], UserPromptSubmit: ['when you send a message', 'On each message'], SessionStart: ['when a session starts', 'At session start'],
  SessionEnd: ['when a session ends', 'At session end'], Stop: ['when the agent stops', 'When it stops'], SubagentStop: ['when a side agent stops', 'When a side agent stops'], Notification: ['when it needs you', 'When it needs you'],
  PreCompact: ['before it tidies its memory', 'Before it tidies up'], notify: ['when a task finishes', 'When a task ends'], 'plug-in': ['whenever it loads', 'A plug-in'],
});

function hookFacts(item: HarnessItem): { event: string; matcher: string } {
  try {
    const data = JSON.parse(item.foundAt[0]?.text ?? '{}') as { event?: unknown; matcher?: unknown };
    return { event: typeof data.event === 'string' ? data.event : '', matcher: typeof data.matcher === 'string' ? data.matcher : '' };
  } catch { return { event: '', matcher: '' }; }
}

function serverFacts(item: HarnessItem): { host: string; command: string } {
  try {
    const data = JSON.parse(item.foundAt[0]?.text ?? '{}') as { host?: unknown; command?: unknown };
    return { host: typeof data.host === 'string' ? data.host : '', command: typeof data.command === 'string' ? data.command : '' };
  } catch { return { host: '', command: '' }; }
}

const whereOf = (item: HarnessItem): string[] => PROGRAM_ORDER.filter(p => item.foundAt.some(f => f.interface === p)).map(p => PROGRAM_NAMES[p]);

/** The plain words of one item of a real setup. */
export function realPlainOf(item: HarnessItem): RealPlain {
  const where = whereOf(item);
  if (item.kind === 'skill') return { name: readableOf(item.name), hint: item.description === '' ? 'A skill from your own setup.' : cutWords(item.description, HINT_WORDS), access: null, where };
  if (item.kind === 'agent') {
    const lead = item.definition.role !== '' ? item.definition.role : firstSentence(item.definition.instructions, 160);
    return { name: readableOf(item.name), hint: lead === '' ? 'An agent from your own setup.' : cutWords(lead, HINT_WORDS), access: null, where };
  }
  if (item.kind === 'context-slice') return { name: readableOf(item.name), hint: 'Notes an agent can read.', access: null, where };
  if (item.toolKind === 'hook') {
    const { event, matcher } = hookFacts(item), known = Object.hasOwn(HOOK_WHEN, event) ? HOOK_WHEN[event] : undefined;
    const name = known === undefined ? readableOf(item.name) : readableOf(`${known[1]}${matcher === '' ? '' : ` (${matcher.replace(/[|*]+/g, ' ').trim()})`}`);
    return { name: name.split(' ').slice(0, NAME_WORDS).join(' '), hint: cutWords(known === undefined ? 'Runs a program on its own.' : `Runs a program ${known[0]}.`, HINT_WORDS), access: 'Runs code', where };
  }
  if (item.toolKind === 'prompt') {
    const text = item.foundAt[0]?.text ?? '', front = parseFrontmatter(text);
    const lead = (typeof front.data.description === 'string' ? front.data.description : '') || firstSentence(front.body, 160);
    return { name: readableOf(item.name), hint: lead === '' ? 'A saved prompt you can reuse.' : cutWords(lead, HINT_WORDS), access: null, where };
  }
  const { host, command } = serverFacts(item);
  return { name: readableOf(item.name), hint: host !== '' ? cutWords(`Connects to ${host}.`, HINT_WORDS) : command !== '' ? cutWords(`Starts ${command} on this computer.`, HINT_WORDS) : 'Connects an agent to a service.', access: null, where };
}

/** The plain words of a set of notes: its name, and how many pages it holds. */
export function realPlainOfSlice(slice: Slice, pages: readonly WikiPage[]): RealPlain {
  const n = matchPages(slice.rule, slice.seeds, pages).size;
  // The set for one topic of a place has the rule "place/topic": it is named by both, so a topic called "notes" is not "Notes notes".
  const folder = slice.rule.folders[0] ?? '', at = folder.indexOf('/');
  return { name: readableOf(at > 0 ? `${folder.slice(at + 1)} in ${folder.slice(0, at)}` : slice.name), hint: n === 0 ? 'No notes yet.' : `${n} ${n === 1 ? 'note' : 'notes'} it can read.`, access: null, where: [] };
}

// ---------------------------------------------------------------------------------------------------------------------- the registry

interface Entry { readonly kind: RealPlainKind; readonly plain: RealPlain; readonly item: HarnessItem | null }

let entries: ReadonlyMap<string, Entry> = new Map();
let agesById: Readonly<Record<string, readonly number[]>> = {};
let recency: ReadonlyMap<string, number> = new Map();

/** Remembers the plain words of every item and set of notes in a world from a real setup, keyed by id. Call it when the world arrives; call `clearRealResult` to forget. */
export function registerRealWorld(world: World, ages: Readonly<Record<string, readonly number[]>> = {}): void {
  const next = new Map<string, Entry>();
  for (const item of world.items) {
    if (item.kind === 'context-slice') continue;
    next.set(item.id, { kind: item.kind === 'tool' ? 'tool' : item.kind, plain: realPlainOf(item), item });
  }
  for (const slice of world.slices) if (isRealId(slice.id)) next.set(slice.id, { kind: 'note', plain: realPlainOfSlice(slice, world.wikiPages), item: null });
  const newest = (a: AgentItem): number => Math.min(...(ages[a.id] ?? [Number.MAX_SAFE_INTEGER]), Number.MAX_SAFE_INTEGER);
  const agents = world.items.filter((i): i is AgentItem => i.kind === 'agent' && isRealId(i.id)).sort((a, b) => newest(a) - newest(b) || (a.id < b.id ? -1 : 1));
  entries = next; agesById = ages; recency = new Map(agents.map((a, i) => [a.id, i] as const));
}

export function registerRealResult(result: RealResult): void { registerRealWorld(result.world, result.ages); }

export function clearRealResult(): void { entries = new Map(); agesById = {}; recency = new Map(); }

/** The name and hint of a real thing by its id and kind, or null when the id is not from a real setup. */
export function realPlainById(kind: RealPlainKind, id: string): { name: string; hint: string } | null {
  const e = entries.get(id);
  return e === undefined || e.kind !== kind ? null : { name: e.plain.name, hint: e.plain.hint };
}

/** The "Recently changed" rank of a real agent (0 is newest), or null. */
export function realRecencyOf(id: string): number | null {
  return recency.get(id) ?? null;
}

/** How many days ago each file of a real item was last changed, in the order of its places, or null for an item that is not from a real setup. */
export function realCopyDaysOf(item: Pick<HarnessItem, 'id'>): readonly number[] | null {
  return agesById[item.id] ?? null;
}

/** The places of a real item, one for each program that holds it, with the path as the reader wrote it (the home folder written `~`). Null for an item that is not from a real setup. */
export function realPlacesOf(item: HarnessItem): { app: string; path: string }[] | null {
  if (!isRealId(item.id)) return null;
  return PROGRAM_ORDER.flatMap((p: InterfaceId) => { const f = item.foundAt.find(x => x.interface === p); return f === undefined ? [] : [{ app: PROGRAM_NAMES[p], path: f.path }]; });
}

/** How many days ago the newest file of a real item was changed, or null for an item that is not from a real setup (or whose files have no age). */
export function realDaysBackOf(id: string): number | null {
  const days = agesById[id];
  return days === undefined || days.length === 0 ? null : Math.min(...days);
}

/** "Today", "1 day ago", "12 days ago": a count of whole days in words. */
export const daysAgoText = (days: number): string => (days <= 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`);

/** The host a real connection reaches (a web address's host, no path, no login), or null when it starts a program on this computer or the item says nothing. */
export function realHostOf(item: HarnessItem): string | null {
  if (item.kind !== 'tool' || item.toolKind !== 'mcp') return null;
  const { host } = serverFacts(item);
  return host === '' ? null : host;
}

/** Whether the words are within the text budget of the screens. For tests. */
export const withinBudget = (plain: RealPlain): boolean => countWords(plain.name) <= NAME_WORDS && countWords(plain.hint) <= HINT_WORDS;
