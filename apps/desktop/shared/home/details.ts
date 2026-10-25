/**
 * The model behind the details panel of the home app: what the panel says about whatever is selected, as plain data. Pure: no React, no DOM, no clock.
 * One thing is selected at a time: an agent, or a skill, a tool or a set of notes (which is then opened from an agent, its owner). The panel reads and
 * shows; nothing here changes the world. The words come from the plain layers (plain.ts, plain-details.ts, notes-label.ts).
 */
import type { AgentItem, FoundAt, HarnessItem, SkillItem, ToolItem, World } from '../proto/types.js';
import { memoMatch } from '../proto/slice-preview.js';
import { agentCard, itemBadge, noteWords, shelvesOf, wordsOf } from './cards.js';
import type { CardBadge, Shelves } from './cards.js';
import { buildTopics, plainTitles } from './notes-topics.js';
import { notesLabel } from './notes-label.js';
import { ACCESS_WORDS, PROGRAM_NAMES, PROGRAM_ORDER, SOURCE_WORDS, skillTextOf } from './plain-details.js';
import type { SkillText } from './plain-details.js';

/** What is selected. `ownerAgentId` is the agent whose card or list the item was opened from (an agent has none). */
export interface Selected { readonly kind: 'agent' | 'skill' | 'tool' | 'note'; readonly id: string; readonly ownerAgentId?: string }

export const sameSelected = (a: Selected | null, b: Selected | null): boolean => a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id && a.ownerAgentId === b.ownerAgentId);

/** The agent a selection belongs to: the agent itself, or the one that owns the item. Null when nothing is selected. */
export const agentOfSelected = (selected: Selected | null): string | null => (selected === null ? null : selected.kind === 'agent' ? selected.id : selected.ownerAgentId ?? null);

/** The words the details panel adds to the ones of the cards. `renderer/home/words.ts` lists them in `WORDS`, so one test holds them all to the rules. */
export const DETAIL_WORDS = Object.freeze({
  noText: 'There is no text to show.', keyReady: 'Its key is ready.', needsKeyLine: 'Add this key when asked.', noNotes: 'No notes yet.', noUsers: 'No agent uses it yet.', noPrograms: 'Not in any program yet.',
  kindSkill: 'Skill', kindTool: 'Tool', kindNotes: 'Notes',
});

export interface AgentRef { readonly id: string; readonly name: string }

interface Base { readonly id: string; readonly name: string; readonly hint: string; readonly owner: AgentRef | null }
export interface AgentDetails extends Omit<Base, 'owner'> { readonly kind: 'agent'; readonly works: readonly string[]; readonly shelves: Shelves }
export interface SkillDetails extends Base { readonly kind: 'skill'; readonly usedBy: readonly AgentRef[]; readonly works: readonly string[]; readonly source: string; readonly badge: CardBadge | null; readonly text: readonly string[] }
export interface ToolDetails extends Base {
  readonly kind: 'tool'; readonly usedBy: readonly AgentRef[]; readonly access: string; readonly badge: CardBadge | null;
  /** True when the tool needs a key that is not set. */
  readonly needsKey: boolean;
  /** True when the tool has a key and it is set. A key's value is never shown, and never held here. */
  readonly keyReady: boolean;
  readonly runsCode: boolean;
}
export interface NoteDetails extends Base {
  readonly kind: 'note'; readonly usedBy: readonly AgentRef[]; readonly topics: string; readonly count: number; readonly countLine: string; readonly titles: readonly string[];
}
export type Details = AgentDetails | SkillDetails | ToolDetails | NoteDetails;

/** How many note titles the panel lists. */
export const NOTE_TITLES = 5;

/** The names of the programs an item is found in, in the order the panel shows them. */
export function programsOf(foundAt: readonly FoundAt[]): string[] {
  const seen = new Set(foundAt.map(f => f.interface));
  return PROGRAM_ORDER.filter(id => seen.has(id)).map(id => PROGRAM_NAMES[id]);
}

/** True when an agent holds the skill, the tool or the set of notes. */
function holds(agent: AgentItem, kind: Selected['kind'], id: string): boolean {
  const d = agent.definition;
  return kind === 'skill' ? d.skillIds.includes(id) : kind === 'tool' ? d.toolAttachments.some(t => t.toolId === id) : kind === 'note' ? d.sliceId === id : false;
}

const refOf = (agent: AgentItem): AgentRef => ({ id: agent.id, name: agentCard(agent).name });

/** The body of a text file without its front matter, as lines with the blank ones left out. */
export function bodyLines(text: string): string[] {
  const body = text.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return body.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
}

