/**
 * The harness graph as nodes and edges (spec sections 2, 6.3, 6.4 and 6.13). Pure: it reads a World and a view and returns a model. It reads no
 * file, no clock and no random number, and it changes nothing it is given. The canvas draws the model and holds no world of its own.
 *
 * What is drawn, for one scope:
 *  - The scope itself is the root. The scope's own items are drawn solid. In a project, the items it inherits are drawn faded
 *    (`inherited`) when `showInherited` is true.
 *  - An override can hide an inherited item. A hidden item stays in the model as a ghost (`hidden`) so it can be shown again, and it has no edges.
 *    A ghost is drawn only while `showInherited` is true, because it stands for an inherited item.
 *  - An override can replace an inherited item. The old item stays, marked `replaced`, and a `replaces` edge runs from the new item to it.
 *    Agents that used the old item are drawn using the new one.
 *  - Items of an installed library are not drawn one by one. Each library is one `group` node ("Evergreen Kit, 120 agents"). A group opens when
 *    its id (`group:<library id>`, or the bare library id) is in `expandedGroups`.
 *  - Interfaces are nodes. An item lands in an interface only when that interface is installed.
 */
import type { AccessClass, AgentItem, HarnessItem, InterfaceId, InterfaceInfo, LibrarySource, Override, Scope, ToolKind, World } from './types.js';
import { describeRule } from './slicerule.js';
import { hashesDiffer } from './common.js';
import { INTERFACE_WORDS, interfaceName } from './words.js';

/** The kinds of node on the canvas. A library is one `group`. */
export type HarnessNodeKind = 'scope' | 'interface' | 'skill' | 'agent' | 'tool' | 'context-slice' | 'group';

/** What a person chose to look at: one scope, whether inherited items show, an optional single interface, and the library groups that are open. */
export interface HarnessView { readonly scopeId: string; readonly showInherited: boolean; readonly interfaceFilter?: InterfaceId; readonly expandedGroups: readonly string[] }

/** One node. Every state flag is always present (true or false). `badges` holds the same states as plain words, so a state is never carried by colour alone. */
export interface HarnessNode {
  /** An item keeps its own id. Other ids are `scope:<id>`, `interface:<id>` and `group:<library id>`. */
  readonly id: string;
  readonly kind: HarnessNodeKind;
  /** Set for a tool, null otherwise. */
  readonly toolKind: ToolKind | null;
  /** Set for an interface node, null otherwise. */
  readonly interfaceId: InterfaceId | null;
  /** The kind in plain words, such as "Skill" or "Tool · hook". */
  readonly kindLabel: string;
  readonly label: string;
  /** One short line. */
  readonly detail: string;
  /** The scope that owns the item. For a scope node, that scope. */
  readonly scopeId: string;
  /** The name of the scope this item is inherited from, or null. */
  readonly fromScope: string | null;
  readonly inherited: boolean;
  /** An override hides this inherited item. It is drawn as a ghost and has no edges. */
  readonly hidden: boolean;
  /** An override replaces this inherited item. `replacedBy` is the node that replaces it. */
  readonly replaced: boolean;
  readonly replacedBy: string | null;
  /** The item comes from an installed library: read-only and pinned to a version. */
  readonly libraryPinned: boolean;
  /** A newer version of the library, or of this library item, is waiting. */
  readonly newerVersion: boolean;
  /** A hook: it runs code with no prompt. */
  readonly runsCode: boolean;
  /** An MCP tool whose secret reference points at nothing. */
  readonly secretMissing: boolean;
  /** The item is found in several interfaces with different text. */
  readonly conflict: boolean;
  /** An interface that was not found on this computer. */
  readonly notInstalled: boolean;
  /** For a library item drawn on its own: the id of its group node. */
  readonly groupId: string | null;
  /** For a group: how many items it holds that are not hidden. Null for other nodes. */
  readonly memberCount: number | null;
  /** For a group: true when its items are drawn one by one. */
  readonly expanded: boolean;
  readonly badges: readonly string[];
}

/** What a wire means. `uses`: an agent uses a skill. `has-tool`: an agent has a tool. `reads`: an agent reads a slice. `lands-in`: an item is written to an interface. `replaces`: a new item stands in for an inherited one. */
export type HarnessEdgeRel = 'uses' | 'has-tool' | 'reads' | 'lands-in' | 'replaces';

/** One wire. `label` is plain words: the access class for a tool, otherwise the meaning of the wire. */
export interface HarnessEdge { readonly id: string; readonly from: string; readonly to: string; readonly rel: HarnessEdgeRel; readonly label: string }

