/**
 * The logic behind Share in the 0.8 home app: which agents can go in a copy, what a copy holds, what it leaves out, and how big it is. A copy is built
 * from the same bundle logic as the 0.7 export (`buildBundle` in shared/proto/bundle.ts, the text in export-flow.ts), so it is the same file that
 * "Open a shared file" reads (shared/home/add-file.ts). It is agent first: a copy holds the agents the person ticks, the skills those agents use, the
 * tools they use (as a name and the name of the key, never a value) and the sets of notes they read (as a rule, never a page). Everything else stays out.
 * Pure: no React, no DOM, no clock, no file. The prototype writes nothing; the screen keeps the text in memory.
 */
import { buildBundle } from '../proto/bundle.js';
import { bundleText } from '../proto/export-flow.js';
import type { AgentItem, Bundle, BundleItem, World } from '../proto/types.js';
import { ownedAgents } from './cards.js';

/** The agents a person can put in a copy: the ones they own, in name order, minus the ones Find skipped (the map does not show those either). */
export function shareableAgents(world: World, hidden: readonly string[] = []): AgentItem[] {
  return ownedAgents(world).filter(a => !hidden.includes(a.id));
}

/**
 * The bundle for the agents in `agentIds`: the agents, the owned skills they use, the tools they use and the notes they read. A hook never goes (an
 * agent is never wired to one). The ids are used as given; an id that is not an owned agent adds nothing.
 */
export function buildShare(world: World, agentIds: readonly string[]): Bundle {
  const all = buildBundle(world, world.scopes.map(s => s.id));
  const chosen = new Set(agentIds);
  const hooks = new Set(all.toolRefs.filter(t => t.toolKind === 'hook').map(t => t.toolId));
  const agents = all.items.filter((i): i is AgentItem => i.kind === 'agent' && chosen.has(i.id)).map((a): AgentItem => ({ ...a, definition: { ...a.definition, toolAttachments: a.definition.toolAttachments.filter(t => !hooks.has(t.toolId)) } }));
  const skills = new Set<string>(agents.flatMap(a => [...a.definition.skillIds]));
  const tools = new Set<string>(agents.flatMap(a => a.definition.toolAttachments.map(t => t.toolId)));
  const notes = new Set<string>(agents.flatMap(a => (a.definition.sliceId === undefined ? [] : [a.definition.sliceId])));
  const byId = new Map<string, AgentItem>(agents.map(a => [a.id, a] as const));
  const items = all.items.flatMap((i): BundleItem[] => {
    if (i.kind !== 'agent') return skills.has(i.id) ? [i] : [];
    const mine = byId.get(i.id);
    return mine === undefined ? [] : [mine];
  });
  return {
    scopeIds: all.scopeIds.filter(id => items.some(i => i.scopeId === id)),
    items,
    toolRefs: all.toolRefs.filter(t => tools.has(t.toolId) && t.toolKind !== 'hook'),
    sliceRules: all.sliceRules.filter(s => notes.has(s.sliceId)),
  };
}

/** What a copy holds, by the four kinds a person sees. */
export interface ShareCounts { readonly agents: number; readonly skills: number; readonly tools: number; readonly noteSets: number }

export function shareCounts(bundle: Bundle): ShareCounts {
  return {
    agents: bundle.items.filter(i => i.kind === 'agent').length,
    skills: bundle.items.filter(i => i.kind === 'skill').length,
    tools: bundle.toolRefs.length,
    noteSets: bundle.sliceRules.length,
  };
}

/**
 * How many different keys the tools in the copy need. The copy holds the name of each key and never its value, so these are the keys it leaves out. Two
 * tools that name the same key need it once, which is how a person adds it (and how "Open a shared file" counts it).
 */
export const keysIn = (bundle: Bundle): number => new Set(bundle.toolRefs.flatMap(t => (t.secret === null ? [] : [`${t.secret.kind}\u0000${t.secret.name}`]))).size;

