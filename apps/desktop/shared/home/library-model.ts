/**
 * The model behind the Library page of the 0.8 home app: everything the person owns of one kind (skills, agents, tools, notes), including what no agent uses,
 * as rows that can be searched and sorted, and the read-only details of any one of them: what it does, who uses it, where it works, where it came from
 * (source, author, release, date added), what a tool can reach and do, and the full text. Pure: no React, no DOM, no clock, no random number.
 * The words that these helpers build are listed in `renderer/home/library/library-words.ts`, so one test holds them to the text budget.
 */
import type { AgentItem, HarnessItem, Slice, ToolItem, World } from '../proto/types.js';
import { CASE_IDS } from '../proto/sample.js';
import { distinctTexts } from '../proto/conflicts.js';
import { agentChoices, clampWords } from './add-model.js';
import type { AddEntry, AgentChoice } from './add-model.js';
import { CARD_WORDS, agentCard, noteWords, ownedAgents, readableName } from './cards.js';
import type { CardBadge } from './cards.js';
import { detailsOf, programsOf } from './details.js';
import type { AgentRef } from './details.js';
import { plainNameOf } from './plain-names.js';
import { ACCESS_WORDS, SOURCE_WORDS, skillTextOf } from './plain-details.js';
import { plainOf } from './plain.js';
import { READY_MADE_AUTHOR, TOOL_FACTS, UPDATES, UPDATE_ITEM_DAYS_BACK, UPDATE_ITEM_ID, dayText, sampleAuthor, sampleDaysBack, sampleRelease } from './library-sample.js';
import { bodyOf, fieldsOf, makeText } from './library-text.js';

export type LibraryKind = 'skill' | 'agent' | 'tool' | 'note';
/** The tabs, in the order they show. */
export const LIBRARY_KINDS: readonly LibraryKind[] = Object.freeze(['skill', 'agent', 'tool', 'note'] as const);
export type LibrarySort = 'name' | 'added';

/** The words these helpers put on a screen. `renderer/home/library/library-words.ts` lists them, so one test holds them all to the rules. */
export const LIBRARY_MODEL_WORDS = Object.freeze({
  needsKey: CARD_WORDS.needsKey, runsCode: 'Runs code', updateAvailable: 'Update available', notUsed: 'Not used yet', readyMade: 'Ready-made', copiesSuffix: CARD_WORDS.copiesSuffix,
  madeByYou: SOURCE_WORDS.you, addedJustNow: 'Added just now', notStated: 'Not stated',
  reachNothing: 'Nothing outside. It only sends a saved prompt.', reachComputer: 'This computer only', reachUnknown: 'It does not say what it reaches.',
  noAgents: 'No agent uses it yet.', noText: 'There is no text to show.', fallbackAgent: 'An agent you can use.',
});

/** One thing in the library: an item, or (for notes) one saved choice of pages. */
export type Entry =
  | { readonly kind: 'skill' | 'agent' | 'tool'; readonly id: string; readonly item: HarnessItem; readonly pos: number }
  | { readonly kind: 'note'; readonly id: string; readonly slice: Slice; readonly pos: number };

/** The things of one kind, in the order the world keeps them. */
export function entriesOf(world: World, kind: LibraryKind): Entry[] {
  if (kind === 'note') return world.slices.map((slice, pos): Entry => ({ kind: 'note', id: slice.id, slice, pos }));
  const out: Entry[] = [];
  world.items.forEach((item, pos) => { if (item.kind === kind) out.push({ kind, id: item.id, item, pos }); });
  return out;
}

/** The one thing with this id and kind, or undefined. */
export const entryOf = (world: World, kind: LibraryKind, id: string): Entry | undefined => entriesOf(world, kind).find(e => e.id === id);

/** How many things of each kind the person has. */
export function libraryCounts(world: World): Readonly<Record<LibraryKind, number>> {
  return { skill: entriesOf(world, 'skill').length, agent: entriesOf(world, 'agent').length, tool: entriesOf(world, 'tool').length, note: world.slices.length };
}

// ---------------------------------------------------------------------------------------------------- words of one thing

const firstText = (item: HarnessItem): string => item.foundAt[0]?.text ?? '';

