/**
 * What the Overview screen decides, apart from the screen: which view shows, which places are open, what a place offers, which cards stay bright, and how a
 * move of the keyboard keeps a card in the window. Pure: no DOM, no clock. The model it reads is shared/harness/overview.ts and its layout is shared/harness/overview-layout.ts.
 * Nothing here writes: the Overview is read-only, and the only way out of it is a route (the builder) or the system folder chooser.
 */
import type { PartKind } from '../../../shared/harness/types.js';
import { ZOOM_MAX } from '../../../shared/harness/layout.js';
import type { Bounds, View } from '../../../shared/harness/layout.js';
export { NO_INSETS, OVERLAY_INSETS, revealView } from './reveal-view.js';
export type { Insets } from './reveal-view.js';
import { OVERVIEW_LIMITS } from '../../../shared/harness/overview.js';
import type { Overview, OverviewGroup, OverviewNode } from '../../../shared/harness/overview.js';
import { defaultExpanded } from '../../../shared/harness/overview-layout.js';

export type OverviewView = 'graph' | 'list';

/** The view that shows: the one the person chose, else the List in a window under OVERVIEW_LIMITS.smallScreen wide, else the Graph. */
export const viewFor = (chosen: OverviewView | null, width: number): OverviewView => chosen ?? (width < OVERVIEW_LIMITS.smallScreen ? 'list' : 'graph');

/** A node with its place, found by node id. */
export interface Located { readonly node: OverviewNode; readonly group: OverviewGroup }
/** The Overview indexed once: a node by id, and the nodes each agent uses or each part is used by (from the edges the files name). */
export interface OverviewIndex {
  readonly nodes: number;
  node(id: string): Located | undefined;
  group(id: string): OverviewGroup | undefined;
  /** The node ids an agent uses, in edge order. */
  uses(id: string): readonly string[];
  /** The node ids of the agents that use a part, in edge order. */
  usedBy(id: string): readonly string[];
}

export function indexOverview(overview: Overview): OverviewIndex {
  const nodes = new Map<string, Located>(), groups = new Map<string, OverviewGroup>(), uses = new Map<string, string[]>(), usedBy = new Map<string, string[]>();
  let count = 0;
  for (const group of overview.groups) {
    groups.set(group.id, group);
    for (const node of group.nodes) { nodes.set(node.id, { node, group }); count += 1; }
    for (const e of group.edges) {
      const out = uses.get(e.from) ?? [], into = usedBy.get(e.to) ?? [];
      out.push(e.to); into.push(e.from);
      uses.set(e.from, out); usedBy.set(e.to, into);
    }
  }
  return { nodes: count, node: id => nodes.get(id), group: id => groups.get(id), uses: id => uses.get(id) ?? [], usedBy: id => usedBy.get(id) ?? [] };
}

/** How many of each kind an agent uses, for its name and its details. */
export function usesCounts(index: OverviewIndex, id: string): Partial<Record<PartKind, number>> {
  const out: Partial<Record<PartKind, number>> = {};
  for (const to of index.uses(id)) { const found = index.node(to); if (found !== undefined) out[found.node.kind] = (out[found.node.kind] ?? 0) + 1; }
  return out;
}

// ---- Which places are open ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The places drawn open: the default rule (shared/harness/overview-layout.ts `defaultExpanded`), changed by what the person pressed. `overrides` maps a group id to the
 * person's choice; a group the person never touched follows the rule, so a place that appears later (a second read) is open or shut by the rule.
 */
export function expandedOf(overview: Overview, overrides: ReadonlyMap<string, boolean>): ReadonlySet<string> {
  const rule = defaultExpanded(overview), open = new Set<string>();
  for (const g of overview.groups) if (overrides.get(g.id) ?? rule.has(g.id)) open.add(g.id);
  return open;
}
/** The overrides after the person presses one place: it flips from what it shows now. */
export function toggledOverrides(overrides: ReadonlyMap<string, boolean>, id: string, openNow: boolean): ReadonlyMap<string, boolean> {
  return new Map(overrides).set(id, !openNow);
}
/** Every place open, or every place shut. */
export const allOverrides = (overview: Overview, open: boolean): ReadonlyMap<string, boolean> => new Map(overview.groups.map(g => [g.id, open] as const));
/** "Expand all" is off above OVERVIEW_LIMITS.expandAllMax nodes in all. */
export const canExpandAll = (index: OverviewIndex): boolean => index.nodes <= OVERVIEW_LIMITS.expandAllMax;

// ---- What a place offers -----------------------------------------------------------------------------------------------------------------------------------

/** True for the home folder (`~`) or a folder under it (`~/name`). Any other label (`…/name`, a full path cut down) is a folder outside home, or one the reader gave no label. */
export const isHomeLabel = (label: string): boolean => label === '~' || label.startsWith('~/');
/**
 * What the place says about itself. `in`: a place under home that main knows to hold a harness. `not-in`: a place under home that main does not know to hold one. `unknown`: a place
 * outside home, which main knows only by its full path, so the Overview cannot tell. It says nothing then, and never claims "In Bowerloom", whatever the model matched: the screen
 * does not rely on label matching for a place outside home.
 */