function skillText(item: SkillItem, world: World): SkillText {
  const known = skillTextOf(item.id);
  const source = known?.source ?? (item.library === null ? SOURCE_WORDS.you : world.libraries.find(l => l.id === item.library!.library)?.name ?? item.library.library);
  // A sample skill has plain text written for it. A skill the person added brings its own text, and that is shown as it is.
  return { source, lines: known?.lines ?? bodyLines(item.foundAt[0]?.text ?? '') };
}

/** The most that any agent may do with a tool: it can change things if one agent may, else it can only read. */
function accessOf(tool: ToolItem, owner: AgentItem | undefined, agents: readonly AgentItem[]): string {
  const attached = (agent: AgentItem) => agent.definition.toolAttachments.find(a => a.toolId === tool.id);
  const own = owner === undefined ? undefined : attached(owner);
  if (own !== undefined) return ACCESS_WORDS[own.access];
  const any = agents.map(attached).filter(a => a !== undefined);
  return ACCESS_WORDS[any.some(a => a.access === 'read-write') ? 'read-write' : 'read-only'];
}

/**
 * What the panel says about one selection, or null when it has nothing to say (nothing is selected, or the thing is gone from the world).
 * `agents` are the agents on the map, in the order shown; "Used by" lists those that hold the item.
 */
export function detailsOf(world: World, agents: readonly AgentItem[], selected: Selected | null): Details | null {
  if (selected === null) return null;
  const byId = (id: string): HarnessItem | undefined => world.items.find(i => i.id === id);
  if (selected.kind === 'agent') {
    const agent = agents.find(a => a.id === selected.id);
    if (agent === undefined) return null;
    const card = agentCard(agent);
    return { kind: 'agent', id: agent.id, name: card.name, hint: card.hint, works: programsOf(agent.foundAt), shelves: shelvesOf(world, agent) };
  }
  const ownerItem = selected.ownerAgentId === undefined ? undefined : agents.find(a => a.id === selected.ownerAgentId);
  const owner = ownerItem === undefined ? null : refOf(ownerItem);
  // An item opened from an agent is only shown while that agent still holds it. If it was taken off (and a change was put back, or it was removed), there is nothing to show.
  if (selected.ownerAgentId !== undefined && (ownerItem === undefined || !holds(ownerItem, selected.kind, selected.id))) return null;
  if (selected.kind === 'skill') {
    const item = byId(selected.id);
    if (item === undefined || item.kind !== 'skill') return null;
    const words = wordsOf('skill', item.id, item.name), text = skillText(item, world);
    return { kind: 'skill', id: item.id, ...words, owner, usedBy: agents.filter(a => a.definition.skillIds.includes(item.id)).map(refOf), works: programsOf(item.foundAt), source: text.source, badge: itemBadge(item), text: text.lines.length > 0 ? text.lines : [DETAIL_WORDS.noText] };
  }
  if (selected.kind === 'tool') {
    const item = byId(selected.id);
    if (item === undefined || item.kind !== 'tool') return null;
    const secret = item.toolKind === 'mcp' ? item.secret : null;
    return {
      kind: 'tool', id: item.id, ...wordsOf('tool', item.id, item.name), owner, usedBy: agents.filter(a => a.definition.toolAttachments.some(t => t.toolId === item.id)).map(refOf),
      access: accessOf(item, ownerItem, agents), badge: itemBadge(item), needsKey: secret !== null && secret.state === 'missing', keyReady: secret !== null && secret.state === 'present', runsCode: item.toolKind === 'hook',
    };
  }
  const slice = world.slices.find(s => s.id === selected.id);
  if (slice === undefined) return null;
  const pages = world.wikiPages, matched = memoMatch(pages, slice.rule, slice.seeds);
  const titles = plainTitles(pages, buildTopics(pages));
  const words = noteWords(slice, pages);
  const count = matched.size;
  return {
    kind: 'note', id: slice.id, ...words, owner, usedBy: agents.filter(a => a.definition.sliceId === slice.id).map(refOf),
    topics: notesLabel(slice, pages)?.name ?? words.name, count, countLine: count === 0 ? DETAIL_WORDS.noNotes : `${count} ${count === 1 ? 'note' : 'notes'} it can read.`,
    titles: pages.filter(p => matched.has(p.id)).slice(0, NOTE_TITLES).map(p => titles.get(p.id) ?? p.title),
  };
}

/** The label of the button that takes an item off its agent: "Remove from Meeting assistant", or "Remove from this agent" when the name would make it too long. */
export function removeFromLabel(agentName: string): string {
  const named = `Remove from ${agentName}`;
  return named.split(/\s+/).length <= 5 ? named : 'Remove from this agent';
}

