/**
 * The geometry of the lasso on the knowledge graph. Pure: points in, ids out. Coordinates are plain numbers in one space; the caller
 * converts screen points to graph points first (force-graph's screen2GraphCoords), so a loop drawn on screen picks the pages under it.
 */

export interface Point { readonly x: number; readonly y: number }
export interface Bounds { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
/** A page on the graph. Its place is unset until the layout has run. */
export interface PlacedNode { readonly id: string; readonly x?: number; readonly y?: number }
/** `replace` makes a new pick, `add` (Shift) joins the old one, `remove` (Alt) takes pages out of it. */
export type LassoMode = 'replace' | 'add' | 'remove';

/** Alt removes, Shift adds, no key replaces. With both keys, Alt wins. */
export function lassoMode(keys: { readonly shiftKey: boolean; readonly altKey: boolean }): LassoMode {
  return keys.altKey ? 'remove' : keys.shiftKey ? 'add' : 'replace';
}

/** The box around a loop, or null for no points. */
export function polygonBounds(points: readonly Point[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { minX, minY, maxX, maxY };
}

/** Whether a point is inside a loop (the even-odd rule, so a loop that crosses itself still works). Fewer than three points is no loop. */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The ids of the nodes inside the loop, in node order. A cheap box test comes first, so only the nodes near the loop get the full test. */
export function nodesInPolygon(nodes: readonly PlacedNode[], polygon: readonly Point[], bounds: Bounds | null = polygonBounds(polygon)): string[] {
  if (bounds === null || polygon.length < 3) return [];
  const out: string[] = [];
  for (const n of nodes) {
    const x = n.x, y = n.y;
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) continue;
    if (pointInPolygon({ x, y }, polygon)) out.push(n.id);
  }
  return out;
}

/** The id of the node nearest to a point, if one is within `maxDistance`. */
export function nearestNode(nodes: readonly PlacedNode[], p: Point, maxDistance: number): string | null {
  let best: string | null = null, bestSq = maxDistance * maxDistance;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    const dx = n.x - p.x, dy = n.y - p.y, d = dx * dx + dy * dy;
    if (d <= bestSq) { bestSq = d; best = n.id; }
  }
  return best;
}

/** Adds a point to a path only when it is at least `minDistance` from the last one, so a long drag stays small. Changes `path`. */
export function thinPath(path: Point[], p: Point, minDistance: number): void {
  const last = path[path.length - 1];
  if (last === undefined || (p.x - last.x) ** 2 + (p.y - last.y) ** 2 >= minDistance * minDistance) path.push(p);
}

/** The new pick after a loop: the loop's pages replace, join, or leave the old pick. No repeats; the old order is kept. */
export function combinePicks(current: readonly string[], found: readonly string[], mode: LassoMode): string[] {
  if (mode === 'replace') return [...new Set(found)];
  if (mode === 'add') return [...new Set([...current, ...found])];
  const gone = new Set(found);
  return current.filter(id => !gone.has(id));
}