/** The whole graph for one view. */
export interface HarnessMapModel { readonly scopeId: string; readonly nodes: readonly HarnessNode[]; readonly edges: readonly HarnessEdge[] }

/** The words on the wires. */
export const HARNESS_REL_WORDS: Readonly<Record<HarnessEdgeRel, string>> = Object.freeze({ uses: 'uses', 'has-tool': 'has tool', reads: 'reads', 'lands-in': 'lands in', replaces: 'replaces' });

/**
 * The words for an access class on a wire. PLACEHOLDER: the real class names are still open (spec 6.13 and 13), so these are the only place they are spelled out.
 */
export const ACCESS_WORDS: Readonly<Record<AccessClass, string>> = Object.freeze({ 'read-only': 'read only', 'read-write': 'read and write' });

export { interfaceName };

const KIND_ORDER: Readonly<Record<HarnessNodeKind, number>> = Object.freeze({ scope: 0, interface: 1, group: 2, agent: 3, skill: 4, tool: 5, 'context-slice': 6 });
const MANY: Readonly<Record<string, readonly [string, string]>> = { skill: ['skill', 'skills'], agent: ['agent', 'agents'], tool: ['tool', 'tools'], 'context-slice': ['slice', 'slices'] };
const plural = (n: number, kind: string): string => { const pair = MANY[kind] ?? ['item', 'items']; return `${n} ${n === 1 ? pair[0] : pair[1]}`; };
const short = (text: string, max = 90): string => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`; };

const TOOL_LABEL: Readonly<Record<ToolKind, string>> = { mcp: 'Tool · MCP', prompt: 'Tool · prompt', hook: 'Tool · hook' };
const kindLabelOf = (item: HarnessItem): string => (item.kind === 'tool' ? TOOL_LABEL[item.toolKind] : item.kind === 'context-slice' ? 'Slice' : item.kind === 'skill' ? 'Skill' : 'Agent');

/** A group's id from a library id. */
export const groupIdOf = (libraryId: string): string => `group:${libraryId}`;
/** The id of a scope's node. */
export const scopeNodeId = (scopeId: string): string => `scope:${scopeId}`;
/** The id of an interface's node. */
export const interfaceNodeId = (id: InterfaceId): string => `interface:${id}`;

const badgesOf = (n: Omit<HarnessNode, 'badges'>, extras: readonly string[]): string[] => {
  const out: string[] = [];
  if (n.hidden) out.push('hidden');
  else if (n.replaced) out.push('replaced');
  else if (n.inherited) out.push('inherited');
  if (n.runsCode) out.push('runs code');
  if (n.secretMissing) out.push('secret missing');
  if (n.conflict) out.push('conflict');
  if (n.newerVersion) out.push('new version');
  if (n.libraryPinned && n.kind !== 'group') out.push('library');
  if (n.notInstalled) out.push('not installed');
  return [...out, ...extras];
};

/** A sentence for a screen reader: kind, name, then every state in plain words. */
export function describeNode(n: HarnessNode): string {
  const states: string[] = [];
  if (n.hidden) states.push(`Hidden in this project${n.fromScope === null ? '' : `, inherited from ${n.fromScope}`}`);
  else if (n.replaced) states.push(`Replaced in this project${n.fromScope === null ? '' : `, inherited from ${n.fromScope}`}`);
  else if (n.inherited) states.push(`Inherited${n.fromScope === null ? '' : ` from ${n.fromScope}`}, shown faded`);
  if (n.runsCode) states.push('Runs code with no prompt');
  if (n.secretMissing) states.push('Its secret is missing');
  if (n.conflict) states.push('Conflict: it has different text in different interfaces');
  if (n.newerVersion) states.push('A new version is waiting');
  if (n.libraryPinned && n.kind !== 'group') states.push('From a library, read only');
  if (n.notInstalled) states.push('Not installed');
  if (n.kind === 'group') states.push(n.expanded ? 'Open' : 'Closed');
  const tail = n.detail === '' ? '' : ` ${n.detail}`;
  return `${n.kindLabel}, ${n.label}.${states.length === 0 ? '' : ` ${states.join('. ')}.`}${tail.endsWith('.') || tail === '' ? tail : `${tail}.`}`;
}

/** What a person can do to a node from its menu. `unhide` also stands for taking a replacement away: it removes the override. */
export type NodeAction = 'hide' | 'unhide' | 'replace' | 'expand' | 'collapse' | 'open';
/** One entry of a node's menu: the action and the words on it. */
export interface NodeActionChoice { readonly action: NodeAction; readonly label: string }

/** The menu of a node, in plain words. Only an inherited item can be hidden or replaced, a ghost or a replaced item can be brought back, and a group opens or closes. */
export function actionsFor(n: HarnessNode): NodeActionChoice[] {
  const out: NodeActionChoice[] = [{ action: 'open', label: 'Open details' }];
  if (n.kind === 'group') out.push(n.expanded ? { action: 'collapse', label: 'Show as one group' } : { action: 'expand', label: `Show all ${n.memberCount ?? 0} items` });
  else if (n.hidden) out.push({ action: 'unhide', label: 'Show again in this project' });
  else if (n.replaced) out.push({ action: 'unhide', label: 'Stop replacing in this project' });
  else if (n.inherited) out.push({ action: 'hide', label: 'Hide in this project' }, { action: 'replace', label: 'Replace in this project' });
  return out;
}

interface Entry { readonly item: HarnessItem; readonly inherited: boolean; readonly override: Override | undefined }

/** The scope and its parents, nearest first. A cycle in the parent links ends the walk. */
function chainOf(scopes: readonly Scope[], scopeId: string): Scope[] {
  const byId = new Map(scopes.map(s => [s.id, s]));
  const out: Scope[] = [];
  for (let at = byId.get(scopeId); at !== undefined && !out.includes(at); at = at.parentId === null ? undefined : byId.get(at.parentId)) out.push(at);
  return out;
}

function detailOf(item: HarnessItem, world: World): string {
  switch (item.kind) {
    case 'skill': return short(item.description);
    case 'agent': return short(item.definition.role);
    case 'context-slice': { const slice = world.slices.find(s => s.id === item.sliceId); return slice === undefined ? '' : short(describeRule(slice.rule, world.wikiPages)); }
    case 'tool':
      if (item.toolKind === 'hook') return 'Runs a script on its own';
      if (item.toolKind === 'prompt') return 'A saved prompt';
      return item.secret === null ? 'Needs no secret' : `Secret ${item.secret.name}: ${item.secret.state === 'missing' ? 'missing' : 'found'}`;
  }
}

/** What the root node says when it counts nothing. A filter that hides every item is told as a filter, not as an empty harness. */
function emptyRootWords(view: HarnessView, scopeKind: Scope['kind'], entryCount: number): string {
  if (view.interfaceFilter !== undefined || (scopeKind === 'project' && !view.showInherited)) return 'Nothing to show with this filter.';
  return entryCount > 0 ? 'Everything here is hidden or replaced.' : 'Nothing here yet';
}

/** Builds the graph for one scope. See the notes at the top of this file for what is drawn. */
export function buildHarnessMap(world: World, view: HarnessView): HarnessMapModel {
  const scope = world.scopes.find(s => s.id === view.scopeId) ?? world.scopes.find(s => s.kind === 'global');
  if (scope === undefined) return { scopeId: view.scopeId, nodes: [], edges: [] };
  const chain = chainOf(world.scopes, scope.id);
  const scopeName = new Map(world.scopes.map(s => [s.id, s.name]));
  const chainIds = new Set(chain.map(s => s.id));
  const libraries = new Map<string, LibrarySource>(world.libraries.map(l => [l.id, l]));
  const itemById = new Map(world.items.map(i => [i.id, i]));
  const expandedSet = new Set(view.expandedGroups);

  // Overrides from the root down to this scope: the nearest scope wins.
  const overrides = new Map<string, Override>();
  for (const s of [...chain].reverse()) for (const o of world.overrides) if (o.scopeId === s.id) overrides.set(o.itemId, o);

  const passesFilter = (item: HarnessItem): boolean => view.interfaceFilter === undefined || item.kind === 'context-slice' || item.foundAt.some(f => f.interface === view.interfaceFilter);
  const entries = new Map<string, Entry>();
  const consider = (item: HarnessItem): void => {
    const inherited = item.scopeId !== scope.id;
    if (!chainIds.has(item.scopeId) || (inherited && !view.showInherited) || !passesFilter(item) || entries.has(item.id)) return;
    const override = inherited ? overrides.get(item.id) : undefined;
    entries.set(item.id, { item, inherited, override });
  };
  for (const item of world.items) consider(item);
  // A replacement that lives somewhere else in the chain's reach is still drawn.
  for (const e of [...entries.values()]) {
    const r = e.override?.mode === 'replace' && e.override.replacementItemId !== undefined ? itemById.get(e.override.replacementItemId) : undefined;
    if (r !== undefined && !entries.has(r.id) && passesFilter(r)) entries.set(r.id, { item: r, inherited: r.scopeId !== scope.id, override: undefined });
  }
  const replacementOf = (e: Entry): HarnessItem | undefined => (e.override?.mode === 'replace' && e.override.replacementItemId !== undefined ? entries.get(e.override.replacementItemId)?.item : undefined);
  const isHidden = (e: Entry): boolean => e.override?.mode === 'hide';
  const isReplaced = (e: Entry): boolean => replacementOf(e) !== undefined;

  // Library groups.
  const members = new Map<string, Entry[]>();
  for (const e of entries.values()) if (e.item.library !== null) members.set(e.item.library.library, [...(members.get(e.item.library.library) ?? []), e]);
  const isOpen = (libraryId: string): boolean => expandedSet.has(groupIdOf(libraryId)) || expandedSet.has(libraryId);
  const grouped = (e: Entry): string | null => (e.item.library !== null && !isOpen(e.item.library.library) ? groupIdOf(e.item.library.library) : null);

  // The interface nodes, and the ones items may land in.
  const faces: InterfaceInfo[] = world.interfaces.filter(f => view.interfaceFilter === undefined || f.id === view.interfaceFilter);
  const landing = new Set(faces.filter(f => f.installed === 'installed').map(f => f.id));

  const nodes: HarnessNode[] = [];
  const edges = new Map<string, HarnessEdge>();
  const base = (id: string, kind: HarnessNodeKind, kindLabel: string, label: string, detail: string): Omit<HarnessNode, 'badges'> => ({
    id, kind, toolKind: null, interfaceId: null, kindLabel, label, detail, scopeId: scope.id, fromScope: null, inherited: false, hidden: false, replaced: false, replacedBy: null,
    libraryPinned: false, newerVersion: false, runsCode: false, secretMissing: false, conflict: false, notInstalled: false, groupId: null, memberCount: null, expanded: false,
  });
  const push = (n: Omit<HarnessNode, 'badges'>, extras: readonly string[] = []): void => { nodes.push({ ...n, badges: badgesOf(n, extras) }); };

  // The items first, so the root can count them.
  const visible = [...entries.values()];
  const itemNodes: Array<{ node: Omit<HarnessNode, 'badges'>; extras: readonly string[] }> = [];
  for (const e of visible) {
    const { item } = e;
    if (grouped(e) !== null) continue;
    const replacement = replacementOf(e);
    const n: Omit<HarnessNode, 'badges'> = {
      ...base(item.id, item.kind, kindLabelOf(item), item.name, detailOf(item, world)),
      toolKind: item.kind === 'tool' ? item.toolKind : null, scopeId: item.scopeId, fromScope: e.inherited ? (scopeName.get(item.scopeId) ?? null) : null,
      inherited: e.inherited, hidden: isHidden(e), replaced: replacement !== undefined, replacedBy: replacement?.id ?? null,
      libraryPinned: item.library !== null, newerVersion: item.library?.newerVersion !== undefined,
      runsCode: item.kind === 'tool' && item.toolKind === 'hook', secretMissing: item.kind === 'tool' && item.toolKind === 'mcp' && item.secret?.state === 'missing',
      conflict: hashesDiffer(item), groupId: item.library === null ? null : groupIdOf(item.library.library),
    };
    itemNodes.push({ node: n, extras: item.kind === 'agent' ? item.extras.map(x => x.badge) : [] });
  }

  // The group nodes.
  const groupNodes: Omit<HarnessNode, 'badges'>[] = [];
  for (const [libraryId, list] of members) {
    const source = libraries.get(libraryId), open = isOpen(libraryId);
    const live = list.filter(e => !isHidden(e)), kinds = new Set(live.map(e => e.item.kind));
    const count = live.length, kind = kinds.size === 1 ? [...kinds][0]! : 'item';
    const newer = source?.newerVersion ?? list.map(e => e.item.library?.newerVersion).find(v => v !== undefined);
    const installed = source?.installedVersion ?? list[0]!.item.library!.pinnedVersion;
    groupNodes.push({
      ...base(groupIdOf(libraryId), 'group', 'Library', `${source?.name ?? libraryId}, ${plural(count, kind)}`, `Pinned to ${installed}, read only.${newer === undefined ? '' : ` New version ${newer} waiting.`}`),
      inherited: list.every(e => e.inherited), libraryPinned: true, newerVersion: newer !== undefined, memberCount: count, expanded: open,
      fromScope: list.every(e => e.inherited) ? (scopeName.get(list[0]!.item.scopeId) ?? null) : null,
    });
  }

  // The root, then interfaces, then the rest in a fixed order.
  const counts = new Map<string, number>();
  for (const e of visible) if (!isHidden(e) && !isReplaced(e) && e.item.kind !== 'context-slice') counts.set(e.item.kind, (counts.get(e.item.kind) ?? 0) + 1);
  const summary = (['agent', 'skill', 'tool'] as const).filter(k => (counts.get(k) ?? 0) > 0).map(k => plural(counts.get(k)!, k)).join(', ');
  push({ ...base(scopeNodeId(scope.id), 'scope', scope.kind === 'global' ? 'Global harness' : 'Project harness', scope.name, summary === '' ? emptyRootWords(view, scope.kind, visible.length) : summary) });
  for (const f of faces) {
    const installed = f.installed === 'installed';
    push({
      ...base(interfaceNodeId(f.id), 'interface', 'Interface', INTERFACE_WORDS[f.id], `${installed ? 'Installed' : f.installed === 'unknown' ? 'Not checked yet' : 'Not installed'}. Slice wall: ${f.enforcement}.`),
      interfaceId: f.id, notInstalled: !installed,
    });
  }
  const rank = (n: Omit<HarnessNode, 'badges'>): number => KIND_ORDER[n.kind];
  const ordered = [...groupNodes.map(node => ({ node, extras: [] as readonly string[] })), ...itemNodes];
  // Within a kind: own items before inherited ones, library items last, then the order of the world.
  const index = new Map(world.items.map((i, k) => [i.id, k]));
  ordered.sort((a, b) => rank(a.node) - rank(b.node) || Number(a.node.inherited) - Number(b.node.inherited) || Number(a.node.groupId !== null) - Number(b.node.groupId !== null) || (index.get(a.node.id) ?? -1) - (index.get(b.node.id) ?? -1));
  for (const o of ordered) push(o.node, o.extras);

  // Where an item is drawn: its own node, the node of its replacement, its group, or nowhere.
  const present = new Set(nodes.map(n => n.id));
  const effective = (itemId: string, depth = 0): string | null => {
    const e = entries.get(itemId);
    if (e === undefined || depth > 4 || isHidden(e)) return null;
    const replacement = replacementOf(e);
    if (replacement !== undefined) return effective(replacement.id, depth + 1);
    const g = grouped(e);
    const id = g ?? itemId;
    return present.has(id) ? id : null;
  };
  const link = (from: string, to: string | null, rel: HarnessEdgeRel, label: string): void => {
    if (to === null || from === to || !present.has(from) || !present.has(to)) return;
    const id = `${from}>${rel}>${to}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, rel, label });
  };

  const sliceItems = new Map<string, string>();
  for (const e of entries.values()) if (e.item.kind === 'context-slice') sliceItems.set(e.item.sliceId, e.item.id);
  for (const e of visible) {
    const { item } = e;
    const live = !isHidden(e) && !isReplaced(e);
    if (live && grouped(e) === null && item.kind === 'agent') {
      const agent: AgentItem = item;
      for (const skillId of agent.definition.skillIds) link(agent.id, effective(skillId), 'uses', HARNESS_REL_WORDS.uses);
      for (const t of agent.definition.toolAttachments) link(agent.id, effective(t.toolId), 'has-tool', ACCESS_WORDS[t.access]);
      const sliceItem = agent.definition.sliceId === undefined ? undefined : sliceItems.get(agent.definition.sliceId);
      if (sliceItem !== undefined) link(agent.id, effective(sliceItem), 'reads', HARNESS_REL_WORDS.reads);
    }
    if (live) {
      // A collapsed library lands in an interface through its group.
      const from = grouped(e) ?? item.id;
      for (const f of item.foundAt) if (landing.has(f.interface)) link(from, interfaceNodeId(f.interface), 'lands-in', HARNESS_REL_WORDS['lands-in']);
    }
    const replacement = replacementOf(e);
    if (replacement !== undefined) link(effective(replacement.id) ?? replacement.id, e.item.id, 'replaces', HARNESS_REL_WORDS.replaces);
  }

  return { scopeId: scope.id, nodes, edges: [...edges.values()] };
}
