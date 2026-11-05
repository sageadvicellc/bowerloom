/**
 * The geometry of the Overview as plain data: one box for each place, in a fixed grid; inside an expanded place the Builder's two columns (agents at the
 * left, every other part at the right, the slots of layout.ts); the cull that keeps the page under OVERVIEW_LIMITS.domNodes; the arrow-key move; and the list the
 * "List" view shows. Units are graph units, as in layout.ts. It reuses `GraphNode`, `Graph`, `View`, `Bounds`, `fitView`, `zoomAt`, `miniMap`, `centerOnMiniMap` and
 * `edgePath` from layout.ts; it does not change them.
 *
 * Pure: no DOM, no clock, no random number. Every order is fixed, so the same input gives an equal output. A layout is indexed once, in a weak table keyed by the layout
 * object, so `visibleOf`, `neighbourOf` and `sharedEdgesOf` do not scan the whole layout on every call; the table is a cache and never changes an answer.
 *
 * Notes for the screen:
 *  - A place header holds no card, so the arrow keys never reach it, and under OVERVIEW_LIMITS.detailZoom there are no cards at all. Draw each header as a real button in the
 *    tab order, and let Enter and Space on it open or close the place.
 *  - Pass `among = new Set(visible.nodes)` to `neighbourOf`, so a key press goes only to a card that is on the page, and scroll the focused card into view.
 *  - `sharedEdgesOf` returns edges to every laid copy, and `visibleOf` does not add the copies of the selected card. Draw only the dotted edges whose far end is in
 *    `visible.nodes`. To light every copy, `Overview.sharedKeys` lists their node ids.
 *  - A project folder outside the home folder has a label like `…/name` and is never "In Bowerloom" (main knows such a folder by its full path). Its button reads
 *    "Choose this folder".
 */
import type { PartKind } from './types.js';
import { NODE_SIZE } from './layout.js';
import type { Bounds, Graph, GraphNode, View } from './layout.js';
import { OVERVIEW_LIMITS } from './overview.js';
import type { Overview, OverviewCounts, OverviewGroup, OverviewNode, OverviewToolKind } from './overview.js';

/** A node with its place. It is a `GraphNode`, so `edgePath` draws its edges. `x` and `y` are absolute graph units. */
export interface LaidNode extends GraphNode {
  readonly groupId: string;
  readonly toolKind?: OverviewToolKind;
  readonly runsCode?: true;
  readonly sharedWith: readonly string[];
  /** The key every copy of a shared skill has in common (`OverviewNode.shareKey`); absent when the node is not shared. */
  readonly shareKey?: string;
}
/** An edge with the group it is inside. `from` and `to` are node ids. */
export interface LaidEdge { readonly id: string; readonly from: string; readonly to: string; readonly groupId: string }
/**
 * One place's box. `header` is the strip with the name, the `~` label and the counts; it is always drawn. `nodeIds` is empty when the place is collapsed. A collapsed
 * place is the header only, so its `h` is the header's.
 */
export interface LaidCluster {
  readonly id: string;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
  readonly expanded: boolean;
  readonly header: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly nodeIds: readonly string[];
}
export interface OverviewLayout {
  readonly clusters: readonly LaidCluster[];
  /** The nodes of the expanded places only, in cluster order. */
  readonly nodes: readonly LaidNode[];
  readonly edges: readonly LaidEdge[];
  /** Everything: every cluster box. The view is fitted to it. */
  readonly bounds: Bounds;
  /** The graph the small map draws: one pseudo-node for each cluster box (`id` is the group id), no edges, `bounds` as above. */
  readonly map: Graph;
}

/** The height of a place's header strip. */
const HEADER_H = 64;
/** The space between two places, and between the last card and the foot of a place. */
const GAP = 32, BODY_PAD = 16;
/** The most columns of places. The grid is the square root of the number of places, rounded up, and never wider than this. */
const MAX_COLUMNS = 4;
// The default slots of the Builder (layout.ts keeps these private): the agents' column at the left, every other part's column at the right. A test pins them to `graphOf`.
const LEFT_X = 48, RIGHT_X = 440, RIGHT_TOP = 40, RIGHT_PITCH = 76, AGENT_GAP = 12, AGENT_TOP = 70;

