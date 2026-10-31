/**
 * The graph of a harness as plain geometry: where each node sits, what the edges are, how to fit the graph to a window, how to zoom, and the small map.
 * Pure functions, so the page only draws them. A node's place is saved in the manifest (`Harness.positions`); a node with no saved place gets the default place.
 * Units are graph units: 1 unit is 1 px at zoom 1. A view is `{ x, y, k }`: a point of the graph at (gx, gy) is drawn at (gx * k + x, gy * k + y).
 */
import type { Harness, HarnessState, PartKind, Point } from './types.js';
import { partsOf } from './status.js';

/** An agent is a taller card on the left; every other part is a smaller card on the right. */
export const NODE_SIZE = Object.freeze({ agent: { w: 208, h: 76 }, other: { w: 216, h: 60 } });
const LEFT_X = 48, RIGHT_X = 440, RIGHT_TOP = 40, RIGHT_PITCH = 76, AGENT_GAP = 12, AGENT_TOP = 70;
/** The room at the right of a missing part for its Fix button. */
const FIX_ROOM = 88;

export interface GraphNode {
  readonly id: string; readonly kind: PartKind; readonly name: string; readonly summary: string;
  readonly missing: boolean; readonly isNew: boolean;
  readonly x: number; readonly y: number; readonly w: number; readonly h: number;
}
export interface GraphEdge { readonly id: string; readonly from: string; readonly to: string; readonly missing: boolean }
export interface Bounds { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
export interface Graph { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[]; readonly bounds: Bounds }
export interface View { readonly x: number; readonly y: number; readonly k: number }

export const ZOOM_MIN = 0.4, ZOOM_MAX = 2, ZOOM_STEP = 1.2;

/** The graph of a harness. `moved` holds places that are being dragged right now and have not been saved yet. */
export function graphOf(state: HarnessState, harness: Harness, moved: Readonly<Record<string, Point>> = {}): Graph {
  const entries: { id: string; kind: PartKind; name: string; summary: string; missing: boolean; isNew: boolean }[] = [
    ...partsOf(state, harness).map(p => ({ id: p.id, kind: p.kind, name: p.name, summary: p.summary, missing: false, isNew: harness.newPartIds.includes(p.id) })),
    ...harness.missing.map(m => ({ id: m.id, kind: m.kind, name: m.name, summary: 'Missing. Needed.', missing: true, isNew: false })),
  ];
  const saved = (id: string): Point | undefined => moved[id] ?? harness.positions[id];
  const places = new Map<string, Point>();
  for (const e of entries) { const p = saved(e.id); if (p !== undefined) places.set(e.id, p); }
  // The other parts, in a column at the right, one slot each.
  let cursor = Math.max(RIGHT_TOP - RIGHT_PITCH, ...entries.filter(e => e.kind !== 'agent' && places.has(e.id)).map(e => places.get(e.id)!.y));
  for (const e of entries) if (e.kind !== 'agent' && !places.has(e.id)) { cursor += RIGHT_PITCH; places.set(e.id, { x: RIGHT_X, y: cursor }); }
  // The agents, in a column at the left, each level with the middle of the parts it uses, and never closer than a gap to the one above.
  const linked = (id: string): number[] => harness.links.filter(l => l.from === id && places.has(l.to)).map(l => places.get(l.to)!.y + NODE_SIZE.other.h / 2);
  let floor = Math.max(Number.NEGATIVE_INFINITY, ...entries.filter(e => e.kind === 'agent' && places.has(e.id)).map(e => places.get(e.id)!.y + NODE_SIZE.agent.h + AGENT_GAP));
  let slot = 0;
  for (const e of entries) {
    if (e.kind !== 'agent' || places.has(e.id)) continue;
    const ys = linked(e.id);
    const wanted = ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length - NODE_SIZE.agent.h / 2 : AGENT_TOP + slot * (NODE_SIZE.agent.h + AGENT_GAP);
    const y = Math.max(wanted, floor);
    places.set(e.id, { x: LEFT_X, y }); floor = y + NODE_SIZE.agent.h + AGENT_GAP; slot += 1;
  }
  const nodes: GraphNode[] = entries.map(e => {
    const at = places.get(e.id)!, size = e.kind === 'agent' ? NODE_SIZE.agent : NODE_SIZE.other;
    return { ...e, x: at.x, y: at.y, w: size.w, h: size.h };
  });
  const known = new Set(nodes.map(n => n.id));
  const missingIds = new Set(harness.missing.map(m => m.id));
  const edges: GraphEdge[] = harness.links.filter(l => known.has(l.from) && known.has(l.to)).map(l => ({ id: `${l.from}>${l.to}`, from: l.from, to: l.to, missing: missingIds.has(l.to) }));
  return { nodes, edges, bounds: boundsOf(nodes, harness.missing.length > 0 ? FIX_ROOM : 0) };
}

export function boundsOf(nodes: readonly GraphNode[], extraRight = 0): Bounds {
  if (nodes.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return {
    left: Math.min(...nodes.map(n => n.x)), top: Math.min(...nodes.map(n => n.y)),
    right: Math.max(...nodes.map(n => n.x + n.w)) + extraRight, bottom: Math.max(...nodes.map(n => n.y + n.h)),
  };
}

/** The curve of an edge, as SVG path text: out of the right edge of the agent, into the left edge of the part. */
export function edgePath(from: GraphNode, to: GraphNode): string {
  const x1 = from.x + from.w, y1 = from.y + from.h / 2, x2 = to.x, y2 = to.y + to.h / 2;
  const bend = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
}

/** The ids that stay bright when a node is selected: the node, and every node joined to it by an edge. */
export function brightIds(edges: readonly GraphEdge[], selectedId: string | null): ReadonlySet<string> | null {
  if (selectedId === null) return null;
  const out = new Set<string>([selectedId]);
  for (const e of edges) { if (e.from === selectedId) out.add(e.to); if (e.to === selectedId) out.add(e.from); }
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The view that shows the whole graph in a window of `width` by `height`, never larger than life, with `pad` around it. */
/** The height kept free at the foot of the stage for the legend line, so a fitted graph never sits under it (Goal 2, the 900 by 600 window). */
export const FIT_FOOT = 44;

export function fitView(bounds: Bounds, width: number, height: number, pad = 16, foot = 0): View {
  const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top, room = height - foot;
  if (w <= 0 || h <= 0 || width <= 0 || room <= 0) return { x: 0, y: 0, k: 1 };
  const k = clamp(Math.min((width - 2 * pad) / w, (room - 2 * pad) / h, 1), ZOOM_MIN, 1);
  return { x: (width - w * k) / 2 - bounds.left * k, y: (room - h * k) / 2 - bounds.top * k, k };
}

/** Zooms by `factor` about the screen point (cx, cy), which stays where it is. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = clamp(view.k * factor, ZOOM_MIN, ZOOM_MAX);
  const real = k / view.k;
  return { k, x: cx - (cx - view.x) * real, y: cy - (cy - view.y) * real };
}

/** The graph point under a screen point. */
export const toGraph = (view: View, sx: number, sy: number): Point => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });

/** The small map: each node as a bar, and the part of the graph that the window shows, all scaled into a box of `width` by `height`. */
export interface MiniMap { readonly bars: readonly { id: string; x: number; y: number; w: number; h: number }[]; readonly window: { x: number; y: number; w: number; h: number }; readonly scale: number }
export function miniMap(graph: Graph, view: View, viewW: number, viewH: number, width: number, height: number, pad = 8): MiniMap {
  const b = graph.bounds;
  const gw = Math.max(1, b.right - b.left), gh = Math.max(1, b.bottom - b.top);
  const scale = Math.min((width - 2 * pad) / gw, (height - 2 * pad) / gh);
  const ox = (width - gw * scale) / 2 - b.left * scale, oy = (height - gh * scale) / 2 - b.top * scale;
  const bars = graph.nodes.map(n => ({ id: n.id, x: n.x * scale + ox, y: n.y * scale + oy, w: n.w * scale, h: n.h * scale }));
  const topLeft = toGraph(view, 0, 0), bottomRight = toGraph(view, viewW, viewH);
  return { bars, scale, window: { x: topLeft.x * scale + ox, y: topLeft.y * scale + oy, w: (bottomRight.x - topLeft.x) * scale, h: (bottomRight.y - topLeft.y) * scale } };
}

/** The view that puts the graph point of a click on the small map in the middle of the window. */
export function centerOnMiniMap(map: MiniMap, view: View, viewW: number, viewH: number, mx: number, my: number): View {
  const gx = (mx - (map.window.x + map.window.w / 2)) / map.scale, gy = (my - (map.window.y + map.window.h / 2)) / map.scale;
  return { k: view.k, x: view.x - gx * view.k, y: view.y - gy * view.k };
}
