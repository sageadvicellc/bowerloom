/**
 * Where the nodes of the harness graph go. Pure and deterministic: the same model, size and pinned places always give the same places.
 *
 * The scope root sits at the top, centred. Below it, left to right: tools, slices, skills, then agents (a library group first), then interfaces.
 * Every kind has its own band, and a band is WRAPPED: a column holds at most `maxRows` nodes, taken from the height of the window, and the rest
 * wrap into more columns beside it. So 200 or 500 nodes make a wide, even block and never one tall, thin column. Nodes never overlap.
 * A place the person chose (`pinned`) always wins over the automatic place.
 */
import type { HarnessMapModel, HarnessNode, HarnessNodeKind } from './harnessmodel.js';

export interface Point { x: number; y: number }
/** Places by node id. */
export type Positions = Record<string, Point>;
/** The room the graph is shown in, in pixels. Only the height decides the rows. */
export interface LayoutSize { readonly width: number; readonly height: number }

/** Sizes in pixels. The canvas draws every node at `nodeWidth` by `nodeHeight`, so the two files agree. */
export const HARNESS_LAYOUT = Object.freeze({
  nodeWidth: 232, nodeHeight: 64,
  /** The gap between two columns of one band, and between two rows. */
  columnGap: 20, rowGap: 12,
  /** The gap between two bands. */
  bandGap: 64,
  /** The gap between the root and the bands below it. */
  rootGap: 48,
  /** Rows per column are never fewer than `minRows` nor more than `maxRowsLimit`. */
  minRows: 4, maxRowsLimit: 60,
  gridSnap: 8,
});

const BAND_OF: Readonly<Record<Exclude<HarnessNodeKind, 'scope'>, number>> = { 'context-slice': 1, tool: 0, skill: 2, group: 3, agent: 3, interface: 4 };

/** How many rows fit under the root in a window of this height. */
export function rowsFitting(height: number): number {
  const room = Number.isFinite(height) ? height - HARNESS_LAYOUT.nodeHeight - HARNESS_LAYOUT.rootGap : 0;
  const rows = Math.floor((room + HARNESS_LAYOUT.rowGap) / (HARNESS_LAYOUT.nodeHeight + HARNESS_LAYOUT.rowGap));
  return Math.max(HARNESS_LAYOUT.minRows, Math.min(HARNESS_LAYOUT.maxRowsLimit, rows));
}

/** How many nodes each band holds, left to right: tools, slices, skills, agents (with groups), interfaces. */
function bandCounts(nodes: readonly HarnessNode[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  for (const n of nodes) if (n.kind !== 'scope') counts[BAND_OF[n.kind]]! += 1;
  return counts;
}

/** The size of the block the bands make when no column holds more than `rows` nodes. Columns of one band are filled evenly. */
function blockSize(counts: readonly number[], rows: number): { width: number; height: number } {
  const { nodeWidth: w, nodeHeight: h, columnGap, rowGap, bandGap, rootGap } = HARNESS_LAYOUT;
  let width = 0, tallest = 0, bands = 0;
  for (const n of counts) {
    if (n === 0) continue;
    const columns = Math.ceil(n / rows), per = Math.ceil(n / columns);
    width += columns * w + (columns - 1) * columnGap; tallest = Math.max(tallest, per); bands += 1;
  }
  return { width: Math.max(w, width + Math.max(0, bands - 1) * bandGap), height: h + rootGap + (tallest === 0 ? 0 : tallest * (h + rowGap) - rowGap) };
}

/**
 * The most nodes one column may hold. With no model it is the rows that fit the window's height. With a model it is the row count that
 * lets the whole block show at the largest size in the window (the block is taller when the window is tall and wider when it is wide),
 * so a small window gets a block it can show, and 500 nodes never become one thin column or one flat strip. Between two row counts that
 * show the block equally large, the one whose shape is nearest the window's wins. Always between `minRows` and `maxRowsLimit`.
 */
export function maxRowsFor(size: LayoutSize, model?: { readonly nodes: readonly HarnessNode[] }): number {
  if (model === undefined) return rowsFitting(size.height);
  const counts = bandCounts(model.nodes), W = Math.max(1, size.width), H = Math.max(1, size.height);
  let best = rowsFitting(size.height), bestZoom = -1, bestShape = Infinity;
  for (let rows = HARNESS_LAYOUT.minRows; rows <= HARNESS_LAYOUT.maxRowsLimit; rows += 1) {
    const b = blockSize(counts, rows), zoom = Math.min(1, W / b.width, H / b.height), shape = Math.abs(Math.log((b.width / b.height) / (W / H)));
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
  const { nodeWidth: w, nodeHeight: h, columnGap, rowGap, bandGap, rootGap } = HARNESS_LAYOUT;
  const rows = maxRowsFor(size, model);
  const bands: HarnessNode[][] = [[], [], [], [], []];
  let root: HarnessNode | null = null;
  for (const n of model.nodes) { if (n.kind === 'scope') root ??= n; else bands[BAND_OF[n.kind]]!.push(n); }

  // Each band: how many columns, and how many rows in the tallest one. Columns are filled evenly, top to bottom.
  const shapes = bands.map(list => {
    const columns = Math.ceil(list.length / rows), perColumn = columns === 0 ? 0 : Math.ceil(list.length / columns);
    return { list, columns, perColumn };
  });
  const used = shapes.filter(s => s.columns > 0);
  const tallest = used.reduce((m, s) => Math.max(m, s.perColumn), 0);
  const top = root === null ? 0 : h + rootGap;
  const out = new Map<string, Point>();

  let x = 0;
  for (const s of used) {
    // The interfaces are few: they are centred against the tallest band instead of hugging the top.
    const isInterfaces = s.list[0]!.kind === 'interface';
    const offset = isInterfaces ? ((tallest - s.perColumn) * (h + rowGap)) / 2 : 0;
    s.list.forEach((n, i) => {
      const column = Math.floor(i / s.perColumn), row = i % s.perColumn;
      out.set(n.id, { x: x + column * (w + columnGap), y: top + offset + row * (h + rowGap) });
    });
    x += s.columns * w + (s.columns - 1) * columnGap + bandGap;
  }
  const width = Math.max(w, x - bandGap);
  if (root !== null) out.set(root.id, { x: (width - w) / 2, y: 0 });

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

/** The node whose box holds the point (a place is the top left corner of a node), skipping `excludeId`. Null when none does. Used to tell a drop on a node from a move. */
export function nodeAt(positions: Readonly<Record<string, Point>>, point: Point, excludeId: string): string | null {
  const { nodeWidth: w, nodeHeight: h } = HARNESS_LAYOUT;
  for (const [id, p] of Object.entries(positions)) {
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
    replacedBy: null, libraryPinned: false, newerVersion: false, runsCode: false, secretMissing: false, conflict: false, notInstalled: false, groupId: null, memberCount: null, expanded: false, badges: [],
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
