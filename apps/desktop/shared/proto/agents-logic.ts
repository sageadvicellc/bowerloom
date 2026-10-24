/**
 * The agents manager's logic (prototype slice S6, spec section 7, screen 4), as pure functions: the list (owned agents first, then each library),
 * the search, the 50-row pages, what a selected agent is made of, what each action does, and where the agent lands in each interface.
 * The editor's own rules decide what may be changed (`editRefusal`, `connectOutcome`) and what an install says (`installOutcome`).
 */
import { ACCESS_WORDS, interfaceName } from './harnessmodel.js';
import { attachToolOutcome, connectOutcome, editRefusal } from './editor-actions.js';
import type { EditorContext, EditorOutcome } from './editor-actions.js';
import { effectiveItems } from './common.js';
import { contextFor } from './library-install.js';
import { planProjection } from './plan.js';
import type { AccessClass, AgentItem, HarnessItem, InterfaceId, LibrarySource, PlanChange, SkillItem, ToolItem, World } from './types.js';

/** How many rows of one list show at a time. */
export const PAGE_SIZE = 50;

const isAgent = (item: HarnessItem): item is AgentItem => item.kind === 'agent';
const byName = (a: HarnessItem, b: HarnessItem): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** True when every word of the query is in the agent's name or role. Case does not matter. An empty query matches everything. */
export function agentMatches(agent: AgentItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(w => w !== '');
  const text = `${agent.name} ${agent.definition.role}`.toLowerCase();
  return words.every(w => text.includes(w));
}

/** One list of agents: the ones a person owns, or the ones of one library. `all` is how many it holds; `matching` are those that pass the search. */
export interface AgentList {
  readonly id: string; readonly title: string; readonly library: LibrarySource | null; readonly all: number; readonly matching: readonly AgentItem[];
}

/** The lists of the screen: "Yours" first, then one list for each installed library. */
export function agentLists(world: World, query: string): AgentList[] {
  const agents = world.items.filter(isAgent);
  const own = agents.filter(a => a.library === null).sort(byName);
  const lists: AgentList[] = [{ id: 'yours', title: 'Yours', library: null, all: own.length, matching: own.filter(a => agentMatches(a, query)) }];
  for (const library of world.libraries) {
    const members = agents.filter(a => a.library?.library === library.id).sort(byName);
    lists.push({ id: library.id, title: library.name, library, all: members.length, matching: members.filter(a => agentMatches(a, query)) });
  }
  return lists;
}

/** The rows of a list that show now: the first `shown`, never fewer than one page. */
export function visibleRows<T>(rows: readonly T[], shown: number): T[] {
  return rows.slice(0, Math.max(PAGE_SIZE, shown));
}

/** How many more rows a list has past the ones that show. */
export const rowsLeft = (rows: readonly unknown[], shown: number): number => Math.max(0, rows.length - Math.max(PAGE_SIZE, shown));

/** The words on the button that shows more rows: "Show 50 more", and "Show 20 more" for the last page. */
export const moreLabel = (left: number): string => `Show ${Math.min(PAGE_SIZE, left)} more`;

// ------------------------------------------------------------------------------------------------------------- one agent

/** A skill of the agent, in its order. `missing` is true when the world has no such skill. */
export interface AgentSkill { readonly id: string; readonly name: string; readonly position: number; readonly count: number; readonly missing: boolean }

/** A tool of the agent, with the access class chosen for it. */
export interface AgentTool { readonly id: string; readonly name: string; readonly kind: string; readonly access: AccessClass; readonly accessWords: string; readonly missing: boolean }

/** A feature that only one interface has, with its badge. */
export interface AgentExtra { readonly interfaceName: string; readonly badge: string; readonly key: string; readonly value: string }