interface Local { readonly node: OverviewNode; readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** The cards of one open place, in coordinates from the top left of the place box, and the height the box needs. */
function bodyOf(group: OverviewGroup): { readonly cards: readonly Local[]; readonly height: number } {
  if (group.nodes.length === 0) return { cards: [], height: HEADER_H };
  const shift = HEADER_H + BODY_PAD - RIGHT_TOP;
  const slot = new Map<string, number>();
  let other = 0;
  for (const n of group.nodes) if (n.kind !== 'agent') { slot.set(n.id, RIGHT_TOP + other * RIGHT_PITCH); other += 1; }
  const targets = new Map<string, number[]>();
  for (const e of group.edges) { const y = slot.get(e.to); if (y !== undefined) { const list = targets.get(e.from) ?? []; list.push(y + NODE_SIZE.other.h / 2); targets.set(e.from, list); } }
  const cards: Local[] = [];
  let floor = Number.NEGATIVE_INFINITY, agents = 0, bottom = 0;
  for (const n of group.nodes) {
    let card: Local;
    if (n.kind === 'agent') {
      const ys = targets.get(n.id);
      const wanted = ys !== undefined && ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length - NODE_SIZE.agent.h / 2 : AGENT_TOP + agents * (NODE_SIZE.agent.h + AGENT_GAP);
      const y = Math.max(wanted, floor);
      floor = y + NODE_SIZE.agent.h + AGENT_GAP; agents += 1;
      card = { node: n, x: LEFT_X, y: y + shift, w: NODE_SIZE.agent.w, h: NODE_SIZE.agent.h };
    } else card = { node: n, x: RIGHT_X, y: slot.get(n.id)! + shift, w: NODE_SIZE.other.w, h: NODE_SIZE.other.h };
    cards.push(card);
    if (card.y + card.h > bottom) bottom = card.y + card.h;
  }
  return { cards, height: bottom + BODY_PAD };
}

/**
 * The layout of the Overview. `expanded` holds the ids of the groups drawn open; an id that is no group is ignored. Deterministic: places sit in a grid of columns of
 * OVERVIEW_LIMITS.clusterWidth (the square root of the number of places, rounded up, at most 4 columns), filled in group order, each row as tall as its tallest box. The
 * cards of an open place use NODE_SIZE and the default slots of the Builder: an agent level with the middle of the parts it uses, and never closer than a gap to the agent above.
 */
export function layoutOf(overview: Overview, expanded: ReadonlySet<string>): OverviewLayout {
  const groups = overview.groups;
  const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(groups.length))));
  const bodies = groups.map(g => (expanded.has(g.id) ? bodyOf(g) : null));
  const rowHeights: number[] = [];
  bodies.forEach((body, i) => { const row = Math.floor(i / columns), h = body === null ? HEADER_H : body.height; rowHeights[row] = Math.max(rowHeights[row] ?? 0, h); });
  const rowTops: number[] = [];
  let top = 0;
  for (const h of rowHeights) { rowTops.push(top); top += h + GAP; }
  const clusters: LaidCluster[] = [], nodes: LaidNode[] = [], edges: LaidEdge[] = [];
  let right = 0, bottom = 0;
  groups.forEach((g, i) => {
    const x = (i % columns) * (OVERVIEW_LIMITS.clusterWidth + GAP), y = rowTops[Math.floor(i / columns)]!, body = bodies[i] ?? null;
    const w = OVERVIEW_LIMITS.clusterWidth, h = body === null ? HEADER_H : body.height;
    const ids: string[] = [];
    if (body !== null) {
      for (const c of body.cards) {
        const n = c.node;
        ids.push(n.id);
        nodes.push({
          id: n.id, kind: n.kind, name: n.name, summary: n.summary, missing: false, isNew: false, x: x + c.x, y: y + c.y, w: c.w, h: c.h,
          groupId: g.id, ...(n.toolKind === undefined ? {} : { toolKind: n.toolKind }), ...(n.runsCode === undefined ? {} : { runsCode: n.runsCode }), sharedWith: n.sharedWith, ...(n.shareKey === undefined ? {} : { shareKey: n.shareKey }),
        });
      }
      for (const e of g.edges) edges.push({ id: e.id, from: e.from, to: e.to, groupId: g.id });
    }
    clusters.push({ id: g.id, x, y, w, h, expanded: body !== null, header: { x, y, w, h: HEADER_H }, nodeIds: ids });
    if (x + w > right) right = x + w;
    if (y + h > bottom) bottom = y + h;
  });
  const bounds: Bounds = groups.length === 0 ? { left: 0, top: 0, right: 0, bottom: 0 } : { left: 0, top: 0, right, bottom };
  const map: Graph = {
    nodes: clusters.map((c, i) => ({ id: c.id, kind: 'context' as PartKind, name: groups[i]!.name, summary: '', missing: false, isNew: false, x: c.x, y: c.y, w: c.w, h: c.h })),
    edges: [], bounds,
  };
  return { clusters, nodes, edges, bounds, map };
}