/** The name and the hint of a thing as a person reads them. The sample's plain layer first, then what the item's own text says, then a plain fallback. */
export function lookOf(world: World, entry: Entry): { name: string; hint: string } {
  if (entry.kind === 'note') return noteWords(entry.slice, world.wikiPages);
  const item = entry.item, plain = plainOf(entry.kind, item.id), described = fieldsOf(firstText(item)).description;
  if (item.kind === 'agent') {
    const own = plain === null ? null : agentCard(item as AgentItem);
    return own ?? { name: readableName(item.name), hint: clampWords(described ?? agentCard(item as AgentItem).hint) };
  }
  if (item.kind === 'skill') {
    const own = item.description.trim() === '' ? described : item.description;
    return plain === null ? { name: readableName(item.name), hint: clampWords(own ?? CARD_WORDS.skillFallback) } : plain;
  }
  if (item.kind === 'tool') {
    const facts = TOOL_FACTS[item.id];
    if (plain !== null) return plain;
    return { name: facts?.name ?? readableName(item.name), hint: clampWords(facts?.hint ?? described ?? CARD_WORDS.toolFallback) };
  }
  return { name: readableName(item.name), hint: CARD_WORDS.skillFallback };
}

/** Every version of an item's text a person could have read, as lines: the plain lines the screen shows, and the body of each copy that was found. */
export function allLinesOf(entry: Entry): string[][] {
  if (entry.kind === 'note') return [];
  return [textLinesOf(entry), ...entry.item.foundAt.map(f => bodyOf(f.text))];
}

/** The lines of the full text: the sample's plain lines, else the item's own text without its header. */
export function textLinesOf(entry: Entry): string[] {
  if (entry.kind === 'note') return [];
  const item = entry.item;
  if (item.kind === 'skill') { const known = skillTextOf(item.id); return known !== null && known.lines.length > 0 ? [...known.lines] : bodyOf(firstText(item)); }
  if (item.kind === 'tool') { const facts = TOOL_FACTS[item.id]; return facts !== undefined ? [...facts.lines] : bodyOf(firstText(item)); }
  if (item.kind === 'agent') { const own = item.definition.instructions.trim(); return own === '' ? bodyOf(firstText(item)) : [own]; }
  return [];
}

// ---------------------------------------------------------------------------------------------------- who uses it

const agentRef = (agent: AgentItem): AgentRef => ({ id: agent.id, name: agentCard(agent).name });

/** True when the agent holds the thing. */
function holds(agent: AgentItem, kind: LibraryKind, id: string): boolean {
  const d = agent.definition;
  return kind === 'skill' ? d.skillIds.includes(id) : kind === 'tool' ? d.toolAttachments.some(t => t.toolId === id) : kind === 'note' ? d.sliceId === id : false;
}

/** The agents of the person that hold a skill, a tool or a set of notes. An agent has no users. */
export function usedByOf(world: World, kind: LibraryKind, id: string): AgentRef[] {
  return ownedAgents(world).filter(a => holds(a, kind, id)).map(agentRef);
}

// ---------------------------------------------------------------------------------------------------- where it came from

/** Where a thing came from, in words. `outside` is true for anything the person did not make: only those can be copied. */
export interface Origin { readonly source: string; readonly author: string; readonly release: string | null; readonly added: string; readonly outside: boolean }

const JUST_NOW = /^web-|-mine(?:-\d+)?$|-copy(?:-\d+)?$|^slice-\d+$/;

/** How many days back from the 24th of October a thing was added, or -1 when it was added in this preview (it is newer than any sample date). */
export function daysBackOf(id: string): number {
  if (id === UPDATE_ITEM_ID) return UPDATE_ITEM_DAYS_BACK;
  return JUST_NOW.test(id) ? -1 : sampleDaysBack(id);
}

/** The source, author, release tag and date added of an item. A note set is always the person's own. */
export function originOf(world: World, entry: Entry): Origin {
  const days = daysBackOf(entry.id), added = days < 0 ? LIBRARY_MODEL_WORDS.addedJustNow : dayText(days);
  if (entry.kind === 'note') return { source: LIBRARY_MODEL_WORDS.madeByYou, author: LIBRARY_MODEL_WORDS.madeByYou, release: null, added, outside: false };
  const item = entry.item, fields = fieldsOf(firstText(item));
  if (item.library !== null) {
    const source = world.libraries.find(l => l.id === item.library!.library)?.name ?? item.library.library;
    const author = fields.author ?? (item.library.library === CASE_IDS.newerLibrary ? READY_MADE_AUTHOR : LIBRARY_MODEL_WORDS.notStated);
    return { source, author, release: item.library.pinnedVersion, added, outside: true };
  }
  const known = item.kind === 'skill' ? skillTextOf(item.id) : null;
  if (known !== null && known.source !== SOURCE_WORDS.you) {
    const which = known.source === SOURCE_WORDS.open ? 'open' : 'community';
    return { source: known.source, author: sampleAuthor(item.id, which), release: sampleRelease(item.id), added, outside: true };
  }
  return { source: LIBRARY_MODEL_WORDS.madeByYou, author: LIBRARY_MODEL_WORDS.madeByYou, release: null, added, outside: false };
}

