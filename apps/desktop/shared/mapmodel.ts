/**
 * The map of what Bowerloom manages on a machine, as nodes and edges. Pure functions: no window, no file. The window draws it.
 * Every id is stable: it is made from names and paths, so a node keeps its saved place from one look to the next.
 */
import type { ItemKind, ProjectData, Snapshot } from './types.js';
import { reasonsOf } from './viewmodel.js';
import type { Link } from './viewmodel.js';
import { KIND_WORDS, codeWords, plural, titleOf } from './words.js';

export type MapKind = 'machine' | 'workspace' | 'project' | 'context-store' | 'team' | 'agent' | 'skill' | 'prompt' | 'reading-list' | 'knowledge-folder';
export const MAP_KINDS: readonly MapKind[] = ['machine', 'workspace', 'project', 'context-store', 'team', 'agent', 'skill', 'prompt', 'reading-list', 'knowledge-folder'];
export type EdgeRel = 'contains' | 'uses' | 'reads' | 'owns' | 'comes-from' | 'allowed' | 'registered';
export const EDGE_RELS: readonly EdgeRel[] = ['contains', 'uses', 'reads', 'owns', 'comes-from', 'allowed', 'registered'];
export type MapStatus = 'ready' | 'not-locked' | 'drifted' | 'held' | 'cannot-open';
export type MapScope = 'global' | 'project';
export type ScopeFilter = 'everything' | 'global' | 'project';

export interface MapNode {
  id: string; kind: MapKind; label: string;
  /** `global`: lives on the machine (the shared library, knowledge folders). `project`: lives in a folder of work. */
  scope: MapScope;
  /** One plain line, for hover. */
  description: string;
  status: MapStatus | null; reasons: string[];
  /** Where the full page about it is. */
  link: Link | null;
  /** The key of the project this belongs to, when it belongs to one. */
  owner: string | null;
  /** True for an item that is on the project's disk but is not listed in what Bowerloom resolves. */
  unlisted?: boolean;
  /** A stack that stands for several items of one kind at once. Click it to open the stack. */
  cluster?: { count: number; ids: string[] };
}
export interface MapEdge { id: string; from: string; to: string; rel: EdgeRel }
export interface MapModel { nodes: MapNode[]; edges: MapEdge[] }

export const KIND_WORDS_MAP: Record<MapKind, string> = {
  machine: 'This computer', workspace: 'Workspace', project: 'Project', 'context-store': 'Context store', team: 'Team', agent: 'Helper', skill: 'Skill', prompt: 'Prompt', 'reading-list': 'Reading list', 'knowledge-folder': 'Knowledge folder',
};
export const REL_WORDS: Record<EdgeRel, string> = { contains: 'holds', uses: 'uses', reads: 'reads', owns: 'owns', 'comes-from': 'comes from', allowed: 'is allowed to read', registered: 'is registered as' };
export const STATUS_WORDS: Record<MapStatus, string> = { ready: 'Ready', 'not-locked': 'Nothing locked yet', drifted: 'Drifted', held: 'Held', 'cannot-open': 'Cannot open' };

const firstSentence = (text: string): string => /^[^.]*\./.exec(text)?.[0] ?? text;
const statusOfProject = (p: ProjectData): MapStatus | null => p.status === 'ready' ? 'ready' : p.status === 'not-locked' ? 'not-locked' : p.status === 'unreadable' ? 'cannot-open' : p.status === 'not-set-up' ? null : 'drifted';