/** A home place with more parts than this starts closed. */
export const HOME_OPEN_MAX = 40;
/**
 * The ids of the groups to open on first draw (owner decision, 2026-10-31): every place starts closed, so the first sight is every place as a box with its counts, and the home
 * (the first group, when its scope is `home`) starts open, unless it holds more than HOME_OPEN_MAX parts, and then it starts closed too. Nothing else opens by itself: a person
 * opens a place by its header, or all of them with "Expand all". An Overview with no home group opens nothing.
 */
export function defaultExpanded(overview: Overview): ReadonlySet<string> {
  const first = overview.groups[0];
  return first !== undefined && first.scope === 'home' && first.nodes.length <= HOME_OPEN_MAX ? new Set([first.id]) : new Set();
}

/**
 * What the page draws now. `detail` is `nodes` at zoom OVERVIEW_LIMITS.detailZoom and above, and `boxes` under it (expanded places draw as boxes with counts only,
 * and `nodes` and `edges` are empty). `nodes` never holds more than OVERVIEW_LIMITS.domNodes ids, the selected node included. `edges` are the edges inside expanded
 * places that are in view.
 */
export interface OverviewVisible {
  readonly detail: 'nodes' | 'boxes';
  readonly clusters: readonly string[];
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}
/**
 * The clusters, nodes and edges that meet a window of `width` by `height` screen pixels seen through `view`, plus `margin` graph units on every side (default
 * OVERVIEW_LIMITS.cullMargin). `selected` is a node id that stays in the set even when it is out of view.
 *
 * The page holds at most OVERVIEW_LIMITS.domNodes items in all, boxes and cards together: `clusters.length + nodes.length` never passes it, so `nodes.length` is at most
 * domNodes too. When more are in view than that, the ones nearest the middle of the window stay, boxes first and then cards in the room that is left. The selected node counts
 * inside the cap: it takes the place of the farthest card (or, with no room left, of the farthest box). An edge is kept when at least one of its ends is in `nodes`, so a long
 * edge across the window is drawn. `clusters` are the boxes that meet the window; the selected node's own box is not added when it is out of view.
 */