export type PlaceStatus = 'in' | 'not-in' | 'unknown';
export function placeStatus(group: OverviewGroup): PlaceStatus {
  if (!isHomeLabel(group.label)) return 'unknown';
  return group.inBowerloom ? 'in' : 'not-in';
}
/** The button of a place: "Open in builder" when it is under home and main knows the folder with a harness, else "Choose this folder". */
export const placeAction = (group: OverviewGroup): 'open' | 'choose' => (isHomeLabel(group.label) && group.inBowerloom && group.folderId !== null ? 'open' : 'choose');

/** The last name of a folder label or a full path, or '' when it has none. */
const lastName = (text: string): string => text.split(/[\\/]/).filter(x => x !== '' && x !== '…').at(-1) ?? '';
/**
 * True when the folder the person chose (the label main gives back) is the folder the place shows. A place under home has a `~` label and must match it exactly. A place outside
 * home has a label cut down to `…/name` (the window never holds the full path), so only the last name can be compared: a folder outside home with that name passes, any other is refused,
 * and so is any folder under home.
 */
export function chosenMatches(group: OverviewGroup, chosenLabel: string): boolean {
  // A place cut down to `…/name` came from a path outside home, so a folder under home can never be it.
  if (group.label.startsWith('…')) { if (isHomeLabel(chosenLabel)) return false; const want = lastName(group.label); return want !== '' && lastName(chosenLabel) === want; }
  return chosenLabel === group.label;
}

// ---- Selection ---------------------------------------------------------------------------------------------------------------------------------------------

/** The places a selected part is in: its own first, then each place that holds a copy (`sharedWith`, in group order). */
export function placesOf(index: OverviewIndex, id: string): readonly OverviewGroup[] {
  const found = index.node(id);
  if (found === undefined) return [];
  return [found.group, ...found.node.sharedWith.map(g => index.group(g)).filter((g): g is OverviewGroup => g !== undefined)];
}
/** The node ids of every copy of a selected shared skill, itself included, in group order. Just the node when it is not shared. */
export function copiesOf(overview: Overview, node: OverviewNode): readonly string[] {
  if (node.shareKey === undefined) return [node.id];
  return overview.sharedKeys.get(node.shareKey) ?? [node.id];
}
/**
 * The node ids that stay bright when one is selected: the node, every copy of it, and the parts it is joined to by an edge. Null when nothing is selected (every node is bright).
 * A selected id the Overview does not hold gives null as well.
 */
export function brightOf(overview: Overview, index: OverviewIndex, selectedId: string | null): ReadonlySet<string> | null {
  const found = selectedId === null ? undefined : index.node(selectedId);
  if (found === undefined) return null;
  return new Set<string>([found.node.id, ...copiesOf(overview, found.node), ...index.uses(found.node.id), ...index.usedBy(found.node.id)]);
}
/** The ids of the places that hold a copy of the selected part, for a soft mark on their boxes. */
export function litPlaces(overview: Overview, index: OverviewIndex, selectedId: string | null): ReadonlySet<string> {
  const found = selectedId === null ? undefined : index.node(selectedId);
  if (found === undefined || found.node.shareKey === undefined) return new Set();
  return new Set(copiesOf(overview, found.node).map(id => index.node(id)?.group.id).filter((g): g is string => g !== undefined));
}

// ---- The window --------------------------------------------------------------------------------------------------------------------------------------------

/** The Overview's own zoom floor, for fit and zoom out. The Builder's floor (layout.ts, 0.4) is not changed. */
export const OVERVIEW_ZOOM_MIN = 0.15;
const clampK = (k: number): number => Math.min(ZOOM_MAX, Math.max(OVERVIEW_ZOOM_MIN, k));
/**
 * The view that shows the whole graph in a window, at most life size, never under OVERVIEW_ZOOM_MIN, with `pad` around it and `foot` kept free at the foot. When the graph does not
 * fit even at the floor, its top left is in the corner (the headers of the first row show) and not the middle of it.
 */
export function overviewFit(bounds: Bounds, width: number, height: number, pad = 16, foot = 0): View {
  const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top, room = height - foot;
  if (w <= 0 || h <= 0 || width <= 0 || room <= 0) return { x: 0, y: 0, k: 1 };
  const k = clampK(Math.min((width - 2 * pad) / w, (room - 2 * pad) / h, 1));
  const x = width - w * k >= 2 * pad ? (width - w * k) / 2 - bounds.left * k : pad - bounds.left * k;
  const y = room - h * k >= 2 * pad ? (room - h * k) / 2 - bounds.top * k : pad - bounds.top * k;
  return { x, y, k };
}
/** Zooms by `factor` about the window point (cx, cy), which stays where it is, between OVERVIEW_ZOOM_MIN and the Builder's top zoom. */
export function overviewZoomAt(view: View, factor: number, cx: number, cy: number): View {
  const k = clampK(view.k * factor), real = k / view.k;
  return { k, x: cx - (cx - view.x) * real, y: cy - (cy - view.y) * real };
}

/** The place next to this one for the arrow keys on a header: left and right step through the places in order, up and down move a row of the grid. Null at an end. */
export function neighbourPlace(ids: readonly string[], from: string, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', columns: number): string | null {
  const at = ids.indexOf(from);
  if (at < 0) return null;
  const step = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -Math.max(1, columns) : Math.max(1, columns);
  return ids[at + step] ?? null;
}