// ---------------------------------------------------------------------------------------------------- status and rows

/** The one status a row shows, by priority: different copies, a missing key, code that runs, an update, nobody uses it, ready-made. Null when nothing needs saying. */
export function statusOf(entry: Entry, usedBy: number): CardBadge | null {
  if (entry.kind === 'note') return usedBy === 0 ? { label: LIBRARY_MODEL_WORDS.notUsed, tone: 'info' } : null;
  const item = entry.item, texts = distinctTexts(item);
  if (texts >= 2) return { label: `${texts} ${LIBRARY_MODEL_WORDS.copiesSuffix}`, tone: 'warn' };
  if (item.kind === 'tool' && item.toolKind === 'mcp' && item.secret !== null && item.secret.state === 'missing') return { label: LIBRARY_MODEL_WORDS.needsKey, tone: 'warn' };
  if (item.kind === 'tool' && item.toolKind === 'hook') return { label: LIBRARY_MODEL_WORDS.runsCode, tone: 'warn' };
  if (item.library !== null && item.library.newerVersion !== undefined) return { label: LIBRARY_MODEL_WORDS.updateAvailable, tone: 'new' };
  if (item.kind === 'agent') return item.library !== null ? { label: LIBRARY_MODEL_WORDS.readyMade, tone: 'info' } : null;
  return usedBy === 0 ? { label: LIBRARY_MODEL_WORDS.notUsed, tone: 'info' } : null;
}