/** Everything the detail panel says about an agent. */
export interface AgentView {
  readonly id: string; readonly name: string; readonly role: string; readonly instructions: string;
  readonly skills: readonly AgentSkill[]; readonly tools: readonly AgentTool[]; readonly slice: string | null; readonly sliceItemId: string | null;
  readonly extras: readonly AgentExtra[]; readonly extrasNote: string;
  /** "Lives in Studio" or "From Evergreen Kit 2.3.0". */
  readonly origin: string; readonly libraryName: string | null; readonly newerVersion: string | null;
  /** The plain reason the agent cannot be changed here, or null when it can. */
  readonly refusal: string | null;
}

/** The kind of tool in words. */
export const toolKindWord = (tool: ToolItem): string => (tool.toolKind === 'hook' ? 'Hook' : tool.toolKind === 'prompt' ? 'Saved prompt' : 'MCP server');

/** The context the editor's rules need for this agent: its own harness, with every library open. */
export const agentContext = (world: World, agent: AgentItem): EditorContext => contextFor(world, agent.scopeId);

/** Reads an agent for the detail panel. */
export function describeAgent(world: World, agent: AgentItem): AgentView {
  const byId = new Map(world.items.map(i => [i.id, i]));
  const d = agent.definition;
  const skills = d.skillIds.map((id, position): AgentSkill => ({ id, name: byId.get(id)?.name ?? id, position, count: d.skillIds.length, missing: byId.get(id)?.kind !== 'skill' }));
  const tools = d.toolAttachments.map((t): AgentTool => {
    const tool = byId.get(t.toolId);
    return { id: t.toolId, name: tool?.name ?? t.toolId, kind: tool !== undefined && tool.kind === 'tool' ? toolKindWord(tool) : 'Tool', access: t.access, accessWords: ACCESS_WORDS[t.access], missing: tool?.kind !== 'tool' };
  });
  const slice = d.sliceId === undefined ? undefined : world.slices.find(s => s.id === d.sliceId);
  const sliceItem = d.sliceId === undefined ? undefined : world.items.find(i => i.kind === 'context-slice' && i.sliceId === d.sliceId);
  const lib = agent.library === null ? undefined : world.libraries.find(l => l.id === agent.library!.library);
  const scope = world.scopes.find(s => s.id === agent.scopeId);
  const origin = agent.library === null ? `Lives in ${scope === undefined ? 'a harness' : scope.name}` : `From ${lib?.name ?? agent.library.library} ${agent.library.pinnedVersion}`;
  return {
    id: agent.id, name: agent.name, role: d.role, instructions: d.instructions, skills, tools, slice: slice?.name ?? null, sliceItemId: sliceItem?.id ?? null,
    extras: agent.extras.map(e => ({ interfaceName: interfaceName(e.interface), badge: e.badge, key: e.key, value: e.value })),
    extrasNote: agent.extras.length === 0 ? 'No extras. This agent is the same in every interface.' : 'These belong to one interface only. Bowerloom keeps them and never drops one without telling you.',
    origin, libraryName: lib?.name ?? agent.library?.library ?? null, newerVersion: agent.library?.newerVersion ?? lib?.newerVersion ?? null,
    refusal: editRefusal(agentContext(world, agent), agent.id),
  };
}

// ------------------------------------------------------------------------------------------------------------- what can be attached

/** The skills this agent could use and does not yet: the ones the editor's wire would accept, by name. */
export function attachableSkills(world: World, agent: AgentItem): SkillItem[] {
  const ctx = agentContext(world, agent);
  return world.items.filter((i): i is SkillItem => i.kind === 'skill' && connectOutcome(ctx, i.id, agent.id).kind === 'action').sort(byName);
}

/** The tools this agent could have and does not yet. A hook is never offered, because a hook is never wired. */
export function attachableTools(world: World, agent: AgentItem): ToolItem[] {
  const ctx = agentContext(world, agent);
  return world.items.filter((i): i is ToolItem => {
    if (i.kind !== 'tool') return false;
    const o = connectOutcome(ctx, i.id, agent.id);
    return o.kind === 'choose-access' && o.current === null;
  }).sort(byName);
}

