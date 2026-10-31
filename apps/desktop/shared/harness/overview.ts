/**
 * The Overview model (Task 2, journey 1 step 1.5): every place the first read found, drawn together in one read-only graph. This file is the contract of the model.
 * `overviewOf` turns the scan result already in the window (`HarnessState`, built by real-map.ts) and the folders main knows into groups of nodes. It asks main for
 * nothing, so it works right after the scan and after a restart (decision T2-D2 A). The layout, the culling, the arrow-key moves and the list are in
 * overview-layout.ts. Pure: no file, no clock, no random number, and no absolute path in any string it returns.
 *
 * STAGE 1: the types, the constants and the signatures are final. `overviewOf` throws `not built` until Task 2 lane G builds it.
 */
import type { FolderInfo } from '../engine/types.js';
import type { PartKind } from './types.js';
import type { HarnessState } from './types.js';

/** The tool kinds the reader finds. Only a tool has one. */
export type OverviewToolKind = 'mcp' | 'prompt' | 'hook';

/**
 * The bounds of the Overview. The layout and the screen both read them.
 *  - `expandedNodes`: a place is expanded by default while the nodes drawn in all expanded places stay under this number.
 *  - `expandAllMax`: "Expand all" is off above this many nodes in all.
 *  - `domNodes`: the most node elements the page holds at any zoom (`visibleOf` keeps to it).
 *  - `detailZoom`: under this zoom an expanded place draws as a box with counts only.
 *  - `cullMargin`: graph units added around the window before `visibleOf` culls.
 *  - `clusterWidth`: the fixed width of a place box, in graph units; places sit in a grid of this column width.
 *  - `smallScreen`: under this window width the List is the default view.
 */
export const OVERVIEW_LIMITS = Object.freeze({ expandedNodes: 150, expandAllMax: 400, domNodes: 400, detailZoom: 0.5, cullMargin: 200, clusterWidth: 720, smallScreen: 900 });

/**
 * One node of the Overview. `id` is `<group id>/<part id>`, so it is unique across the whole Overview even when two places hold the same skill. `partId` is the
 * part it shows (`Part.id`). `toolKind` is set for a tool; `runsCode` is true for a hook (and only then). `sharedWith` lists the ids of the OTHER groups that hold a
 * skill with the same content hash, in group order; it is empty for a node that is not shared. Names and summaries are the parts' own, already scrubbed.
 */
export interface OverviewNode {
  readonly id: string;
  readonly partId: string;
  readonly kind: PartKind;
  readonly toolKind?: OverviewToolKind;
  readonly runsCode?: true;
  readonly name: string;
  readonly summary: string;
  readonly sharedWith: readonly string[];
}

/** An edge from an agent node to a skill, tool or notes node of the same group, from the links the agent's file names. Never across groups. Ids are node ids. */
export interface OverviewEdge {
  /** `<from>><to>`. */
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface OverviewCounts { readonly agent: number; readonly skill: number; readonly tool: number; readonly context: number }

/**
 * One place: a scan source (`ScanSource`). The id is the source id.
 *  - `name` is the source's name ("Your Claude Code folder"); `label` is the folder in `~` form (`~` for the home folder), never a full path.
 *  - `scope` is `home` or `project`. `programs` lists the programs found there, by name, in the preview's order.
 *  - `inBowerloom` is true when `folders()` has a folder with the same `~` label that holds a harness; `folderId` is then that folder's id, else null.
 *  - `counts` equal the nodes by kind. `nodes` and `edges` are in a fixed order: agents, skills, tools, context, each by name then id.
 */
export interface OverviewGroup {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly scope: 'home' | 'project';
  readonly programs: readonly string[];
  readonly inBowerloom: boolean;
  readonly folderId: string | null;
  readonly counts: OverviewCounts;
  readonly nodes: readonly OverviewNode[];
  readonly edges: readonly OverviewEdge[];
}

/**
 * The Overview. `groups` are in this order: the home first, then the projects by part count (largest first), then by name. `sharedKeys` maps the content hash of a
 * skill held in more than one group to the ids of its nodes, in group order; a hash held in one group only is not in it.
 */
export interface Overview {
  readonly groups: readonly OverviewGroup[];
  readonly sharedKeys: ReadonlyMap<string, readonly string[]>;
}

/**
 * The Overview of a scan. `folders` are the folders main knows now (`engine.folders()`); the window never holds a path, so the match to a folder is by `~` label.
 * Deterministic: the same inputs give an equal Overview. A scan with no parts gives groups with no nodes, or none. Throws nothing for any input of the right type.
 * STAGE 1: throws `not built` until lane G builds it.
 */
export function overviewOf(state: HarnessState, folders: readonly FolderInfo[]): Overview { void state; void folders; throw new Error('not built'); }
