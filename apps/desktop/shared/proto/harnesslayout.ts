/**
 * Where the nodes of the harness graph go. Pure and deterministic: the same model, size and pinned places always give the same places.
 *
 * The scope root sits at the top, centred. Below it are three bands, left to right: what an agent uses (skills, then tools, then slices),
 * the agents (a library of agents first), then the interfaces. A band is WRAPPED: a column holds at most `maxRows` nodes, taken from the size
 * of the window, and the rest wrap into more columns beside it. So 200 or 500 nodes make a wide, even block and never one tall, thin column.
 * Nodes are sized by role (`sizeOf`): interfaces and the root are large, agents, tools, slices and groups are medium, skills are small.
 * Nodes never overlap. A place the person chose (`pinned`) always wins over the automatic place.
 */
import type { HarnessMapModel, HarnessNode, HarnessNodeKind } from './harnessmodel.js';

export interface Point { x: number; y: number }
/** Places by node id. */
export type Positions = Record<string, Point>;
/** The room the graph is shown in, in pixels. */
export interface LayoutSize { readonly width: number; readonly height: number }
/** The size of one node, in the units of the graph. */
export interface NodeSize { readonly w: number; readonly h: number }

/** Sizes in units. `nodeWidth` and `nodeHeight` are the medium size. The canvas draws every node at `sizeOf(node)`, so the two files agree. */
export const HARNESS_LAYOUT = Object.freeze({
  nodeWidth: 232, nodeHeight: 56,
  large: Object.freeze({ w: 220, h: 60 }), medium: Object.freeze({ w: 232, h: 56 }), small: Object.freeze({ w: 200, h: 52 }),
  /** A group is wider and a little taller than a medium node: it holds the Open button beside its text. */
  group: Object.freeze({ w: 296, h: 76 }),
  /** The gap between two columns of one band, and between two rows. */
  columnGap: 16, rowGap: 10,
  /** The gap between two bands. */
  bandGap: 56,
  /** The gap between the root and the bands below it. */
  rootGap: 28,
  /** Rows per column are never fewer than `minRows` nor more than `maxRowsLimit`. */
  minRows: 4, maxRowsLimit: 60,
  gridSnap: 8,
});

/** How big a node is drawn: by its role. Interfaces and the root are large, skills are small, a group is a little taller than the medium rest. */
export function sizeOf(node: Pick<HarnessNode, 'kind'>): NodeSize {
  return node.kind === 'interface' || node.kind === 'scope' ? HARNESS_LAYOUT.large : node.kind === 'skill' ? HARNESS_LAYOUT.small : node.kind === 'group' ? HARNESS_LAYOUT.group : HARNESS_LAYOUT.medium;
}

/** The three bands: what an agent uses, the agents, the interfaces. */
const BAND_USES = 0, BAND_AGENTS = 1, BAND_INTERFACES = 2;
function bandOf(n: HarnessNode): number {
  if (n.kind === 'interface') return BAND_INTERFACES;
  if (n.kind === 'agent') return BAND_AGENTS;
  if (n.kind === 'group') return n.memberKind === 'skill' || n.memberKind === 'tool' || n.memberKind === 'context-slice' ? BAND_USES : BAND_AGENTS;
  return BAND_USES;
}
/** Inside the first band: skills, tools, then slices; a group leads its kind. */
function usesRank(n: HarnessNode): number {
  const kind = n.kind === 'group' ? n.memberKind : n.kind;
  return (kind === 'skill' ? 0 : kind === 'tool' ? 1 : 2) * 2 + (n.kind === 'group' ? 0 : 1);
}

/** How many rows fit under the root in a window of this height. */
export function rowsFitting(height: number): number {
  const { nodeHeight, rootGap, rowGap, large } = HARNESS_LAYOUT;
  const room = Number.isFinite(height) ? height - large.h - rootGap : 0;
  const rows = Math.floor((room + rowGap) / (nodeHeight + rowGap));
  return Math.max(HARNESS_LAYOUT.minRows, Math.min(HARNESS_LAYOUT.maxRowsLimit, rows));
}

/** The nodes of each band, in the order they are drawn, and the root. */
function bandsOf(nodes: readonly HarnessNode[]): { bands: HarnessNode[][]; root: HarnessNode | null } {
  const bands: HarnessNode[][] = [[], [], []];
  let root: HarnessNode | null = null;
  for (const n of nodes) { if (n.kind === 'scope') root ??= n; else bands[bandOf(n)]!.push(n); }
  const first = bands[BAND_USES]!;
  const order = new Map(first.map((n, i) => [n.id, i]));
  first.sort((a, b) => usesRank(a) - usesRank(b) || order.get(a.id)! - order.get(b.id)!);
  return { bands, root };
}