/** One row of the list. `days` and `pos` order "Recently added": a smaller `days` is newer, and a later `pos` breaks a tie. */
export interface LibraryRow {
  readonly id: string; readonly kind: LibraryKind; readonly name: string; readonly hint: string; readonly status: CardBadge | null;
  /** How many agents use it. Always 0 for an agent. */
  readonly usedBy: number;
  /** What an agent has ("3 skills and 1 tool"), or null when the row is not an agent or the agent has nothing. */
  readonly has: string | null;
  readonly days: number; readonly pos: number;
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** "3 skills and 1 tool", or null for an agent that has neither. */
export function hasLine(skills: number, tools: number): string | null {
  const parts = [skills > 0 ? count(skills, 'skill') : null, tools > 0 ? count(tools, 'tool') : null].filter((x): x is string => x !== null);
  return parts.length === 0 ? null : parts.join(' and ');
}

/** "Used by 3 agents" or "Used by 1 agent". */
export const usedByLine = (n: number): string => `Used by ${count(n, 'agent')}`;

/** Every row of one kind, in the order the world keeps them. */
export function libraryRows(world: World, kind: LibraryKind): LibraryRow[] {
  return entriesOf(world, kind).map((entry): LibraryRow => {
    const look = lookOf(world, entry);
    const usedBy = entry.kind === 'agent' ? 0 : usedByOf(world, entry.kind, entry.id).length;
    const has = entry.kind === 'agent' ? hasLine((entry.item as AgentItem).definition.skillIds.length, (entry.item as AgentItem).definition.toolAttachments.length) : null;
    return { id: entry.id, kind, name: look.name, hint: look.hint, status: statusOf(entry, usedBy), usedBy, has, days: daysBackOf(entry.id), pos: entry.pos };
  });
}

/** True when a row matches a search: every word typed is somewhere in its name or hint, whatever the letter case. An empty search matches every row. */
export function matchesSearch(row: Pick<LibraryRow, 'name' | 'hint'>, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '');
  if (words.length === 0) return true;
  const hay = `${row.name} ${row.hint}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

/** The rows in one order: by name, or newest first. */
export function sortRows(rows: readonly LibraryRow[], sort: LibrarySort): LibraryRow[] {
  const byName = (a: LibraryRow, b: LibraryRow): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const byAdded = (a: LibraryRow, b: LibraryRow): number => a.days - b.days || b.pos - a.pos || byName(a, b);
  return [...rows].sort(sort === 'name' ? byName : byAdded);
}

/** What the list shows: the rows of a kind that match the search, in the chosen order, and how many there are before and after the search. */
export function listLibrary(world: World, kind: LibraryKind, query: string, sort: LibrarySort): { rows: LibraryRow[]; total: number } {
  const all = libraryRows(world, kind);
  return { rows: sortRows(all.filter(r => matchesSearch(r, query)), sort), total: all.length };
}

// ---------------------------------------------------------------------------------------------------- the update that waits

/** An update that a library item can take: the lines now and after, and what the store needs to put it in place. */
export interface UpdateInfo { readonly from: string; readonly to: string; readonly oldLines: readonly string[]; readonly newLines: readonly string[]; readonly text: string; readonly description: string }

/** The update waiting for an item, or null when none is waiting or the preview has no text for it. */
export function updateOf(world: World, entry: Entry): UpdateInfo | null {
  if (entry.kind === 'note') return null;
  const ref = entry.item.library, waiting = UPDATES[entry.id];
  if (ref === null || ref.newerVersion === undefined || waiting === undefined || waiting.release !== ref.newerVersion) return null;
  return { from: ref.pinnedVersion, to: ref.newerVersion, oldLines: textLinesOf(entry), newLines: waiting.lines, text: makeText({ description: waiting.hint, author: waiting.author, release: waiting.release }, waiting.lines), description: waiting.hint };
}

// ---------------------------------------------------------------------------------------------------- details

/** The read-only details of one thing. */
export interface LibraryDetails {
  readonly kind: LibraryKind; readonly id: string; readonly name: string; readonly hint: string;
  readonly usedBy: readonly AgentRef[]; readonly works: readonly string[]; readonly origin: Origin;
  /** What a tool reaches and how far it can go; null for anything else. */
  readonly reach: string | null; readonly ability: string | null;
  readonly runsCode: boolean; readonly needsKey: boolean; readonly keyReady: boolean;
  /** The count of different copies, or 0. */
  readonly copies: number;
  readonly update: UpdateInfo | null;
  readonly text: readonly string[];
  /** For an agent: the names of what it has. */
  readonly has: { readonly skills: readonly string[]; readonly tools: readonly string[]; readonly notes: readonly string[] } | null;
  /** For a set of notes: how many notes, what it covers and the first titles. */
  readonly notes: { readonly countLine: string; readonly topics: string; readonly titles: readonly string[] } | null;
  /** True when the thing can be put on an agent: a skill, a tool that is not a hook, or a set of notes. */
  readonly canAdd: boolean;
  /** True when the person can make an own copy: it came from outside. */
  readonly canCopy: boolean;
}

function reachOf(item: ToolItem): { reach: string; ability: string } {
  const facts = TOOL_FACTS[item.id], fields = fieldsOf(firstText(item));
  const access = facts?.access ?? fields.access ?? 'read-only';
  const host = facts?.reach ?? fields.reach;
  const reach = item.toolKind === 'prompt' ? LIBRARY_MODEL_WORDS.reachNothing
    : item.toolKind === 'hook' ? LIBRARY_MODEL_WORDS.reachComputer
      : host === undefined ? LIBRARY_MODEL_WORDS.reachUnknown : `Reaches ${host}`;
  return { reach, ability: ACCESS_WORDS[access] };
}

/** The details of one thing, or null when it is not in the world. */
export function libraryDetails(world: World, kind: LibraryKind, id: string): LibraryDetails | null {
  const entry = entryOf(world, kind, id);
  if (entry === undefined) return null;
  const look = lookOf(world, entry), origin = originOf(world, entry);
  const base = { kind, id, name: look.name, hint: look.hint, usedBy: entry.kind === 'agent' ? [] : usedByOf(world, entry.kind, entry.id), origin, text: textLinesOf(entry), update: updateOf(world, entry) };
  if (entry.kind === 'note') {
    const note = detailsOf(world, ownedAgents(world), { kind: 'note', id });
    return { ...base, works: [], reach: null, ability: null, runsCode: false, needsKey: false, keyReady: false, copies: 0, has: null, canAdd: true, canCopy: false,
      notes: note !== null && note.kind === 'note' ? { countLine: note.countLine, topics: note.topics, titles: note.titles } : null };
  }
  const item = entry.item, texts = distinctTexts(item), copies = texts >= 2 ? texts : 0, works = programsOf(item.foundAt);
  if (item.kind === 'tool') {
    const { reach, ability } = reachOf(item), secret = item.toolKind === 'mcp' ? item.secret : null;
    return { ...base, works, reach, ability, runsCode: item.toolKind === 'hook', needsKey: secret !== null && secret.state === 'missing', keyReady: secret !== null && secret.state === 'present', copies, has: null, notes: null,
      canAdd: item.toolKind !== 'hook', canCopy: origin.outside };
  }
  const has = item.kind === 'agent' ? namesOfAgent(world, item) : null;
  return { ...base, works, reach: null, ability: null, runsCode: false, needsKey: false, keyReady: false, copies, has, notes: null, canAdd: item.kind === 'skill', canCopy: origin.outside };
}

/** The names of what an agent has: its skills, its tools and its notes. */
function namesOfAgent(world: World, agent: AgentItem): { skills: string[]; tools: string[]; notes: string[] } {
  const named = (kind: 'skill' | 'tool', id: string): string | null => { const e = entryOf(world, kind, id); return e === undefined ? null : lookOf(world, e).name; };
  const slice = agent.definition.sliceId === undefined ? undefined : entryOf(world, 'note', agent.definition.sliceId);
  return {
    skills: agent.definition.skillIds.map(id => named('skill', id)).filter((x): x is string => x !== null),
    tools: agent.definition.toolAttachments.map(t => named('tool', t.toolId)).filter((x): x is string => x !== null),
    notes: slice === undefined ? [] : [lookOf(world, slice).name],
  };
}

// ---------------------------------------------------------------------------------------------------- actions on one thing

/** The agents a thing can be put on, with a flag for those that already have it. Empty for a kind that cannot be put on an agent. */
export function agentsFor(world: World, kind: LibraryKind, id: string): AgentChoice[] {
  if (kind === 'agent') return [];
  const entry = entryOf(world, kind, id);
  if (entry === undefined) return [];
  const look = lookOf(world, entry);
  const asEntry: AddEntry = { id, kind, name: look.name, hint: look.hint, ready: false };
  return agentChoices(world, asEntry, plainNameOf(world));
}

/** "This takes it off 3 agents.", "This takes it off 1 agent.", or "No agent uses it yet." */
export function takesOffLine(n: number): string {
  return n === 0 ? LIBRARY_MODEL_WORDS.noAgents : `This takes it off ${count(n, 'agent')}.`;
}

/** What removing a thing from the library does: the agents it comes off. */
export function removePlan(world: World, kind: LibraryKind, id: string): { name: string; agents: readonly AgentRef[]; line: string } | null {
  const entry = entryOf(world, kind, id);
  if (entry === undefined) return null;
  const agents = entry.kind === 'agent' ? [] : usedByOf(world, entry.kind, entry.id);
  return { name: lookOf(world, entry).name, agents, line: takesOffLine(agents.length) };
}

/** The name of an own copy: "Summarize a meeting (mine)". A name of five words or more loses its last words so the mark still fits in five. */
export function mineName(display: string): string {
  const words = display.trim().split(/\s+/).filter(w => w !== '');
  return `${words.slice(0, 4).join(' ')} (mine)`;
}

/** The name, description and text of the own copy of an item that came from outside. The copy keeps no author and no release: it is the person's own. */
export function copyDraft(world: World, kind: LibraryKind, id: string): { name: string; description: string; text: string } | null {
  const entry = entryOf(world, kind, id);
  if (entry === undefined || entry.kind === 'note') return null;
  const look = lookOf(world, entry), item = entry.item, lines = textLinesOf(entry);
  const tool = item.kind === 'tool' ? reachOf(item) : null, facts = item.kind === 'tool' ? TOOL_FACTS[item.id] : undefined, fields = fieldsOf(firstText(item));
  const access = facts?.access ?? fields.access;
  const host = facts?.reach ?? fields.reach;
  const text = makeText({ description: look.hint, ...(tool === null || host === undefined ? {} : { reach: host }), ...(tool === null || access === undefined ? {} : { access }) }, lines.length === 0 ? [look.hint] : lines);
  return { name: mineName(look.name), description: look.hint, text };
}
