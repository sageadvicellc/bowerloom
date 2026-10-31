/**
 * Which connections of the harness graph are drawn. Pure: it reads a model and the node a person is pointing at or has chosen.
 *
 * A graph with 60 nodes and 150 connections is a hairball when every line is drawn. So:
 *  - With nothing chosen, one faint summary line is drawn for each agent (and each library of agents) to the first interface it lands in.
 *  - A node that is pointed at or chosen shows all of its own connections at full strength, and its direct neighbours are marked.
 *  - Every other connection is not drawn at all, until a person points at one of its ends.
 */
import type { HarnessEdge, HarnessMapModel, HarnessNode } from './harnessmodel.js';

/** `summary`: the faint line of an agent. `focus`: a connection of the chosen or pointed-at node. */
export type WireState = 'summary' | 'focus';

export interface DrawnWire { readonly edge: HarnessEdge; readonly state: WireState }

const INTERFACE_ORDER = ['interface:claude-code', 'interface:codex', 'interface:opencode'];
const faceRank = (id: string): number => { const i = INTERFACE_ORDER.indexOf(id); return i < 0 ? INTERFACE_ORDER.length : i; };

/** True for a node that stands for agents: an agent, or a group (a library, or a folded list) whose items are agents. */
const standsForAgents = (n: HarnessNode): boolean => n.kind === 'agent' || (n.kind === 'group' && n.memberKind === 'agent');

/** The ids of the nodes joined to `id` by at least one connection. */
export function neighboursOf(model: HarnessMapModel, id: string): Set<string> {
  const out = new Set<string>();
  for (const e of model.edges) { if (e.from === id) out.add(e.to); else if (e.to === id) out.add(e.from); }
  return out;
}

/** The connections to draw, with how strongly. A connection of the focus node comes first in the list of its kind. */
export function drawnWires(model: HarnessMapModel, focusId: string | null): DrawnWire[] {
  const nodes = new Map(model.nodes.map(n => [n.id, n]));
  const out: DrawnWire[] = [], chosen = new Set<string>();
  if (focusId !== null && nodes.has(focusId)) {
    for (const e of model.edges) if (e.from === focusId || e.to === focusId) { out.push({ edge: e, state: 'focus' }); chosen.add(e.id); }
  }
  // One summary line for each agent: the first interface it lands in.
  const first = new Map<string, HarnessEdge>();
  for (const e of model.edges) {
    if (e.rel !== 'lands-in') continue;
    const from = nodes.get(e.from);
    if (from === undefined || !standsForAgents(from)) continue;
    const have = first.get(e.from);
    if (have === undefined || faceRank(e.to) < faceRank(have.to)) first.set(e.from, e);
  }
  for (const e of first.values()) if (!chosen.has(e.id)) out.push({ edge: e, state: 'summary' });
  return out;
}
