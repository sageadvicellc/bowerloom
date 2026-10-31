/**
 * Pure helpers behind the cards of the home app: the words on a card, its one badge, the three shelves of an agent, and the Save bar. No React, no DOM.
 * The sample data names things like files ("velvet-weaver"); a card shows them as words ("Velvet Weaver").
 */
import type { AgentItem, HarnessItem, Slice, ToolItem, WikiPage, World } from '../world/types.js';
import { joinWords } from '../world/words.js';
import { isRealId, realPlainById } from '../real/plain-fallback.js';
import { isSampleNote, plainOf, skillDoes } from './plain.js';
import { itemTitle } from './titles.js';
import { notesLabel } from './notes-label.js';

/** A card's state badge: its words and which look it takes. */
export interface CardBadge { readonly label: string; readonly tone: 'warn' | 'new' | 'info' }

/** One card on a shelf. Skills, tools and notes all take this shape. */
export interface ShelfEntry { readonly id: string; readonly kind: 'skill' | 'tool' | 'note'; readonly name: string; readonly hint?: string; readonly badge?: CardBadge }

/** The three shelves of one agent. */
export interface Shelves { readonly skills: readonly ShelfEntry[]; readonly tools: readonly ShelfEntry[]; readonly notes: readonly ShelfEntry[] }

/** How many cards a shelf shows before "Show more". */
export const SHELF_LIMIT = 8;
const MAX_NAME_WORDS = 5;
const MAX_DOES = 2;

/** The words that these helpers put on a screen. `renderer/home/words.ts` lists them in `WORDS`, so one test holds them all to the rules. */
export const CARD_WORDS = Object.freeze({
  needsKey: 'needs a key', isNew: 'new', saveClean: 'Nothing to save yet', saveDirty: 'You have changes to save', copiesSuffix: 'different copies',
  agentFallbackRole: 'agent', agentEmpty: 'with nothing added yet',
  agentNoSkills: 'Waits for a skill to be added.',
  skillFallback: 'A skill this agent can use.', toolFallback: 'A tool this agent can use.', noteFallback: 'Notes this agent can read.',
  startPoint: 'How it started',
});

export { itemTitle };
/** The title of an agent card. */
export const agentTitle = itemTitle;

/**
 * A name as a person reads it. A name that already has a space or a capital letter is left as it is ("Report builder notes"), at most 5 words; a file-style
 * name ("velvet-weaver") becomes words. A "(imported)" mark that a shared file adds to a name reads "(from file)".
 */