/** The slices an agent can read: the slice items its harness can reach. */
export function attachableSlices(world: World, agent: AgentItem): { id: string; name: string; sliceId: string }[] {
  const reach = new Set(effectiveItems(world, agent.scopeId).map(i => i.id));
  return world.items.flatMap(i => (i.kind === 'context-slice' && reach.has(i.id) ? [{ id: i.id, name: i.name, sliceId: i.sliceId }] : [])).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ------------------------------------------------------------------------------------------------------------- actions

const refuse = (message: string): EditorOutcome => ({ kind: 'refused', message });

/** Attach a skill: the editor's wire from a skill to an agent. Refused with the reason when the agent is a library agent or already uses it. */
export function attachSkillOutcome(world: World, agent: AgentItem, skillId: string): EditorOutcome {
  const o = connectOutcome(agentContext(world, agent), skillId, agent.id);
  return o.kind === 'choose-access' ? refuse('That is a tool, not a skill.') : o;
}

/** Detach a skill from an agent the person may change. */
export function detachSkillOutcome(world: World, agent: AgentItem, skillId: string): EditorOutcome {
  const why = editRefusal(agentContext(world, agent), agent.id);
  if (why !== null) return refuse(why);
  const name = world.items.find(i => i.id === skillId)?.name ?? skillId;
  if (!agent.definition.skillIds.includes(skillId)) return refuse(`${agent.name} does not use the skill ${name}.`);
  return { kind: 'action', action: { type: 'detachSkill', agentId: agent.id, skillId }, message: `${agent.name} no longer uses the skill ${name}.` };
}

/** Move a skill to a new place in the agent's list (0 is first). Refused when the agent cannot be changed or the place is not in the list. */
export function moveSkillOutcome(world: World, agent: AgentItem, skillId: string, toIndex: number): EditorOutcome {
  const why = editRefusal(agentContext(world, agent), agent.id);
  if (why !== null) return refuse(why);
  const ids = agent.definition.skillIds, from = ids.indexOf(skillId), name = world.items.find(i => i.id === skillId)?.name ?? skillId;
  if (from < 0) return refuse(`${agent.name} does not use the skill ${name}.`);
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= ids.length) return refuse(`${name} is already ${toIndex < 0 ? 'first' : 'last'} in the list.`);
  if (toIndex === from) return refuse(`${name} is already in that place.`);
  return { kind: 'action', action: { type: 'moveSkill', agentId: agent.id, skillId, toIndex }, message: `Moved the skill ${name} to place ${toIndex + 1} of ${ids.length} for ${agent.name}.` };
}

/** Attach a tool with the access class the person picked. Uses the editor's wire first, so a hook and a library agent are refused with the editor's words. */
export function attachToolChoice(world: World, agent: AgentItem, toolId: string, access: AccessClass): EditorOutcome {
  const o = connectOutcome(agentContext(world, agent), toolId, agent.id);
  if (o.kind !== 'choose-access') return o.kind === 'refused' ? o : refuse('That is not a tool.');
  return attachToolOutcome(agent.id, toolId, access, ACCESS_WORDS, agent.name, o.toolName);
}

/** Change the access class of a tool the agent already has. */
export function changeAccessOutcome(world: World, agent: AgentItem, toolId: string, access: AccessClass): EditorOutcome {
  const why = editRefusal(agentContext(world, agent), agent.id);
  if (why !== null) return refuse(why);
  const tool = agent.definition.toolAttachments.find(t => t.toolId === toolId), name = world.items.find(i => i.id === toolId)?.name ?? toolId;
  if (tool === undefined) return refuse(`${agent.name} does not have the tool ${name}.`);
  if (tool.access === access) return refuse(`${name} already has the access: ${ACCESS_WORDS[access]}.`);
  return attachToolOutcome(agent.id, toolId, access, ACCESS_WORDS, agent.name, name);
}

