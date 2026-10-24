/** The knowledge graph's logic without a screen: filtering, neighbours, and stable colour choices. Pure, so it can be tested. */
import type { GraphEdge, GraphNode, KnowledgeGraph } from './types.js';

export interface GraphFilter {
  search: string; folder: string | null; tag: string | null; showOrphans: boolean;
  /** Show only the pages within `depth` links of `id`, in either direction. */
  local: { id: string; depth: 1 | 2 } | null;
}
export const NO_FILTER: GraphFilter = Object.freeze({ search: '', folder: null, tag: null, showOrphans: true, local: null });

/** The top folder of a page (its first path part), or "(top level)" for a page at the root. */
export const topFolder = (n: GraphNode): string => (n.folder === '' ? '(top level)' : n.folder.split('/')[0]!);

export function matches(n: GraphNode, search: string): boolean {
  const q = search.trim().toLowerCase();
  return q === '' || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q));
}

/** The pages within `depth` steps of `id`, following links both ways. */
export function within(edges: readonly GraphEdge[], id: string, depth: number): Set<string> {
  const near = new Map<string, string[]>();
  for (const e of edges) { (near.get(e.from) ?? near.set(e.from, []).get(e.from)!).push(e.to); (near.get(e.to) ?? near.set(e.to, []).get(e.to)!).push(e.from); }
  const seen = new Set([id]); let frontier = [id];
  for (let step = 0; step < depth; step++) {
    const next: string[] = [];
    for (const at of frontier) for (const to of near.get(at) ?? []) if (!seen.has(to)) { seen.add(to); next.push(to); }
    frontier = next;
  }
  return seen;
}

export function filterGraph(g: KnowledgeGraph, f: GraphFilter): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const reach = f.local !== null && g.nodes.some(n => n.id === f.local!.id) ? within(g.edges, f.local.id, f.local.depth) : null;
  const nodes = g.nodes.filter(n =>
    (f.showOrphans || !n.orphan) && (f.folder === null || n.folder === f.folder || n.folder.startsWith(`${f.folder}/`)) &&
    (f.tag === null || n.tags.includes(f.tag)) && matches(n, f.search) && (reach === null || reach.has(n.id)));
  const keep = new Set(nodes.map(n => n.id));
  return { nodes, edges: g.edges.filter(e => keep.has(e.from) && keep.has(e.to)) };
}

/** Where a page links to, and who links to it. */
export function neighbours(g: KnowledgeGraph, id: string): { out: GraphNode[]; back: GraphNode[] } {
  const by = new Map(g.nodes.map(n => [n.id, n] as const));
  const pick = (ids: string[]): GraphNode[] => ids.map(x => by.get(x)).filter((n): n is GraphNode => n !== undefined).sort((a, b) => a.title.localeCompare(b.title));
  return { out: pick(g.edges.filter(e => e.from === id).map(e => e.to)), back: pick(g.edges.filter(e => e.to === id).map(e => e.from)) };
}

/** The same text always gets the same colour slot, so a folder keeps its colour while the person filters. */
export function colourSlot(key: string, slots: number): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
  return hash % slots;
}

/** How big a page is drawn: hubs larger, never huge. */
export const radiusOf = (n: GraphNode): number => Math.min(16, 3 + Math.sqrt(n.degree) * 2.2);

export function summary(g: KnowledgeGraph, shown: { nodes: GraphNode[]; edges: GraphEdge[] }): string {
  const orphans = g.nodes.filter(n => n.orphan).length;
  const base = `${g.nodes.length} ${g.nodes.length === 1 ? 'page' : 'pages'}, ${g.edges.length} ${g.edges.length === 1 ? 'link' : 'links'}, ${orphans} with no links.`;
  return shown.nodes.length === g.nodes.length ? base : `${base} Showing ${shown.nodes.length} of ${g.nodes.length} pages.`;
}
