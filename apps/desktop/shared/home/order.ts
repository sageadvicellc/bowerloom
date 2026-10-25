/**
 * How the agents of the map are ordered, and which agent the tour opens. The map is a plain grid with one order at a time: by name, or by how recently an
 * agent changed. The sample has no clock, so "recently" is a rank: an agent the person changed in this session comes first (the newest change first), then the
 * rest by the sample's own rank (see `agentRecency`), then by name. Pure: no clock, no random number.
 */
import type { AgentItem, World } from '../proto/types.js';
import { agentCard, shelvesOf } from './cards.js';
import { agentRecency } from './plain.js';

export type SortMode = 'name' | 'recent';

/** The orders, in the order the toggle shows them. */
export const SORT_MODES: readonly SortMode[] = Object.freeze(['name', 'recent'] as const);

const byName = (a: AgentItem, b: AgentItem): number => agentCard(a).name.localeCompare(agentCard(b).name) || a.id.localeCompare(b.id);

/** A new list, in the order asked for. `touched` holds the ids the person changed this session, newest first. */
export function sortAgents(agents: readonly AgentItem[], mode: SortMode, touched: readonly string[] = []): AgentItem[] {
  if (mode === 'name') return [...agents].sort(byName);
  const rank = (a: AgentItem): number => { const at = touched.indexOf(a.id); return at >= 0 ? -touched.length + at : agentRecency(a.id); };
  return [...agents].sort((a, b) => rank(a) - rank(b) || byName(a, b));
}

/** The new list of touched ids after one agent changed: that agent first, and no id twice. */
export function touch(touched: readonly string[], id: string): string[] {
  return [id, ...touched.filter(t => t !== id)];
}

/**
 * The agent the tour opens when its "shelves" step finds nothing picked: the first one (in the order shown) that has skills, tools and notes all three,
 * else the first with a skill, else the first. Null for an empty map.
 */
export function agentForTour(world: World, agents: readonly AgentItem[]): AgentItem | null {
  const sizes = agents.map(agent => ({ agent, shelves: shelvesOf(world, agent) }));
  const full = sizes.find(s => s.shelves.skills.length > 0 && s.shelves.tools.length > 0 && s.shelves.notes.length > 0);
  const some = sizes.find(s => s.shelves.skills.length > 0);
  return (full ?? some ?? sizes[0])?.agent ?? null;
}