/** One band cut into columns of at most `rows` nodes, filled evenly top to bottom. */
function columnsFor(list: readonly HarnessNode[], rows: number): HarnessNode[][] {
  if (list.length === 0) return [];
  const columns = Math.ceil(list.length / rows), per = Math.ceil(list.length / columns), out: HarnessNode[][] = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per));
  return out;
}
const columnHeight = (col: readonly HarnessNode[]): number => col.reduce((sum, n) => sum + sizeOf(n).h, 0) + Math.max(0, col.length - 1) * HARNESS_LAYOUT.rowGap;
const columnWidth = (col: readonly HarnessNode[]): number => col.reduce((m, n) => Math.max(m, sizeOf(n).w), 0);

interface Block { readonly width: number; readonly height: number; readonly tallest: number; readonly top: number; readonly bands: HarnessNode[][][] }
/** The block the bands make when no column holds more than `rows` nodes: its size and each band's columns. */
function blockFor(parts: { bands: HarnessNode[][]; root: HarnessNode | null }, rows: number): Block {
  const { columnGap, bandGap, rootGap } = HARNESS_LAYOUT;
  const cut = parts.bands.map(list => columnsFor(list, rows)).filter(cols => cols.length > 0);
  let width = 0, tallest = 0;
  cut.forEach((cols, i) => {
    width += cols.reduce((sum, c) => sum + columnWidth(c), 0) + (cols.length - 1) * columnGap + (i > 0 ? bandGap : 0);
    for (const c of cols) tallest = Math.max(tallest, columnHeight(c));
  });
  const rootSize = parts.root === null ? null : sizeOf(parts.root), top = rootSize === null ? 0 : rootSize.h + rootGap;
  return { width: Math.max(rootSize?.w ?? 0, width), height: top + tallest, tallest, top, bands: cut };
}

/**
 * The most nodes one column may hold. With no model it is the rows that fit the window's height. With a model it is the row count that
 * lets the whole block show at the largest size in the window (the block is taller when the window is tall and wider when it is wide),
 * so a small window gets a block it can show, and 500 nodes never become one thin column or one flat strip. Between two row counts that
 * show the block equally large, the one whose shape is nearest the window's wins. Always between `minRows` and `maxRowsLimit`.
 */
export function maxRowsFor(size: LayoutSize, model?: { readonly nodes: readonly HarnessNode[] }): number {
  if (model === undefined) return rowsFitting(size.height);
  const parts = bandsOf(model.nodes), W = Math.max(1, size.width), H = Math.max(1, size.height);
  let best = rowsFitting(size.height), bestZoom = -1, bestShape = Infinity;
  for (let rows = HARNESS_LAYOUT.minRows; rows <= HARNESS_LAYOUT.maxRowsLimit; rows += 1) {
    const b = blockFor(parts, rows), zoom = Math.min(1, W / b.width, H / b.height), shape = Math.abs(Math.log((b.width / b.height) / (W / H)));
    if (zoom > bestZoom + 1e-9 || (Math.abs(zoom - bestZoom) <= 1e-9 && shape < bestShape)) { best = rows; bestZoom = zoom; bestShape = shape; }
  }
  return best;
}

const isPoint = (p: unknown): p is Point => typeof p === 'object' && p !== null && Number.isFinite((p as Point).x) && Number.isFinite((p as Point).y);

/** A place by its own key only, so `constructor` and `__proto__` are never found. */
export function pinnedPlace(pinned: Readonly<Record<string, Point>> | undefined, id: string): Point | undefined {
  if (pinned === undefined || !Object.hasOwn(pinned, id)) return undefined;
  const p: unknown = pinned[id];
  return isPoint(p) ? { x: p.x, y: p.y } : undefined;
}

