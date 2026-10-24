/**
 * Stacks long lists. A project with 33 skills draws one stack, "33 skills", instead of 33 nodes; the person opens a stack with a click.
 * Skills and prompts are stacked per project and per team that brought them, and the shared library's per kind. Pure.
 */
import type { MapEdge, MapModel, MapNode, MapStatus } from './mapmodel.js';
import { KIND_WORDS, plural, titleOf } from './words.js';

/** A group of this many or more is stacked. */
export const CLUSTER_MIN = 7;
const STACKABLE = new Set(['skill', 'prompt']);

const keyOf = (n: MapNode): string | null => (STACKABLE.has(n.kind) && (n.id.startsWith('item:') || n.id.startsWith('store:')) ? `${n.owner ?? 'store'}\u0000${n.kind}\u0000${n.group ?? ''}` : null);
const worst = (list: readonly (MapStatus | null)[]): MapStatus | null => (list.includes('held') ? 'held' : list.includes('drifted') ? 'drifted' : null);

export const clusterIdOf = (n: MapNode): string | null => { const k = keyOf(n); return k === null ? null : `cluster:${k.replace(/\u0000/g, ':')}`; };

/** The map with its long lists stacked, except the stacks named in `expanded`. */
export function clusterMap(model: MapModel, expanded: ReadonlySet<string> = new Set(), min: number = CLUSTER_MIN): MapModel {
  const groups = new Map<string, MapNode[]>();
  for (const n of model.nodes) { const k = keyOf(n); if (k !== null) groups.set(k, [...(groups.get(k) ?? []), n]); }
  const stackOf = new Map<string, string>(), stacks: MapNode[] = [];
  for (const [k, members] of groups) {
    const id = `cluster:${k.replace(/\u0000/g, ':')}`;
    if (members.length < min || expanded.has(id)) continue;
    const first = members[0]!, team = first.group === undefined ? '' : ` from ${titleOf(first.group)}`;
    const status = worst(members.map(m => m.status)), bad = members.filter(m => m.status !== null).length;
    for (const m of members) stackOf.set(m.id, id);
    stacks.push({
      id, kind: first.kind, label: `${members.length} ${first.kind === 'skill' ? 'skills' : 'prompts'}${team}`, scope: first.scope, owner: first.owner, status,
      reasons: bad === 0 ? [] : [`${plural(bad, 'item')} in this stack ${bad === 1 ? 'needs' : 'need'} a look. Open the stack to see which.`],
      description: `A stack of ${members.length} ${KIND_WORDS[first.kind as 'skill' | 'prompt'].many.toLowerCase()}${team}. Click to open the stack.`,
      link: null, cluster: { count: members.length, ids: members.map(m => m.id) },
    });
  }
  if (stacks.length === 0) return model;
  const nodes = [...model.nodes.filter(n => !stackOf.has(n.id)), ...stacks];
  const seen = new Set<string>(), edges: MapEdge[] = [];
  for (const e of model.edges) {
    const from = stackOf.get(e.from) ?? e.from, to = stackOf.get(e.to) ?? e.to;
    if (from === to) continue;
    const id = from === e.from && to === e.to ? e.id : `${from}>${e.rel}>${to}`;
    if (!seen.has(id)) { seen.add(id); edges.push(id === e.id ? e : { id, from, to, rel: e.rel }); }
  }
  return { nodes, edges };
}
