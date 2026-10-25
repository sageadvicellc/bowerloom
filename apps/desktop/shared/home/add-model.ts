/**
 * The logic behind the Add drawer of the 0.8 home app: its five tabs, the cards on each tab, and how adding a card to an agent becomes one store action.
 * Pure: no React, no DOM, no clock. Every change goes through the store's own actions (`attachSkill`, `attachTool`, `assignSlice`, `installItem`), so
 * what the person stages here is the same draft change as anywhere else and "Go back" and "Save" work on it without a special case.
 * The words that these helpers build are listed in `renderer/home/add/add-words.ts`, so one test holds them to the text budget.
 */
import type { AgentItem, HarnessItem, ToolItem, World } from '../proto/types.js';
import { reduceStore } from '../proto/store.js';
import type { StoreAction, StoreState } from '../proto/store.js';
import { globalScope } from '../proto/common.js';
import { editCount } from '../proto/plan.js';
import { agentHint, itemBadge, itemTitle, ownedAgents } from './cards.js';
import type { CardBadge } from './cards.js';

export type AddTab = 'skills' | 'tools' | 'notes' | 'agents' | 'file';

/** The tabs, in the order they show. */
export const ADD_TABS: readonly AddTab[] = Object.freeze(['skills', 'tools', 'notes', 'agents', 'file'] as const);

/** The tab that is open first. */
export const DEFAULT_TAB: AddTab = 'skills';

/** The tab a key stands for, else the first tab. */
export const tabOfKey = (key: string): AddTab => ADD_TABS.find(t => t === key) ?? DEFAULT_TAB;

/** The tab a key press moves to: arrows step (and wrap), Home and End jump. Null for any other key. */
export function nextTab(tab: AddTab, key: string): AddTab | null {
  const at = ADD_TABS.indexOf(tab);
  if (key === 'ArrowRight' || key === 'ArrowDown') return ADD_TABS[(at + 1) % ADD_TABS.length] ?? null;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return ADD_TABS[(at + ADD_TABS.length - 1) % ADD_TABS.length] ?? null;
  if (key === 'Home') return ADD_TABS[0] ?? null;
  if (key === 'End') return ADD_TABS[ADD_TABS.length - 1] ?? null;
  return null;
}

/** The fixed one-line hints of tools and note sets, which have no description of their own. At most 12 words each. */
export const ADD_MODEL_WORDS = Object.freeze({
  toolConnection: 'Connects an agent to an outside service.',
  toolPrompt: 'A saved prompt an agent can run.',
  noteSet: 'A set of notes an agent can read.',
  skillFallback: 'A skill an agent can use.',
  readyMade: 'Ready-made',
});

const MAX_NAME_WORDS = 5;
const MAX_HINT_WORDS = 12;

/**
 * A name as a person reads it. A name that already has a space or a capital letter is left as it is ("Summarize a meeting"); a file-style name
 * ("velvet-weaver") becomes words. A "(imported)" mark that a shared file adds to a name reads "(from file)". At most 5 words.
 */
export function plainName(name: string): string {
  const marked = name.trim().replace(/\(imported( \d+)?\)/g, '(from file$1)');
  if (/[\sA-Z]/.test(marked)) return marked.split(/\s+/).slice(0, MAX_NAME_WORDS).join(' ');
  return itemTitle(marked);
}

/** How a name is turned into words on a card. A screen can swap this for a layer that maps made-up names to plain ones. */
export type NameOf = (name: string) => string;

const wordList = (text: string): string[] => text.split(/\s+/).filter(w => w !== '');

/** A line of at most `limit` words: the first sentence when that fits, else the first words with an ellipsis. */
export function clampWords(text: string, limit = MAX_HINT_WORDS): string {
  const flat = wordList(text).join(' ');
  if (wordList(flat).length <= limit) return flat;
  const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
  if (wordList(sentence).length <= limit) return sentence;
  return `${wordList(flat).slice(0, limit - 1).join(' ').replace(/[,;:.\s]+$/, '')}…`;
}

export type AddKind = 'skill' | 'tool' | 'note' | 'agent';

/** One card of the drawer. `id` is the id the store's actions use (a note set's id is its slice id). `ready` is true for something that comes from a library. */
export interface AddEntry { readonly id: string; readonly kind: AddKind; readonly name: string; readonly hint: string; readonly ready: boolean; readonly badge?: CardBadge }

const byName = (a: AddEntry, b: AddEntry): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
const withBadge = (item: HarnessItem): { badge?: CardBadge } => { const badge = itemBadge(item); return badge === null ? {} : { badge }; };

function skillEntry(item: Extract<HarnessItem, { kind: 'skill' }>, nameOf: NameOf): AddEntry {
  return { id: item.id, kind: 'skill', name: nameOf(item.name), hint: clampWords(item.description.trim() === '' ? ADD_MODEL_WORDS.skillFallback : item.description), ready: item.library !== null, ...withBadge(item) };
}
function toolEntry(item: ToolItem, nameOf: NameOf): AddEntry {
  return { id: item.id, kind: 'tool', name: nameOf(item.name), hint: item.toolKind === 'mcp' ? ADD_MODEL_WORDS.toolConnection : ADD_MODEL_WORDS.toolPrompt, ready: item.library !== null, ...withBadge(item) };
}

