/**
 * The geometry of the Overview as plain data (Task 2): one box for each place, in a fixed grid; inside an expanded place the Builder's two columns (agents at the
 * left, every other part at the right, the slots of layout.ts); the cull that keeps the page under OVERVIEW_LIMITS.domNodes; the arrow-key move; and the list the
 * "List" view shows. Units are graph units, as in layout.ts. It reuses `GraphNode`, `Graph`, `View`, `Bounds`, `fitView`, `zoomAt`, `miniMap`, `centerOnMiniMap` and
 * `edgePath` from layout.ts; it does not change them (Task 0a owns that file).
 *
 * STAGE 1: the types and signatures are final. The functions throw `not built` until Task 2 lane G builds them.
 */
import type { PartKind } from './types.js';
import type { Bounds, Graph, GraphNode, View } from './layout.js';
import type { Overview, OverviewCounts, OverviewNode, OverviewToolKind } from './overview.js';

/** A node with its place. It is a `GraphNode`, so `edgePath` draws its edges. `x` and `y` are absolute graph units. */
export interface LaidNode extends GraphNode {
  readonly groupId: string;
  readonly toolKind?: OverviewToolKind;
  readonly runsCode?: true;
  readonly sharedWith: readonly string[];
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

/**
 * The layout of the Overview. `expanded` holds the ids of the groups drawn open. Deterministic: clusters sit in a grid of columns of OVERVIEW_LIMITS.clusterWidth,
 * filled in group order, each row as tall as its tallest box. The nodes of an expanded place use NODE_SIZE and the default slots of layout.ts. For 2,000 parts in
 * 30 groups it takes under 50 ms. STAGE 1: throws `not built`.
 */
export function layoutOf(overview: Overview, expanded: ReadonlySet<string>): OverviewLayout { void overview; void expanded; throw new Error('not built'); }

/** The ids of the groups to open on first draw: the home, then the others in group order, while the nodes drawn in all open groups stay under OVERVIEW_LIMITS.expandedNodes. */
export function defaultExpanded(overview: Overview): ReadonlySet<string> { void overview; throw new Error('not built'); }

/**
 * What the page draws now. `detail` is `nodes` at zoom OVERVIEW_LIMITS.detailZoom and above, and `boxes` under it (expanded places draw as boxes with counts only,
 * and `nodes` and `edges` are empty). `nodes` never holds more than OVERVIEW_LIMITS.domNodes ids. `edges` are the edges inside expanded places that are in view.
 */
export interface OverviewVisible {
  readonly detail: 'nodes' | 'boxes';
  readonly clusters: readonly string[];
  readonly nodes: readonly string[];
  readonly edges: readonly string[];
}
/**
 * The clusters, nodes and edges that meet a window of `width` by `height` screen pixels seen through `view`, plus `margin` graph units on every side (default
 * OVERVIEW_LIMITS.cullMargin). `selected` is a node id that stays in the set even when it is out of view. STAGE 1: throws `not built`.
 */
export function visibleOf(layout: OverviewLayout, view: View, width: number, height: number, margin?: number, selected?: string | null): OverviewVisible {
  void layout; void view; void width; void height; void margin; void selected; throw new Error('not built');
}

/** The thin dotted edges drawn for the selected node only: from it to each copy of the same skill in other places, in group order. Empty for a node that is not shared. STAGE 1: throws `not built`. */
export function sharedEdgesOf(layout: OverviewLayout, nodeId: string): readonly LaidEdge[] { void layout; void nodeId; throw new Error('not built'); }

export type Direction = 'up' | 'down' | 'left' | 'right';
/**
 * The nearest node from `id` in a direction, for the arrow keys. `among` limits the choice to those node ids (the visible set); with none, every laid node counts.
 * Null when there is none. Ties go to the smaller id, so the move is the same every time. STAGE 1: throws `not built`.
 */
export function neighbourOf(layout: OverviewLayout, id: string, direction: Direction, among?: ReadonlySet<string>): string | null {
  void layout; void id; void direction; void among; throw new Error('not built');
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
  readonly sections: readonly OverviewListSection[];
}
/** The List view's data, in group order. STAGE 1: throws `not built`. */
export function listOf(overview: Overview): readonly OverviewListGroup[] { void overview; throw new Error('not built'); }