/** Places every node of the model. */
export function layoutHarness(model: HarnessMapModel, size: LayoutSize, pinned?: Readonly<Record<string, Point>>): Positions {
  const { columnGap, bandGap } = HARNESS_LAYOUT;
  const parts = bandsOf(model.nodes), block = blockFor(parts, maxRowsFor(size, model));
  const out = new Map<string, Point>();
  let x = 0;
  block.bands.forEach(cols => {
    const isInterfaces = cols[0]![0]!.kind === 'interface';
    for (const col of cols) {
      const colW = columnWidth(col), offset = isInterfaces ? (block.tallest - columnHeight(col)) / 2 : 0;
      let y = block.top + offset;
      for (const n of col) { const s = sizeOf(n); out.set(n.id, { x: x + (colW - s.w) / 2, y }); y += s.h + HARNESS_LAYOUT.rowGap; }
      x += colW + columnGap;
    }
    x += bandGap - columnGap;
  });
  if (parts.root !== null) out.set(parts.root.id, { x: (block.width - sizeOf(parts.root).w) / 2, y: 0 });

  const result: Positions = {};
  for (const n of model.nodes) {
    const place = pinnedPlace(pinned, n.id) ?? out.get(n.id) ?? { x: 0, y: 0 };
    Object.defineProperty(result, n.id, { value: place, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

/** Which side of a node a wire leaves from and arrives at: `l` is the left edge, `r` the right. A wire runs between the facing sides. */
export type Side = 'l' | 'r';
export function wireSides(from: Point, to: Point): { source: Side; target: Side } {
  if (to.x < from.x) return { source: 'l', target: 'r' };
  if (to.x > from.x) return { source: 'r', target: 'l' };
  return { source: 'r', target: 'r' };
}

/**
 * The node whose box holds the point (a place is the top left corner of a node), skipping `excludeId`. Null when none does. Used to tell a drop on a node from a move.
 * `sizes` gives a node's own size by id; a node it does not name is medium.
 */
export function nodeAt(positions: Readonly<Record<string, Point>>, point: Point, excludeId: string, sizes?: Readonly<Record<string, NodeSize>>): string | null {
  for (const [id, p] of Object.entries(positions)) {
    const { w, h } = sizes?.[id] ?? HARNESS_LAYOUT.medium;
    if (id !== excludeId && point.x >= p.x && point.x <= p.x + w && point.y >= p.y && point.y <= p.y + h) return id;
  }
  return null;
}

/** Snaps a place to the grid. */
export const snapPoint = (p: Point, size: number = HARNESS_LAYOUT.gridSnap): Point => ({ x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size });

/** A made-up model of `count` nodes for speed and layout tests: a root, three interfaces, and the rest spread over the kinds in the proportions of a real setup. */
export function syntheticHarness(count: number): HarnessMapModel {
  const blank = (id: string, kind: HarnessNodeKind): HarnessNode => ({
    id, kind, toolKind: kind === 'tool' ? 'mcp' : null, interfaceId: null, kindLabel: kind, label: id, detail: '', scopeId: 'global', fromScope: null, inherited: false, hidden: false, replaced: false,
    replacedBy: null, libraryPinned: false, newerVersion: false, runsCode: false, secretMissing: false, conflict: false, notInstalled: false, groupId: null, memberCount: null, expanded: false, memberKind: null, badges: [],
  });
  const nodes: HarnessNode[] = [blank('scope:synthetic', 'scope')];
  const ids = ['claude-code', 'codex', 'opencode'] as const;
  for (const id of ids) nodes.push({ ...blank(`interface:${id}`, 'interface'), interfaceId: id });
  const kinds: HarnessNodeKind[] = ['agent', 'skill', 'agent', 'skill', 'tool', 'context-slice', 'agent', 'skill'];
  for (let i = 0; nodes.length < count; i += 1) nodes.push(blank(`n-${String(i).padStart(4, '0')}`, kinds[i % kinds.length]!));
  const edges: HarnessMapModel['edges'][number][] = [];
  const agents = nodes.filter(n => n.kind === 'agent'), others = nodes.filter(n => n.kind === 'skill' || n.kind === 'tool' || n.kind === 'context-slice');
  others.forEach((o, i) => {
    const a = agents[i % Math.max(1, agents.length)];
    if (a === undefined) return;
    const rel = o.kind === 'skill' ? 'uses' : o.kind === 'tool' ? 'has-tool' : 'reads';
    edges.push({ id: `${a.id}>${rel}>${o.id}`, from: a.id, to: o.id, rel, label: rel === 'has-tool' ? 'read only' : rel });
  });
  agents.forEach((a, i) => edges.push({ id: `${a.id}>lands-in>${nodes[1 + (i % 3)]!.id}`, from: a.id, to: nodes[1 + (i % 3)]!.id, rel: 'lands-in', label: 'lands in' }));
  const kept = nodes.slice(0, count), keptIds = new Set(kept.map(n => n.id));
  return { scopeId: 'synthetic', nodes: kept, edges: edges.filter(e => keptIds.has(e.from) && keptIds.has(e.to)) };
}