/** The cards of one tab, in name order. The shared-file tab has none. Hooks never show (they live under Advanced). */
export function entriesFor(world: World, tab: AddTab, nameOf: NameOf = plainName): AddEntry[] {
  switch (tab) {
    case 'skills': return world.items.flatMap(i => (i.kind === 'skill' ? [skillEntry(i, nameOf)] : [])).sort(byName);
    case 'tools': return world.items.flatMap(i => (i.kind === 'tool' && i.toolKind !== 'hook' ? [toolEntry(i, nameOf)] : [])).sort(byName);
    case 'notes': return world.slices.map((s): AddEntry => ({ id: s.id, kind: 'note', name: nameOf(s.name), hint: ADD_MODEL_WORDS.noteSet, ready: false })).sort(byName);
    case 'agents': return world.items.flatMap(i => (i.kind === 'agent' && i.library !== null ? [{ id: i.id, kind: 'agent', name: nameOf(i.name), hint: clampWords(agentHint(i)), ready: true, ...withBadge(i) } satisfies AddEntry] : [])).sort(byName);
    case 'file': return [];
  }
}

const agentOf = (world: World, id: string): AgentItem | undefined => {
  const item = world.items.find(i => i.id === id);
  return item !== undefined && item.kind === 'agent' && item.library === null ? item : undefined;
};

/** True when the agent already has this skill, tool or note set. */
export function agentHas(world: World, agentId: string, entry: AddEntry): boolean {
  const agent = agentOf(world, agentId);
  if (agent === undefined) return false;
  switch (entry.kind) {
    case 'skill': return agent.definition.skillIds.includes(entry.id);
    case 'tool': return agent.definition.toolAttachments.some(t => t.toolId === entry.id);
    case 'note': return agent.definition.sliceId === entry.id;
    case 'agent': return false;
  }
}

/** One agent in the picker: who it is and whether it already has the thing. */
export interface AgentChoice { readonly id: string; readonly name: string; readonly has: boolean }

/** The agents a card can be added to: the ones the person owns, in name order. A ready-made agent is never a target. */
export function agentChoices(world: World, entry: AddEntry, nameOf: NameOf = plainName): AgentChoice[] {
  return ownedAgents(world).map(a => ({ id: a.id, name: nameOf(a.name), has: agentHas(world, a.id, entry) })).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** The store action that adds a skill, tool or note set to an agent. A tool joins with the access "can only read". Null for a ready-made agent. */
export function addAction(agentId: string, entry: AddEntry): StoreAction | null {
  switch (entry.kind) {
    case 'skill': return { type: 'attachSkill', agentId, skillId: entry.id };
    case 'tool': return { type: 'attachTool', agentId, toolId: entry.id, access: 'read-only' };
    case 'note': return { type: 'assignSlice', agentId, sliceId: entry.id };
    case 'agent': return null;
  }
}

/** The store action that copies a ready-made agent into the person's own agents. Null for any other card, or when there is nowhere to put it. */
export function installAction(world: World, entry: AddEntry): StoreAction | null {
  const home = globalScope(world);
  return entry.kind === 'agent' && home !== undefined ? { type: 'installItem', itemId: entry.id, targetScopeId: home.id } : null;
}

/** What a stage did: it changed the draft, the draft already had it, or the store refused (an unknown agent, a ready-made agent as the target). */
export type StageStatus = 'added' | 'already' | 'refused';
export interface StageResult { readonly state: StoreState; readonly status: StageStatus }

/** Adds a skill, tool or note set to one agent through the store. The state comes back unchanged for `already` and `refused`. */
export function stageAdd(state: StoreState, agentId: string, entry: AddEntry): StageResult {
  const action = addAction(agentId, entry);
  if (action === null || agentOf(state.draft, agentId) === undefined) return { state, status: 'refused' };
  if (agentHas(state.draft, agentId, entry)) return { state, status: 'already' };
  const next = reduceStore(state, action);
  return { state: next, status: next === state ? 'refused' : 'added' };
}

/** Copies a ready-made agent into the person's own agents through the store. */
export function stageInstall(state: StoreState, entry: AddEntry): StageResult {
  const action = installAction(state.draft, entry);
  if (action === null) return { state, status: 'refused' };
  const next = reduceStore(state, action);
  return { state: next, status: next === state ? 'refused' : 'added' };
}

/** The id of the agent that `installItem` made: the one id in `after` that `before` did not have. Null when nothing was made. */
export function newAgentId(before: World, after: World): string | null {
  const known = new Set(before.items.map(i => i.id));
  return after.items.find(i => i.kind === 'agent' && !known.has(i.id))?.id ?? null;
}

/** How many things are staged: items and choices that differ between what was saved and the draft. One edit is one change. */
export const changeCount = (state: StoreState): number => editCount(state.committed, state.draft);
