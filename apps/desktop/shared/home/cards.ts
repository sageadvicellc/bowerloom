/**
 * Pure helpers behind the cards of the home app: the words on a card, its one badge, the three shelves of an agent, and the Save bar. No React, no DOM.
 * The sample data names things like files ("velvet-weaver"); a card shows them as words ("Velvet Weaver").
 */
import type { AgentItem, HarnessItem, Slice, ToolItem, World } from '../proto/types.js';
import { joinWords } from '../proto/words.js';
import { isSampleNote, plainOf, skillDoes } from './plain.js';

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

/** A name as words: dashes and underscores become spaces, each word gets a capital, and at most 5 words stay. */
export function itemTitle(name: string): string {
  return name.split(/[\s_-]+/).filter(w => w !== '').slice(0, MAX_NAME_WORDS).map(w => `${w.charAt(0).toUpperCase()}${w.slice(1)}`).join(' ');
}
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
function wordsOf(kind: ShelfEntry['kind'], id: string, name: string): { name: string; hint: string } {
  const plain = plainOf(kind, id);
  return plain === null ? { name: readableName(name), hint: FALLBACK_HINT[kind] } : { name: plain.name, hint: plain.hint };
}

/** The words of a set of notes. The sample's plain words stay only while the set is still the sample's choice; an edited set gets its own name and the plain line for notes. */
const noteWords = (slice: Slice): { name: string; hint: string } =>
  (isSampleNote(slice) ? wordsOf('note', slice.id, slice.name) : { name: readableName(slice.name), hint: FALLBACK_HINT.note });

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
  if (slice !== undefined) notes.push({ id: slice.id, kind: 'note', ...noteWords(slice) });
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
