/**
 * Where nodes go. Layered, left to right: this computer, workspaces, projects and context stores, teams, helpers, then skills, prompts,
 * reading lists and knowledge folders, then the shared library items at the far right (everything above comes from them).
 * Pure and deterministic: the same map always gives the same places.
 */
import type { MapEdge, MapKind, MapNode } from './mapmodel.js';

export interface Place { x: number; y: number }
export const LAYOUT = Object.freeze({ columnWidth: 344, rowHeight: 112, nodeWidth: 272, nodeHeight: 80, gridSnap: 16 });

const RANK: Record<MapKind, number> = { machine: 0, workspace: 1, project: 2, 'context-store': 2, team: 3, agent: 4, skill: 5, prompt: 5, 'reading-list': 5, 'knowledge-folder': 5 };
/** A node of the shared library (it has no owner) sits right of every project item that comes from it. */
const rankOf = (n: MapNode): number => n.kind !== 'machine' && n.kind !== 'knowledge-folder' && n.owner === null && n.scope === 'global' ? 6 : RANK[n.kind];

export function autoLayout(nodes: readonly MapNode[], edges: readonly MapEdge[]): Map<string, Place> {
  const rank = new Map(nodes.map(n => [n.id, rankOf(n)]));
  const layers = new Map<number, MapNode[]>();
  for (const n of nodes) layers.set(rank.get(n.id)!, [...(layers.get(rank.get(n.id)!) ?? []), n]);
  const ranks = [...layers.keys()].sort((a, b) => a - b);
  const parents = new Map<string, string[]>();
  for (const e of edges) { const a = rank.get(e.from), b = rank.get(e.to); if (a === undefined || b === undefined) continue; const [from, to] = a <= b ? [e.from, e.to] : [e.to, e.from]; parents.set(to, [...(parents.get(to) ?? []), from]); }
  const y = new Map<string, number>();
  for (const r of ranks) {
    const layer = layers.get(r)!;
    // Order by the average place of what is connected on the left (so wires cross less), then by name.
    const keyOf = (n: MapNode): number => { const ps = (parents.get(n.id) ?? []).map(p => y.get(p)).filter((v): v is number => v !== undefined); return ps.length === 0 ? Number.MAX_SAFE_INTEGER : ps.reduce((a, b) => a + b, 0) / ps.length; };
    layer.sort((a, b) => keyOf(a) - keyOf(b) || (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
    // Place each node near its connections, but never closer than one row to the one above it.
    let floor = 0;
    for (const n of layer) { const want = keyOf(n) === Number.MAX_SAFE_INTEGER ? floor : Math.max(floor, keyOf(n)); y.set(n.id, want); floor = want + LAYOUT.rowHeight; }
  }
  const out = new Map<string, Place>();
  // Columns are packed: a kind that is not on the map leaves no empty column behind it.
  const column = new Map(ranks.map((r, i) => [r, i] as const));
  for (const n of nodes) out.set(n.id, { x: column.get(rank.get(n.id)!)! * LAYOUT.columnWidth, y: y.get(n.id)! });
  return out;
}

/** A saved place by its own key only: `constructor`, `__proto__` and the like are never found, and a place that is not two finite numbers is not a place. */
export function ownPlace(places: Readonly<Record<string, Place>> | undefined, id: string): Place | undefined {
  if (places === undefined || !Object.hasOwn(places, id)) return undefined;
  const p = places[id] as Partial<Place> | undefined;
  return p !== undefined && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : undefined;
}

/** Snaps a place to the grid. */
export const snap = (p: Place, size: number = LAYOUT.gridSnap): Place => ({ x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size });

/** A fixture of `n` nodes for speed tests: a machine, workspaces, projects, and their items, in the shape of a real setup. */
export function syntheticMap(n: number): { nodes: MapNode[]; edges: MapEdge[] } {
  const nodes: MapNode[] = [{ id: 'machine', kind: 'machine', label: 'This computer', scope: 'global', description: '', status: null, reasons: [], link: null, owner: null }], edges: MapEdge[] = [];
  const add = (id: string, kind: MapKind, parent: string, rel: MapEdge['rel']): void => { nodes.push({ id, kind, label: id, scope: 'project', description: '', status: null, reasons: [], link: null, owner: null }); edges.push({ id: `${parent}>${rel}>${id}`, from: parent, to: id, rel }); };
  for (let w = 0; nodes.length < n; w++) {
    add(`ws-${w}`, 'workspace', 'machine', 'contains');
    for (let p = 0; p < 5 && nodes.length < n; p++) {
      add(`p-${w}-${p}`, 'project', `ws-${w}`, 'contains');
      for (let t = 0; t < 2 && nodes.length < n; t++) { add(`t-${w}-${p}-${t}`, 'team', `p-${w}-${p}`, 'uses'); add(`a-${w}-${p}-${t}`, 'agent', `t-${w}-${p}-${t}`, 'owns'); }
      for (let s = 0; s < 6 && nodes.length < n; s++) add(`s-${w}-${p}-${s}`, 'skill', `p-${w}-${p}`, 'uses');
    }
  }
  return { nodes: nodes.slice(0, n), edges: edges.filter(e => nodes.slice(0, n).some(x => x.id === e.to)) };
}

/**
 * Keeps the saved places within a limit without ever refusing a new place. Past `soft` places, the places of things that are no
 * longer on the map (a removed project) go first; if more than `hard` remain, the oldest go. The newest places are always kept.
 */
/** Past `soft` saved places, those of things no longer on the map go first. The settings file holds at most `hard`. One set of numbers for the window and the main process. */
export const PLACE_LIMITS = Object.freeze({ soft: 5000, hard: 20000 });

export function prunePlaces(layout: Record<string, Place>, valid: ReadonlySet<string>, soft: number, hard: number): Record<string, Place> {
  let entries = Object.entries(layout);
  if (entries.length > soft) entries = entries.filter(([id]) => valid.has(id));
  if (entries.length > hard) entries = entries.slice(entries.length - hard);
  return Object.fromEntries(entries);
}