export function visibleOf(layout: OverviewLayout, view: View, width: number, height: number, margin?: number, selected?: string | null): OverviewVisible {
  const k = Number.isFinite(view.k) && view.k > 0 ? view.k : 1;
  const m = margin ?? OVERVIEW_LIMITS.cullMargin, cap = OVERVIEW_LIMITS.domNodes;
  const x0 = -view.x / k - m, y0 = -view.y / k - m, x1 = (Math.max(0, width) - view.x) / k + m, y1 = (Math.max(0, height) - view.y) / k + m;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const meets = (r: { x: number; y: number; w: number; h: number }): boolean => r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0;
  const near = (r: { x: number; y: number; w: number; h: number }): number => (r.x + r.w / 2 - cx) ** 2 + (r.y + r.h / 2 - cy) ** 2;
  const detail: OverviewVisible['detail'] = view.k >= OVERVIEW_LIMITS.detailZoom ? 'nodes' : 'boxes';
  const index = indexOf(layout);
  const picked = detail === 'boxes' || selected === undefined || selected === null ? undefined : index.byId.get(selected);
  let clusters = layout.clusters.filter(meets);
  // The boxes first: at most the cap, and one place is kept free for the selected card.
  const boxCap = picked === undefined ? cap : cap - 1;
  if (clusters.length > boxCap) {
    const at = new Map(clusters.map((c, i) => [c.id, i] as const));
    clusters = clusters.map(c => ({ c, d: near(c) })).sort((a, b) => a.d - b.d || at.get(a.c.id)! - at.get(b.c.id)!).slice(0, boxCap).map(e => e.c).sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  }
  const ids = clusters.map(c => c.id);
  if (detail === 'boxes') return { detail, clusters: ids, nodes: [], edges: [] };
  const inView: LaidNode[] = [];
  for (const c of clusters) if (c.expanded) for (const n of index.byGroup.get(c.id) ?? []) if (meets(n)) inView.push(n);
  // The cards: the room left after the boxes, the selected card inside it.
  const room = cap - clusters.length;
  const pickedIn = picked !== undefined && inView.includes(picked);
  let chosen = inView;
  if (inView.length + (picked !== undefined && !pickedIn ? 1 : 0) > room) {
    // Nearest first; the selected card counts as nearest, so it is never the one that goes.
    chosen = inView.map(n => ({ n, d: n === picked ? -1 : near(n), at: index.order.get(n.id)! })).sort((a, b) => a.d - b.d || a.at - b.at).slice(0, Math.max(0, picked !== undefined && !pickedIn ? room - 1 : room)).map(e => e.n);
  }
  if (picked !== undefined && !pickedIn) chosen = [...chosen, picked];
  chosen = [...chosen].sort((a, b) => index.order.get(a.id)! - index.order.get(b.id)!);
  const have = new Set(chosen.map(n => n.id));
  const edges: string[] = [];
  for (const c of clusters) if (c.expanded) for (const e of index.edgesByGroup.get(c.id) ?? []) if (have.has(e.from) || have.has(e.to)) edges.push(e.id);
  return { detail, clusters: ids, nodes: chosen.map(n => n.id), edges };
}

/** What `visibleOf`, `neighbourOf` and `sharedEdgesOf` look up, built once for each layout object. */
interface Index {
  readonly byId: ReadonlyMap<string, LaidNode>;
  readonly order: ReadonlyMap<string, number>;
  readonly byGroup: ReadonlyMap<string, readonly LaidNode[]>;
  readonly edgesByGroup: ReadonlyMap<string, readonly LaidEdge[]>;
}
const INDEXES = new WeakMap<OverviewLayout, Index>();
function indexOf(layout: OverviewLayout): Index {
  const known = INDEXES.get(layout);
  if (known !== undefined) return known;
  const byId = new Map<string, LaidNode>(), order = new Map<string, number>(), byGroup = new Map<string, LaidNode[]>(), edgesByGroup = new Map<string, LaidEdge[]>();
  layout.nodes.forEach((n, i) => {
    byId.set(n.id, n); order.set(n.id, i);
    const list = byGroup.get(n.groupId) ?? []; list.push(n); byGroup.set(n.groupId, list);
  });
  for (const e of layout.edges) { const list = edgesByGroup.get(e.groupId) ?? []; list.push(e); edgesByGroup.set(e.groupId, list); }
  const made: Index = { byId, order, byGroup, edgesByGroup };
  INDEXES.set(layout, made);
  return made;
}

