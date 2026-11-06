/**
 * The Overview model (journey 1 step 1.5): every place the first read found, drawn together in one read-only graph. This file is the contract of the model.
 * `overviewOf` turns the scan result already in the window (`HarnessState`, built by real-map.ts) and the folders main knows into groups of nodes. It asks main for
 * nothing, so it works right after the scan and after a restart (decision T2-D2 A). The layout, the culling, the arrow-key moves and the list are in
 * overview-layout.ts. Pure: no file, no clock, no random number, and no absolute path in any string it returns.
 */
import type { FolderInfo } from '../engine/types.js';
import { cleanLine } from '../real/redact.js';
import type { HarnessPlace, HarnessState, Part, PartKind, ScanSource } from './types.js';

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
 * skill with the same content hash, in group order; it is empty for a node that is not shared. Names and summaries are the parts' own, made one plain line, with any full path in them cut down to `…/<last name>`.
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
  /**
   * Set only on a node that is shared (`sharedWith` is not empty): an opaque key that every copy of the skill has in common, here the content hash. Two nodes are copies of one
   * another when their keys are equal. It is a hash, never a path.
   */
  readonly shareKey?: string;
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
  /** A plain line for the place, or absent. It is `HARNESS_UNREADABLE` for a folder whose harness could not be read (the place then has no node). */
  readonly note?: string;
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

/** The line a place shows when the harness in its folder could not be read. */
export const HARNESS_UNREADABLE = 'Bowerloom could not read this harness.';

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
 *  - A folder that holds a harness (`HarnessState.harnessPlaces`) is a project place of its own, built from the parts the loader read. Its programs are the engines of the harness.
 *  - Home groups keep the order of the scan (the reader lists the programs in a fixed order). Project groups follow: most nodes first, then name, then id.
 */
export function overviewOf(state: HarnessState, folders: readonly FolderInfo[]): Overview {
  const parts = new Map<string, Part>();
  for (const p of state.parts) if (!parts.has(p.id)) parts.set(p.id, p);
  const known = [...folders].filter(f => f.hasDefinition).sort((a, b) => compare(a.id, b.id));
  // A folder main knows has its own place, which reads In Bowerloom, so its harness place is not drawn. Any other harness place is drawn; when the folder's `.bowerloom` also has items the harness
  // does not hold (it names the harness place), the two are one group, and a skill both hold is listed once.
  const places = state.harnessPlaces ?? [], isKnown = (h: HarnessPlace): boolean => known.some(f => f.label === labelOf(h.label)), byId = new Map(places.map(h => [h.id, h] as const)), joined = new Set<string>();
  const made = state.sources.map((source, index) => {
    const place = source.harnessPlaceId === undefined ? undefined : byId.get(source.harnessPlaceId);
    if (place === undefined || isKnown(place)) return { index, ...groupOf(source, parts, known) };
    joined.add(place.id);
    return { index, ...joinedGroupOf(place, source, parts, known) };
  });
  // The folders that hold a harness and that main does not know: a place each (a folder main knows has its own place, which reads In Bowerloom).
  const harnesses = places.filter(h => !isKnown(h) && !joined.has(h.id)).map((h, i) => harnessGroupOf(h, made.length + i, known));
  const built = [...made, ...harnesses];
  const home = built.filter(b => b.group.scope === 'home');
  const projects = built.filter(b => b.group.scope !== 'home')
    .sort((a, b) => b.group.nodes.length - a.group.nodes.length || compare(a.group.name.toLowerCase(), b.group.name.toLowerCase()) || compare(a.group.name, b.group.name) || compare(a.group.id, b.group.id) || a.index - b.index);
  return markShared([...home, ...projects]);
}

/** The parts of a harness place, as the Overview draws them. */
const harnessPartsOf = (place: HarnessPlace): Part[] => place.parts.map(p => ({
  id: p.id, kind: p.kind, name: p.name, summary: p.summary, description: '', path: '', source: '', origin: place.id, fileText: '', cannotUse: [], inLibrary: true, ...(p.toolKind === undefined ? {} : { toolKind: p.toolKind }), ...(p.contentHash === undefined ? {} : { contentHash: p.contentHash }),
}));

