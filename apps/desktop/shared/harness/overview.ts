/**
 * The Overview model (Task 2, journey 1 step 1.5): every place the first read found, drawn together in one read-only graph. This file is the contract of the model.
 * `overviewOf` turns the scan result already in the window (`HarnessState`, built by real-map.ts) and the folders main knows into groups of nodes. It asks main for
 * nothing, so it works right after the scan and after a restart (decision T2-D2 A). The layout, the culling, the arrow-key moves and the list are in
 * overview-layout.ts. Pure: no file, no clock, no random number, and no absolute path in any string it returns.
 */
import type { FolderInfo } from '../engine/types.js';
import { cleanLine } from '../real/redact.js';
import type { HarnessState, Part, PartKind, ScanSource } from './types.js';

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
 *
 * How it reads the scan:
 *  - A group is a source. A source with no `scope` is a project, and with no `label` it takes its name, because a source made before the Overview existed (the sample)
 *    carries neither. The label goes through the same rule as every shown text: one plain line, and never a full path.
 *  - A source's part ids that no part answers to are skipped; one part listed twice is shown once.
 *  - The reader keeps a skill of the home folder and the same skill of a project as two parts (an item is one scope, one kind and one name), so sharing is not found in the
 *    reader. Here two skills are the same when their `contentHash` is equal and not empty, in two or more groups. Two skills in one group stay two nodes.
 *  - Home groups keep the order of the scan (the reader lists the programs in a fixed order). Project groups follow: most nodes first, then name, then id.
 */
export function overviewOf(state: HarnessState, folders: readonly FolderInfo[]): Overview {
  const parts = new Map<string, Part>();
  for (const p of state.parts) if (!parts.has(p.id)) parts.set(p.id, p);
  const known = [...folders].filter(f => f.hasDefinition).sort((a, b) => compare(a.id, b.id));
  const built = state.sources.map((source, index) => ({ index, ...groupOf(source, parts, known) }));
  const home = built.filter(b => b.group.scope === 'home');
  const projects = built.filter(b => b.group.scope !== 'home')
    .sort((a, b) => b.group.nodes.length - a.group.nodes.length || compare(a.group.name.toLowerCase(), b.group.name.toLowerCase()) || compare(a.group.name, b.group.name) || compare(a.group.id, b.group.id) || a.index - b.index);
  return markShared([...home, ...projects]);
}

const KIND_ORDER: readonly PartKind[] = ['agent', 'skill', 'tool', 'context'];
/** Compares by code unit, so the order is the same on every computer and in every language setting. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const shown = (text: string): string => cleanLine(text);
/** A label is the folder in `~` form. A full path (a slash, a back slash or a drive at the front) is cut down to its last name. */
function labelOf(label: string): string {
  const one = shown(label);
  if (!/^(?:[\\/]|[A-Za-z]:)/.test(one)) return one;
  const last = one.split(/[\\/]/).filter(x => x !== '').at(-1) ?? '';
  return last === '' ? '…' : `…/${last}`;
}

/** A group and the content hash of each of its skills (by node id), which `markShared` reads and the Overview does not keep. */
interface Built { readonly group: OverviewGroup; readonly hashes: ReadonlyMap<string, string> }

function groupOf(source: ScanSource, parts: ReadonlyMap<string, Part>, folders: readonly FolderInfo[]): Built {
  const seen = new Set<string>(), held: Part[] = [];
  for (const id of source.partIds) { const part = parts.get(id); if (part !== undefined && !seen.has(id)) { seen.add(id); held.push(part); } }
  held.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name) || compare(a.id, b.id));
  const nodes: OverviewNode[] = held.map(part => nodeOf(source.id, part));
  const hashes = new Map<string, string>();
  held.forEach((part, i) => { if (part.kind === 'skill' && part.contentHash !== undefined && part.contentHash !== '') hashes.set(nodes[i]!.id, part.contentHash); });
  const at = new Map(held.map((part, i) => [part.id, i] as const));
  const edges: { edge: OverviewEdge; from: number; to: number }[] = [];
  const made = new Set<string>();
  for (const l of source.links ?? []) {
    const from = at.get(l.from), to = at.get(l.to);
    if (from === undefined || to === undefined || from === to || nodes[from]!.kind !== 'agent') continue;
    const id = `${nodes[from]!.id}>${nodes[to]!.id}`;
    if (!made.has(id)) { made.add(id); edges.push({ edge: { id, from: nodes[from]!.id, to: nodes[to]!.id }, from, to }); }
  }
  edges.sort((a, b) => a.from - b.from || a.to - b.to);
  const label = labelOf(source.label ?? source.name);
  const folder = folders.find(f => f.label === label);
  const count = (kind: PartKind): number => nodes.filter(n => n.kind === kind).length;
  const group: OverviewGroup = {
    id: source.id, name: shown(source.name), label, scope: source.scope ?? 'project',
    programs: source.interfaceName === '' || source.interfaceName === 'Notes' ? [] : [shown(source.interfaceName)],
    inBowerloom: folder !== undefined, folderId: folder?.id ?? null,
    counts: { agent: count('agent'), skill: count('skill'), tool: count('tool'), context: count('context') }, nodes, edges: edges.map(e => e.edge),
  };
  return { group, hashes };
}

function nodeOf(groupId: string, part: Part): OverviewNode {
  return {
    id: `${groupId}/${part.id}`, partId: part.id, kind: part.kind,
    ...(part.kind === 'tool' && part.toolKind !== undefined ? { toolKind: part.toolKind } : {}),
    ...(part.kind === 'tool' && part.toolKind === 'hook' ? { runsCode: true as const } : {}),
    name: shown(part.name), summary: shown(part.summary), sharedWith: [],
  };
}

/** Finds the skills with one content hash in two or more groups: fills `sharedWith` of each copy, and the `sharedKeys` table. */
function markShared(built: readonly Built[]): Overview {
  const holders = new Map<string, { node: string; group: string }[]>();
  for (const b of built) for (const n of b.group.nodes) { const hash = b.hashes.get(n.id); if (hash === undefined) continue; const list = holders.get(hash) ?? []; list.push({ node: n.id, group: b.group.id }); holders.set(hash, list); }
  const sharedKeys = new Map<string, readonly string[]>();
  const others = new Map<string, readonly string[]>();
  for (const [hash, list] of holders) {
    const groupIds = [...new Set(list.map(h => h.group))];
    if (groupIds.length < 2) continue;
    sharedKeys.set(hash, list.map(h => h.node));
    for (const h of list) others.set(h.node, groupIds.filter(g => g !== h.group));
  }
  const groups = built.map(b => ({ ...b.group, nodes: b.group.nodes.map(n => (others.has(n.id) ? { ...n, sharedWith: others.get(n.id)! } : n)) }));
  return { groups, sharedKeys };
}