/** The nodes and edges of one snapshot. */
export function buildMap(s: Snapshot): MapModel {
  const nodes = new Map<string, MapNode>(), edges = new Map<string, MapEdge>();
  const node = (n: MapNode): MapNode => { const old = nodes.get(n.id); if (old !== undefined) return old; nodes.set(n.id, n); return n; };
  const edge = (from: string, to: string, rel: EdgeRel): void => { const id = `${from}>${rel}>${to}`; if (nodes.has(from) && nodes.has(to) && from !== to && !edges.has(id)) edges.set(id, { id, from, to, rel }); };

  node({ id: 'machine', kind: 'machine', label: 'This computer', scope: 'global', description: 'This computer. The shared library and the knowledge folders live here.', status: null, reasons: [], link: { screen: 'storage' }, owner: null });

  // The shared library: global items that projects use.
  const storeId = (kind: ItemKind, id: string): string => `store:${kind}:${id}`;
  for (const [kind, list] of [['team', s.library.teams], ['skill', s.library.skills], ['prompt', s.library.prompts]] as const) {
    for (const item of list) {
      node({ id: storeId(kind, item.id), kind, label: titleOf(item.id), scope: 'global', description: `${firstSentence(KIND_WORDS[kind].what)} In your shared library.`, status: item.problem === null ? null : 'held', reasons: item.problem === null ? [] : [`The folder for this ${KIND_WORDS[kind].one.toLowerCase()} is missing from your library.`], link: { screen: 'item', kind, id: item.id }, owner: null });
      edge('machine', storeId(kind, item.id), 'contains');
    }
  }

  // Folders on this computer: workspaces, projects, and context stores.
  const folders = [...s.projects].sort((a, b) => a.dir.length - b.dir.length);
  const idOfFolder = (p: ProjectData): string => `${p.role === 'workspace' ? 'workspace' : p.role === 'context-store' ? 'context' : 'project'}:${p.key}`;
  const kindOfFolder = (p: ProjectData): MapKind => p.role === 'workspace' ? 'workspace' : p.role === 'context-store' ? 'context-store' : 'project';
  for (const p of folders) {
    const reasons = reasonsOf(p);
    node({
      id: idOfFolder(p), kind: kindOfFolder(p), label: p.name, scope: 'project', owner: p.key, status: statusOfProject(p), reasons,
      description: p.role === 'workspace' ? 'A folder that holds other Bowerloom folders.' : p.role === 'context-store' ? `The central store of knowledge${p.pages === null ? '' : `, ${plural(p.pages, 'page')}`}.` : p.layout === 'older' ? 'A project set up the older way.' : 'A project that uses the shared library.',
      link: { screen: 'project', key: p.key },
    });
  }
  // A folder sits inside the nearest folder that holds it; the rest sit on the machine.
  for (const p of folders) {
    const parent = folders.filter(q => q.key !== p.key && q.role !== 'context-store' && (p.dir === q.dir ? false : p.dir.startsWith(q.dir.endsWith('/') ? q.dir : `${q.dir}/`))).sort((a, b) => b.dir.length - a.dir.length)[0];
    edge(parent === undefined ? 'machine' : idOfFolder(parent), idOfFolder(p), 'contains');
  }

  // What each folder holds: items, helpers, reading lists.
  for (const p of folders) {
    const me = idOfFolder(p);
    for (const i of p.items) {
      if (i.note === 'reserved') continue;
      const id = `item:${p.key}:${i.kind}:${i.id}`;
      const status: MapStatus | null = i.hold !== null ? 'held' : i.lock === 'changed' || i.lock === 'missing' ? 'drifted' : null;
      const unlisted = i.note === 'unlisted';
      node({ id, kind: i.kind, label: titleOf(i.id), scope: 'project', owner: p.key, status, ...(unlisted ? { unlisted: true } : {}), reasons: [...(unlisted ? ['It is in the folder, but the project list does not name it, so Bowerloom does not use it.'] : []), ...(i.hold === null ? [] : [codeWords(i.hold.code)]), ...(i.lock === 'changed' ? ['It changed in your library after the lock was written.'] : i.lock === 'missing' ? ['It is not in the lock.'] : [])], description: unlisted ? `${firstSentence(KIND_WORDS[i.kind].what)} In ${p.name}'s folder, but not listed.` : `${firstSentence(KIND_WORDS[i.kind].what)} Used by ${p.name}.`, link: { screen: 'item', kind: i.kind, id: i.id, fromProject: p.key } as Link });
      // A listed item is used by the project. An item that is only on disk is held by the folder, not used.
      edge(me, id, unlisted ? 'contains' : 'uses');
      if (i.from === 'store' && !unlisted) edge(id, storeId(i.kind, i.id), 'comes-from');
    }
    for (const a of p.agents) {
      const id = `agent:${p.key}:${a.role}`;
      node({ id, kind: 'agent', label: a.role, scope: 'project', owner: p.key, status: a.hold === null ? null : 'held', reasons: a.hold === null ? [] : [codeWords(a.hold.code)], description: `One AI helper with a job${a.notices.some(n => n !== 'permissionMode:manual') ? ', with powerful settings' : ''}.`, link: { screen: 'project', key: p.key } });
      if (a.team !== null && nodes.has(`item:${p.key}:team:${a.team}`)) edge(`item:${p.key}:team:${a.team}`, id, 'owns'); else edge(me, id, 'owns');
    }
    for (const sl of p.slices) {
      const id = `slice:${p.key}:${sl.id}`;
      const held = sl.hold !== null;
      node({ id, kind: 'reading-list', label: sl.id, scope: 'project', owner: p.key, status: held ? 'held' : null, reasons: held ? [codeWords(sl.hold!.code)] : [], description: `A short list of files that helpers read at the start${sl.folder ? `, from "${sl.folder}"` : ''}.`, link: { screen: 'project', key: p.key } });
      edge(me, id, 'uses');
      for (const role of sl.agents) edge(`agent:${p.key}:${role}`, id, 'reads');
    }
  }

  // Knowledge folders, and the context store each one is.
  for (const f of s.folders) {
    const id = `folder:${f.name}`;
    node({ id, kind: 'knowledge-folder', label: f.name, scope: 'global', owner: null, status: f.state === 'ready' ? 'ready' : 'cannot-open', reasons: f.state === 'ready' ? [] : [codeWords(f.code) || 'The folder is not at its saved place.'], description: 'A folder of notes outside your projects. Projects need permission to read it.', link: { screen: 'folders' } });
    edge('machine', id, 'contains');
    // The context store is the real folder on disk; the knowledge folder is its registration, so the wire runs from the store to the record.
    const store = s.projects.find(p => p.role === 'context-store' && f.dir !== null && p.dir === f.dir);
    if (store !== undefined) edge(idOfFolder(store), id, 'registered');
    // A project is drawn next to a knowledge folder only when a permission for it exists.
    for (const key of f.allowed) { const p = s.projects.find(x => x.key === key); if (p !== undefined) edge(idOfFolder(p), id, 'allowed'); }
  }
  for (const f of s.folders) for (const p of s.projects) if (f.allowed.includes(p.key)) for (const sl of p.slices) if (sl.folder === f.name) edge(`slice:${p.key}:${sl.id}`, `folder:${f.name}`, 'reads');

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export interface MapFilter { scope: ScopeFilter; kinds: ReadonlySet<MapKind> | null; query: string }

/** The part of the map that passes the filters. A search keeps what matches and the things next to it. */
export function filterMap(model: MapModel, filter: MapFilter): MapModel & { matches: ReadonlySet<string> } {
  const query = filter.query.trim().toLowerCase();
  let nodes = model.nodes.filter(n => (filter.scope === 'everything' || n.scope === filter.scope || n.kind === 'machine') && (filter.kinds === null || filter.kinds.has(n.kind) || n.kind === 'machine' && filter.scope === 'global'));
  const matches = new Set<string>();
  if (query !== '') {
    for (const n of nodes) if (n.label.toLowerCase().includes(query) || n.description.toLowerCase().includes(query)) matches.add(n.id);
    const keep = new Set(matches);
    for (const e of model.edges) { if (matches.has(e.from)) keep.add(e.to); if (matches.has(e.to)) keep.add(e.from); }
    nodes = nodes.filter(n => keep.has(n.id));
  }
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: model.edges.filter(e => ids.has(e.from) && ids.has(e.to)), matches };
}