function harnessGroupOf(place: HarnessPlace, index: number, folders: readonly FolderInfo[]): { index: number; group: OverviewGroup; hashes: ReadonlyMap<string, string> } {
  const partList = harnessPartsOf(place);
  const source: ScanSource = { id: place.id, name: place.name, interfaceName: '', harnessName: place.name, partIds: partList.map(p => p.id), links: place.links, scope: 'project', label: place.label };
  const built = groupOf(source, new Map(partList.map(p => [p.id, p])), folders);
  const group: OverviewGroup = { ...built.group, programs: place.engines.map(shown), ...(place.readable ? {} : { note: HARNESS_UNREADABLE }) };
  return { index, group, hashes: built.hashes };
}

/** The key two copies of one skill share: its text (when the reader hashed it) and its name, cut the same way on both sides. */
const skillKey = (part: Part): string => `${part.contentHash ?? ''}\u0000${shown(part.name).replace(/…$/, '').slice(0, 60).toLowerCase()}`;

/**
 * One group for a folder that holds a harness and also has items of its own in its `.bowerloom`. It is the harness place with the items of the source added. A skill that both hold
 * (the same text and name) is the harness place's node, once: links the source makes to the skill go to that node. A harness that could not be read keeps its note and the source's items.
 */
function joinedGroupOf(place: HarnessPlace, source: ScanSource, parts: ReadonlyMap<string, Part>, folders: readonly FolderInfo[]): { group: OverviewGroup; hashes: ReadonlyMap<string, string> } {
  const own = harnessPartsOf(place), seen = new Map<string, string[]>();
  for (const part of own) if (part.kind === 'skill') seen.set(skillKey(part), [...(seen.get(skillKey(part)) ?? []), part.id]);
  const all = new Map(own.map(p => [p.id, p] as const)), ids = own.map(p => p.id), moved = new Map<string, string>();
  for (const id of source.partIds) {
    const part = parts.get(id);
    if (part === undefined || all.has(id)) continue;
    const twin = part.kind === 'skill' ? seen.get(skillKey(part))?.shift() : undefined;
    if (twin !== undefined) { moved.set(id, twin); continue; }
    all.set(id, part); ids.push(id);
  }
  const links = [...place.links, ...(source.links ?? []).map(l => ({ from: moved.get(l.from) ?? l.from, to: moved.get(l.to) ?? l.to }))];
  const joined: ScanSource = { id: place.id, name: place.name, interfaceName: '', harnessName: place.name, partIds: ids, links, scope: 'project', label: place.label };
  const built = groupOf(joined, all, folders);
  return { group: { ...built.group, programs: place.engines.map(shown), ...(place.readable ? {} : { note: HARNESS_UNREADABLE }) }, hashes: built.hashes };
}

const KIND_ORDER: readonly PartKind[] = ['agent', 'skill', 'tool', 'context'];
/** Compares by code unit, so the order is the same on every computer and in every language setting. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/*
 * A full path in a text is cut down to its last name, and the home folder of a person to `~`. What counts as a full path:
 *  - a rooted path of two or more names (`/etc/hosts`), a drive path (`C:\x`), a UNC path (`\\server\share`), either slash, and `file://` in front;
 *  - it starts at the start of the text, or after a space or one of ( " ' ` = : , ; [ < { | >, and it ends at a space or at one of " ' ` < > [ ] { } | ) , ;
 *  - a name in the middle of a path may hold spaces when each word after the first starts with a capital letter or a digit (`Hanna Sage`, `Sage Advice`), so the home folder
 *    name does not survive; the last name may not hold a space.
 *  - `/Users/<name>`, `/home/<name>` and `C:\Users\<name>` with nothing after them are `~`. A full stop, `!` or `?` at the end of a path is not part of it.
 *  - The name of a home folder is cut first, in any case, when a separator follows it (see `HOME_FOLDER`).
 * `~/…` paths, URLs with a host, and words like and/or are left as they are. Known false hits, kept: `GET /v1/messages` reads as a path of two names, and `a:/b` as a drive.
 * The pattern is written with escapes for the quote characters, because the banned-word scan of the sources reads a quote inside a pattern as the start of a string.
 */