/** The size of a copy in bytes. */
export const sizeBytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * How many ready-made skills and tools the agents in the copy use that travel as a name only. A ready-made item is kept by its library, so the copy does not
 * hold its text: the agent points to it, and whoever opens the copy needs to have it.
 */
export function readyMadeIn(bundle: Bundle): number {
  const held = new Set<string>([...bundle.items.map(i => i.id), ...bundle.toolRefs.map(t => t.toolId)]);
  const named = new Set<string>();
  for (const i of bundle.items) if (i.kind === 'agent') for (const id of [...i.definition.skillIds, ...i.definition.toolAttachments.map(t => t.toolId)]) if (!held.has(id)) named.add(id);
  return named.size;
}

/**
 * The bundle without some of its things: skills, agents, tools and sets of notes named by id. What is left no longer points at them: an agent keeps its other skills,
 * tools and notes. An id that is not in the bundle changes nothing.
 */
export function withoutItems(bundle: Bundle, left: ReadonlySet<string>): Bundle {
  if (left.size === 0) return bundle;
  const items = bundle.items.filter(i => !left.has(i.id)).map((i): BundleItem => {
    if (i.kind !== 'agent') return i;
    const { sliceId, ...rest } = i.definition;
    const keepNotes = sliceId !== undefined && !left.has(sliceId);
    return { ...i, definition: { ...rest, skillIds: rest.skillIds.filter(id => !left.has(id)), toolAttachments: rest.toolAttachments.filter(t => !left.has(t.toolId)), ...(keepNotes ? { sliceId } : {}) } };
  });
  return { ...bundle, items, toolRefs: bundle.toolRefs.filter(t => !left.has(t.toolId)), sliceRules: bundle.sliceRules.filter(s => !left.has(s.sliceId)), scopeIds: bundle.scopeIds.filter(id => items.some(i => i.scopeId === id)) };
}

/** Everything the Share sheet shows and saves for one choice of agents. */
export interface SharePlan {
  readonly bundle: Bundle;
  /** The text of the copy: plain JSON, the same text "Open a shared file" reads. */
  readonly text: string;
  readonly counts: ShareCounts;
  /** Keys the copy leaves out. */
  readonly keys: number;
  /** Agents on offer that the person unticked. */
  readonly leftOutAgents: number;
  /** Skills, tools and sets of notes that the person unticked under "Look inside". */
  readonly leftOutItems: number;
  /** Ready-made skills and tools that the copy points to and does not hold. */
  readonly readyMade: number;
  readonly bytes: number;
}

/**
 * The plan for the agents on offer (`offered`, as ids) without the ones in `leftOut`. An id in `leftOut` that is a skill, a tool or a set of notes of the file leaves
 * that one thing out too, and the agents that used it no longer point at it. An id that is neither on offer nor in the file is ignored.
 */
export function planShare(world: World, offered: readonly string[], leftOut: readonly string[]): SharePlan {
  const left = offered.filter(id => leftOut.includes(id));
  const whole = buildShare(world, offered.filter(id => !leftOut.includes(id)));
  const named = new Set<string>([...whole.items.map(i => i.id), ...whole.toolRefs.map(t => t.toolId), ...whole.sliceRules.map(s => s.sliceId)]);
  const out = new Set(leftOut.filter(id => !offered.includes(id) && named.has(id)));
  const bundle = withoutItems(whole, out);
  const text = bundleText(bundle);
  return { bundle, text, counts: shareCounts(bundle), keys: keysIn(bundle), leftOutAgents: left.length, leftOutItems: out.size, readyMade: readyMadeIn(bundle), bytes: sizeBytes(text) };
}

/** True when the copy holds an agent, so there is something to save. */
export const canSave = (plan: SharePlan): boolean => plan.counts.agents > 0;

/** The leave-out list after one agent was ticked or unticked. */
export const toggleLeftOut = (left: readonly string[], id: string): string[] => (left.includes(id) ? left.filter(x => x !== id) : [...left, id]);