/** Detach a tool from an agent the person may change. */
export function detachToolOutcome(world: World, agent: AgentItem, toolId: string): EditorOutcome {
  const why = editRefusal(agentContext(world, agent), agent.id);
  if (why !== null) return refuse(why);
  const name = world.items.find(i => i.id === toolId)?.name ?? toolId;
  if (!agent.definition.toolAttachments.some(t => t.toolId === toolId)) return refuse(`${agent.name} does not have the tool ${name}.`);
  return { kind: 'action', action: { type: 'detachTool', agentId: agent.id, toolId }, message: `${agent.name} no longer has the tool ${name}.` };
}

/** Assign a slice (by its item id), or none (null). Uses the editor's wire from a slice to an agent. */
export function assignSliceOutcome(world: World, agent: AgentItem, sliceItemId: string | null): EditorOutcome {
  if (sliceItemId === null) {
    const why = editRefusal(agentContext(world, agent), agent.id);
    if (why !== null) return refuse(why);
    if (agent.definition.sliceId === undefined) return refuse(`${agent.name} reads no slice already.`);
    return { kind: 'action', action: { type: 'assignSlice', agentId: agent.id, sliceId: null }, message: `${agent.name} reads no slice now.` };
  }
  return connectOutcome(agentContext(world, agent), sliceItemId, agent.id);
}

// ------------------------------------------------------------------------------------------------------------- where it lands

/** One file an agent would be written to, and whether a change to it waits. */
export interface LandingFile { readonly path: string; readonly preview: string; readonly waiting: PlanChange['action'] | null }

/** What one interface would get for an agent. */
export interface Landing { readonly interface: InterfaceId; readonly name: string; readonly status: string; readonly installed: boolean; readonly files: readonly LandingFile[] }

/** The harness an interface path belongs to: the harness with the longest path that starts it. */
function ownerOf(world: World, path: string): string | null {
  let best: { id: string; length: number } | null = null;
  for (const s of world.scopes) {
    const base = s.path.replace(/\/+$/, '');
    if (path.startsWith(`${base}/`) && (best === null || base.length > best.length)) best = { id: s.id, length: base.length };
  }
  return best === null ? null : best.id;
}

/**
 * For each of the three interfaces, the files the projection plan writes for this agent. A file is the plan's own: the plan is worked out for the
 * whole world once with nothing written yet (every file shows), and once against what was applied (the files that wait). A file belongs to the agent when it holds
 * the agent's text and sits in a harness that has the agent. A library agent is a reference, so nothing is written for it.
 */
export function whereItLands(committed: World, draft: World, agent: AgentItem): Landing[] {
  const everything = planProjection({ ...draft, items: [] }, draft), waiting = planProjection(committed, draft);
  const keeps = new Set(draft.scopes.filter(s => effectiveItems(draft, s.id).some(i => i.id === agent.id)).map(s => s.id));
  const mine = (c: PlanChange): boolean => c.preview.startsWith(`Agent: ${agent.name}\n`) && keeps.has(ownerOf(draft, c.path) ?? '');
  const order: readonly InterfaceId[] = ['claude-code', 'codex', 'opencode'];
  return order.map((id): Landing => {
    const info = draft.interfaces.find(i => i.id === id), installed = info?.installed === 'installed';
    const files = agent.library !== null || !installed ? [] : everything.changes.filter(c => c.interface === id && mine(c)).map((c): LandingFile => ({
      path: c.path, preview: c.preview, waiting: waiting.changes.find(w => w.interface === id && w.path === c.path)?.action ?? null,
    }));
    const status = agent.library !== null ? 'Nothing is written. A library agent is a reference.'
      : !installed ? (info?.installed === 'unknown' ? 'Not checked yet. Nothing is written.' : 'Not installed on this computer. Nothing is written.')
        : files.length === 0 ? 'Nothing is written yet.'
          : `${files.length === 1 ? '1 file' : `${files.length} files`} would be written${files.some(f => f.waiting !== null) ? `, ${files.filter(f => f.waiting !== null).length} waiting` : ''}.`;
    return { interface: id, name: interfaceName(id), status, installed, files };
  });
}