const SEP = String.raw`[\\/]`;
const STOPS = String.raw`\\/\x22\x27\x60<>\[\]{}|),;`;
const SEG = String.raw`[^\s${STOPS}]`;
/** The last character of a name in a path: not a full stop, `!` or `?`, so the end of a sentence stays outside the path. */
const END = String.raw`[^\s${STOPS}.!?]`;
const SEGS = `${SEG}+(?: [A-Z0-9]${SEG}*)*`;
const LAST = `${SEG}*${END}`;
const HOME_NAME = `${LAST}(?: [A-Z0-9]${LAST})*`;
const ROOT = String.raw`(?:[A-Za-z]:[\\/]|\\\\|[\\/])`;
const START = String.raw`(?<=^|[\s(\x22\x27\x60=:,;\[<{|>])`;
const FULL_PATH = new RegExp(
  `${START}(?:file:\\/\\/)?(?:` +
  [`${ROOT}(?:${SEGS}${SEP}){2,}${LAST}${SEP}?`, `${ROOT}(?:[Uu]sers|[Hh]ome)${SEP}${HOME_NAME}${SEP}?`, `${ROOT}${SEGS}${SEP}${LAST}${SEP}?`, `[A-Za-z]:${SEP}${LAST}${SEP}?`].join('|') + ')',
  'g',
);
/**
 * The name of a home folder, before the cut: what follows `/Users/`, `/home/` or `C:\Users\` up to the next separator, in any case, when a separator does follow. It is at most 60
 * characters and 4 words, does not start or end with a space, and holds no quote, bracket, comma or semicolon. So `/Users/my projects/x` loses the whole name, and
 * `/Users/hanna and /etc/hosts` (the name would end with a space) is two paths. A home folder with no separator after it is left to the pattern above.
 */
const HOME_FOLDER = new RegExp(
  `${START}((?:file:\\/\\/)?${ROOT}(?:[^\\s${STOPS}]+${SEP}){0,6}(?:[Uu]sers|[Hh]ome)${SEP})([^\\s${STOPS}](?:[^${STOPS}]{0,58}[^\\s${STOPS}])?)(?=${SEP})`,
  'g',
);
function shortPaths(text: string): string {
  const named = text.replace(HOME_FOLDER, (found, front: string, name: string) => (name.split(/\s+/).length <= 4 ? `${front}_` : found));
  return named.replace(FULL_PATH, found => {
    const names = found.replace(/^file:\/\//, '').replace(/^[A-Za-z]:(?=[\\/])/, '').split(/[\\/]/).filter(x => x !== '');
    return names.length === 2 && /^(?:users|home)$/i.test(names[0]!) ? '~' : `…/${names.at(-1) ?? ''}`;
  });
}
const shown = (text: string): string => shortPaths(cleanLine(text));
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
  const others = new Map<string, readonly string[]>(), keys = new Map<string, string>();
  for (const [hash, list] of holders) {
    const groupIds = [...new Set(list.map(h => h.group))];
    if (groupIds.length < 2) continue;
    sharedKeys.set(hash, list.map(h => h.node));
    for (const h of list) others.set(h.node, groupIds.filter(g => g !== h.group));
    for (const h of list) keys.set(h.node, hash);
  }
  const groups = built.map(b => ({ ...b.group, nodes: b.group.nodes.map(n => (others.has(n.id) ? { ...n, sharedWith: others.get(n.id)!, shareKey: keys.get(n.id)! } : n)) }));
  return { groups, sharedKeys };
}