export function readableName(name: string): string {
  const marked = name.trim().replace(/\(imported( \d+)?\)/g, '(from file$1)');
  if (/[\sA-Z]/.test(marked)) return marked.split(/\s+/).slice(0, MAX_NAME_WORDS).join(' ');
  return itemTitle(marked);
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The three kinds an agent card counts, in the order its chips show them. */
export const CHIP_KINDS: readonly ShelfEntry['kind'][] = Object.freeze(['skill', 'tool', 'note'] as const);

/** The words on a count chip: "12 skills", "1 tool", "1 note set", "2 note sets" (the count takes the plural, "note" stays singular). At most five words, built from a number. */
export function chipLabel(kind: ShelfEntry['kind'], n: number): string {
  return kind === 'note' ? count(n, 'note set') : count(n, kind);
}

/** One count chip of an agent card: what it counts and how many. */
export interface Chip { readonly kind: ShelfEntry['kind']; readonly count: number; readonly label: string }

/** The chips of an agent card, from its shelves: a kind with nothing in it is left out. */
export function chipsOf(shelves: Shelves): Chip[] {
  const lists: Readonly<Record<ShelfEntry['kind'], readonly ShelfEntry[]>> = { skill: shelves.skills, tool: shelves.tools, note: shelves.notes };
  return CHIP_KINDS.filter(kind => lists[kind].length > 0).map(kind => ({ kind, count: lists[kind].length, label: chipLabel(kind, lists[kind].length) }));
}

/** The four identity colours of an agent tile. The tile wears one of them as a thin top edge and as the fill of its "what it holds" bar; the colours are tokens (`--hm-ac-*`). */
export const AGENT_ACCENTS = Object.freeze(['blue', 'green', 'orange', 'red'] as const);
export type AgentAccent = (typeof AGENT_ACCENTS)[number];

/** The accent of an agent: the same for the same id on every visit, chosen by a hash of the id (32-bit FNV-1a), so the colour never depends on order or on the other agents. */
export function agentAccent(id: string): AgentAccent {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return AGENT_ACCENTS[hash % AGENT_ACCENTS.length]!;
}

/** One part of the "what it holds" bar: a kind, how many it has, and its share of everything the agent holds (0 to 1). */
export interface HoldSegment { readonly kind: ShelfEntry['kind']; readonly count: number; readonly share: number }

/** The parts of the bar, in the order of the count buttons (skills, tools, notes). A kind with nothing in it has no part, and an agent that holds nothing has none at all (an empty bar). */
export function holdSegments(shelves: Shelves): HoldSegment[] {
  const chips = chipsOf(shelves), total = chips.reduce((sum, c) => sum + c.count, 0);
  return chips.map(c => ({ kind: c.kind, count: c.count, share: c.count / total }));
}

/** The least width of a part of the bar, in hundredths of the bar, so an agent with 1 note among 300 skills still shows its note. */
export const HOLD_MIN = 4;

/**
 * The widths of the parts of the bar, in hundredths of the bar (they add up to 100). A part keeps its true share unless that is under HOLD_MIN, which it is raised to; the other
 * parts give up the difference in proportion. An agent that holds nothing has no parts, so no widths.
 */
export function holdWidths(parts: readonly HoldSegment[]): number[] {
  if (parts.length === 0) return [];
  const small = parts.filter(p => p.share * 100 < HOLD_MIN).length, rest = parts.reduce((sum, p) => sum + (p.share * 100 < HOLD_MIN ? 0 : p.share * 100), 0);
  const room = 100 - small * HOLD_MIN;
  return parts.map(p => (p.share * 100 < HOLD_MIN ? HOLD_MIN : rest === 0 ? room / (parts.length - small || 1) : (p.share * 100 * room) / rest));
}

/** One plain line for an agent card: its role and what it has. */
export function agentHint(agent: AgentItem): string {
  const role = agent.definition.role.trim().toLowerCase() || CARD_WORDS.agentFallbackRole;
  const article = /^[aeiou]/.test(role) ? 'An' : 'A';
  const skills = agent.definition.skillIds.length, tools = agent.definition.toolAttachments.length;
  if (skills === 0 && tools === 0) return `${article} ${role} ${CARD_WORDS.agentEmpty}.`;
  const has = [skills > 0 ? count(skills, 'skill') : null, tools > 0 ? count(tools, 'tool') : null].filter((x): x is string => x !== null);
  return `${article} ${role} with ${has.join(' and ')}.`;
}

/** The one badge a card shows, by priority: different copies, a missing key, a newer version. Null when nothing needs saying. */
export function itemBadge(item: HarnessItem): CardBadge | null {
  const copies = new Set(item.foundAt.map(f => f.contentHash)).size;
  if (copies >= 2) return { label: `${copies} ${CARD_WORDS.copiesSuffix}`, tone: 'warn' };
  if (item.kind === 'tool' && item.toolKind === 'mcp' && item.secret !== null && item.secret.state === 'missing') return { label: CARD_WORDS.needsKey, tone: 'warn' };
  if (item.library !== null && item.library.newerVersion !== undefined) return { label: CARD_WORDS.isNew, tone: 'new' };
  return null;
}

/**
 * The name and the hint of an agent's card. The hint names what the agent can do, built from its skills ("Summarizes meetings and writes replies."),
 * so it stays true when a skill is removed. An agent that has no skill says so. An agent the sample does not know falls back to `agentHint`.
 */
export function agentCard(agent: AgentItem): { name: string; hint: string } {
  const plain = plainOf('agent', agent.id);
  if (plain === null) return { name: agentTitle(agent.name), hint: agentHint(agent) };
  // An agent from the person's own setup says what its own file says, not what its skills do.
  if (isRealId(agent.id)) return { name: plain.name, hint: plain.hint };
  if (agent.definition.skillIds.length === 0) return { name: plain.name, hint: CARD_WORDS.agentNoSkills };
  const does = agent.definition.skillIds.flatMap(id => skillDoes(id) ?? []).slice(0, MAX_DOES);
  if (does.length === 0) return { name: plain.name, hint: plain.hint };
  const text = joinWords(does);
  return { name: plain.name, hint: `${text.charAt(0).toUpperCase()}${text.slice(1)}.` };
}

/** The agents the person owns (not those that come from a library), in name order. */
export function ownedAgents(world: World): AgentItem[] {
  return world.items.filter((i): i is AgentItem => i.kind === 'agent' && i.library === null).sort((a, b) => agentTitle(a.name).localeCompare(agentTitle(b.name)) || a.id.localeCompare(b.id));
}

const FALLBACK_HINT: Readonly<Record<ShelfEntry['kind'], string>> = Object.freeze({ skill: CARD_WORDS.skillFallback, tool: CARD_WORDS.toolFallback, note: CARD_WORDS.noteFallback });

/** The name and the hint of a card: the plain ones when the sample knows the id, else the item's own name and a plain line for its kind. */
export function wordsOf(kind: ShelfEntry['kind'], id: string, name: string): { name: string; hint: string } {
  const plain = plainOf(kind, id);
  return plain === null ? { name: readableName(name), hint: FALLBACK_HINT[kind] } : { name: plain.name, hint: plain.hint };
}

/**
 * The words of a set of notes. The sample's plain words stay only while the set is still the sample's choice. A set the person chose in "Choose notes" is named
 * by what it holds ("Meetings and Travel notes", "169 notes it can read."), and a set that names no topic and no single note gets its own name and the plain line for notes.
 */
export function noteWords(slice: Slice, pages: readonly WikiPage[]): { name: string; hint: string } {
  // A set of notes from the person's own setup: its name, and how many notes it holds, worked out when the setup was read.
  const real = realPlainById('note', slice.id);
  if (real !== null) return real;
  if (isSampleNote(slice)) return wordsOf('note', slice.id, slice.name);
  return notesLabel(slice, pages) ?? { name: readableName(slice.name), hint: FALLBACK_HINT.note };
}

const entryOf = (item: HarnessItem, kind: ShelfEntry['kind']): ShelfEntry => {
  const badge = itemBadge(item);
  return { id: item.id, kind, ...wordsOf(kind, item.id, item.name), ...(badge === null ? {} : { badge }) };
};

/** The skills, tools and notes of one agent. A hook stays out (it lives under Advanced), and an id that no longer exists is left out. */
export function shelvesOf(world: World, agent: AgentItem): Shelves {
  const byId = new Map(world.items.map(i => [i.id, i]));
  const skills: ShelfEntry[] = [], tools: ShelfEntry[] = [], notes: ShelfEntry[] = [];
  for (const id of agent.definition.skillIds) { const item = byId.get(id); if (item !== undefined && item.kind === 'skill') skills.push(entryOf(item, 'skill')); }
  for (const attached of agent.definition.toolAttachments) {
    const item = byId.get(attached.toolId);
    if (item !== undefined && item.kind === 'tool' && (item as ToolItem).toolKind !== 'hook') tools.push(entryOf(item, 'tool'));
  }
  const slice = agent.definition.sliceId === undefined ? undefined : world.slices.find(s => s.id === agent.definition.sliceId);
  if (slice !== undefined) notes.push({ id: slice.id, kind: 'note', ...noteWords(slice, world.wikiPages) });
  return { skills, tools, notes };
}

/** How many cards a shelf draws: all of them when expanded, else the first `limit`. */
export function visibleCount(total: number, expanded: boolean, limit = SHELF_LIMIT): number {
  return expanded ? total : Math.min(total, limit);
}

/** What the Save bar says and whether Save can be pressed. */
export function saveBarModel(dirty: boolean): { text: string; canSave: boolean } {
  return dirty ? { text: CARD_WORDS.saveDirty, canSave: true } : { text: CARD_WORDS.saveClean, canSave: false };
}