/**
 * The thin dotted edges drawn for the selected node only: from it to each copy of the same skill in the other places, in group order (a place with two copies gives two
 * edges). A copy is a laid node of a place in `sharedWith` with the same `shareKey`, so a renamed copy is found and a different skill with the same name is not. Only copies that
 * are laid (in an open place) get an edge. Empty for a node that is not shared. The edge id is `<node>~<copy>`; its `groupId` is the node's place.
 */
export function sharedEdgesOf(layout: OverviewLayout, nodeId: string): readonly LaidEdge[] {
  const index = indexOf(layout), node = index.byId.get(nodeId);
  if (node === undefined || node.sharedWith.length === 0 || node.shareKey === undefined) return [];
  const out: LaidEdge[] = [];
  for (const groupId of node.sharedWith) {
    for (const copy of index.byGroup.get(groupId) ?? []) if (copy.shareKey === node.shareKey) out.push({ id: `${node.id}~${copy.id}`, from: node.id, to: copy.id, groupId: node.groupId });
  }
  return out;
}

export type Direction = 'up' | 'down' | 'left' | 'right';
/**
 * The nearest node from `id` in a direction, for the arrow keys. `among` limits the choice to those node ids (the visible set); with none, every laid node counts.
 * Null when there is none. Ties go to the smaller id, so the move is the same every time.
 * A node counts when its middle is on the far side of this node's middle in that direction. The nearest wins by the distance along the move plus twice the distance across it.
 * A node of the same place wins over a nearer node of another place: a key press stays in its own place while there is a card to go to, and goes on to the next place after that.
 */
export function neighbourOf(layout: OverviewLayout, id: string, direction: Direction, among?: ReadonlySet<string>): string | null {
  const index = indexOf(layout), from = index.byId.get(id);
  if (from === undefined) return null;
  const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
  // Two bests: the nearest in the same place, and the nearest anywhere. The first wins when there is one.
  let same: LaidNode | null = null, sameCost = Number.POSITIVE_INFINITY, any: LaidNode | null = null, anyCost = Number.POSITIVE_INFINITY;
  for (const n of among === undefined ? layout.nodes : [...among].map(a => index.byId.get(a)).filter((n): n is LaidNode => n !== undefined)) {
    if (n.id === id) continue;
    const dx = n.x + n.w / 2 - fx, dy = n.y + n.h / 2 - fy;
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    if (along <= 0) continue;
    const cost = along + 2 * Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
    if (cost < anyCost || (cost === anyCost && any !== null && n.id < any.id)) { any = n; anyCost = cost; }
    if (n.groupId === from.groupId && (cost < sameCost || (cost === sameCost && same !== null && n.id < same.id))) { same = n; sameCost = cost; }
  }
  const best = same ?? any;
  return best === null ? null : best.id;
}

/** One kind of part in a place of the List view. */
export interface OverviewListSection { readonly kind: PartKind; readonly nodes: readonly OverviewNode[] }
/** One place of the List view: the same data as the graph, with the same counts and shared marks. Sections hold only kinds that have nodes, in the order agent, skill, tool, context. */
export interface OverviewListGroup {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly scope: 'home' | 'project';
  readonly inBowerloom: boolean;
  readonly folderId: string | null;
  readonly counts: OverviewCounts;
  /** The plain line of a place whose harness could not be read (`OverviewGroup.note`); absent otherwise. */
  readonly note?: string;
  readonly sections: readonly OverviewListSection[];
}
/** The List view's data, in group order. */
export function listOf(overview: Overview): readonly OverviewListGroup[] {
  const kinds: readonly PartKind[] = ['agent', 'skill', 'tool', 'context'];
  return overview.groups.map(g => ({
    id: g.id, name: g.name, label: g.label, scope: g.scope, inBowerloom: g.inBowerloom, folderId: g.folderId, counts: g.counts, ...(g.note === undefined ? {} : { note: g.note }),
    sections: kinds.map(kind => ({ kind, nodes: g.nodes.filter(n => n.kind === kind) })).filter(s => s.nodes.length > 0),
  }));
}