/**
 * The same map as nested words, for a person who does not see the canvas: each folder, then what it holds. Each entry also lists
 * every wire it has that the nesting does not show: what it reads, what it comes from, and any other thing that holds or uses it.
 */
export function outlineOf(model: MapModel): { id: string; text: string; depth: number }[] {
  const byId = new Map(model.nodes.map(n => [n.id, n]));
  const TREE = new Set<EdgeRel>(['contains', 'uses', 'owns']);
  const kids = new Map<string, MapEdge[]>(); for (const e of model.edges) if (TREE.has(e.rel)) kids.set(e.from, [...(kids.get(e.from) ?? []), e]);
  const out: { id: string; text: string; depth: number }[] = [], seen = new Set<string>(), parentOf = new Map<string, string>();
  const describe = (n: MapNode): string => `${KIND_WORDS_MAP[n.kind]}: ${n.label}${n.unlisted === true ? ', not listed' : ''}${n.status === null ? '' : `, ${STATUS_WORDS[n.status]}`}`;
  const relations = (id: string): string[] => {
    const lines: string[] = [];
    for (const e of model.edges) {
      if (e.from === id && !TREE.has(e.rel)) { const other = byId.get(e.to); if (other !== undefined) lines.push(`${REL_WORDS[e.rel]} ${other.label}`); }
      else if (e.to === id && !TREE.has(e.rel) && e.rel !== 'comes-from' && e.rel !== 'reads') { const other = byId.get(e.from); if (other !== undefined) lines.push(`${other.label} ${REL_WORDS[e.rel]} it`); }
      else if (e.to === id && TREE.has(e.rel) && parentOf.get(id) !== e.from) { const other = byId.get(e.from); if (other !== undefined) lines.push(`also: ${other.label} ${REL_WORDS[e.rel]} it`); }
    }
    return lines;
  };
  const walk = (id: string, depth: number, parent: string | null): void => {
    const n = byId.get(id); if (n === undefined || seen.has(id) || depth > 8) return; seen.add(id); if (parent !== null) parentOf.set(id, parent);
    out.push({ id, depth, text: '' });
    for (const e of kids.get(id) ?? []) walk(e.to, depth + 1, id);
  };
  walk('machine', 0, null);
  for (const n of model.nodes) if (!seen.has(n.id)) walk(n.id, 0, null);
  // Texts are written after the walk, when every node's first parent is known.
  for (const row of out) { const n = byId.get(row.id)!; const rel = relations(row.id); row.text = `${describe(n)}${rel.length ? `. ${rel.join('; ')}` : ''}`; }
  return out;
}

/** What a hover says: one plain line. */
export const hoverLine = (n: MapNode): string => `${KIND_WORDS_MAP[n.kind]}${n.status === null ? '' : ` (${STATUS_WORDS[n.status]})`}. ${n.description}`;
