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
export type EdgeRel = 'contains' | 'uses' | 'reads' | 'owns' | 'comes-from';
export const EDGE_RELS: readonly EdgeRel[] = ['contains', 'uses', 'reads', 'owns', 'comes-from'];
export type MapStatus = 'ready' | 'drifted' | 'held' | 'cannot-open';
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
}
export interface MapEdge { id: string; from: string; to: string; rel: EdgeRel }
export interface MapModel { nodes: MapNode[]; edges: MapEdge[] }

export const KIND_WORDS_MAP: Record<MapKind, string> = {
  machine: 'This computer', workspace: 'Workspace', project: 'Project', 'context-store': 'Context store', team: 'Team', agent: 'Helper', skill: 'Skill', prompt: 'Prompt', 'reading-list': 'Reading list', 'knowledge-folder': 'Knowledge folder',
};
export const REL_WORDS: Record<EdgeRel, string> = { contains: 'holds', uses: 'uses', reads: 'reads', owns: 'owns', 'comes-from': 'comes from' };
export const STATUS_WORDS: Record<MapStatus, string> = { ready: 'Ready', drifted: 'Drifted', held: 'Held', 'cannot-open': 'Cannot open' };

const firstSentence = (text: string): string => /^[^.]*\./.exec(text)?.[0] ?? text;
const statusOfProject = (p: ProjectData): MapStatus | null => p.status === 'ready' || p.status === 'not-locked' ? 'ready' : p.status === 'unreadable' ? 'cannot-open' : p.status === 'not-set-up' ? null : 'drifted';

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
      node({ id: storeId(kind, item.id), kind, label: titleOf(item.id), scope: 'global', description: `${firstSentence(KIND_WORDS[kind].what)} In your shared library.`, status: item.problem === null ? null : 'held', reasons: item.problem === null ? [] : ['The folder for this skill is missing from your library.'], link: { screen: 'item', kind, id: item.id }, owner: null });
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
      node({ id, kind: i.kind, label: titleOf(i.id), scope: 'project', owner: p.key, status, reasons: [...(i.hold === null ? [] : [codeWords(i.hold.code)]), ...(i.lock === 'changed' ? ['It changed in your library after the lock was written.'] : i.lock === 'missing' ? ['It is not in the lock.'] : [])], description: `${firstSentence(KIND_WORDS[i.kind].what)} Used by ${p.name}.`, link: { screen: 'item', kind: i.kind, id: i.id, fromProject: p.key } as Link });
      edge(me, id, 'uses');
      if (i.from === 'store') edge(id, storeId(i.kind, i.id), 'comes-from');
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
    const store = s.projects.find(p => p.role === 'context-store' && f.dir !== null && p.dir === f.dir);
    if (store !== undefined) edge(id, idOfFolder(store), 'comes-from');
    for (const key of f.allowed) { const p = s.projects.find(x => x.key === key); if (p !== undefined) edge(idOfFolder(p), id, 'reads'); }
  }
  for (const p of s.projects) for (const sl of p.slices) if (sl.folder !== null) edge(`slice:${p.key}:${sl.id}`, `folder:${sl.folder}`, 'reads');

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

/** The same map as nested words, for a person who does not see the canvas: each folder, then what it holds and what reads what. */
export function outlineOf(model: MapModel): { id: string; text: string; depth: number }[] {
  const byId = new Map(model.nodes.map(n => [n.id, n]));
  const kids = new Map<string, MapEdge[]>(); for (const e of model.edges) if (e.rel === 'contains' || e.rel === 'uses' || e.rel === 'owns') kids.set(e.from, [...(kids.get(e.from) ?? []), e]);
  const out: { id: string; text: string; depth: number }[] = [], seen = new Set<string>();
  const describe = (n: MapNode): string => `${KIND_WORDS_MAP[n.kind]}: ${n.label}${n.status === null ? '' : `, ${STATUS_WORDS[n.status]}`}`;
  const walk = (id: string, depth: number): void => {
    const n = byId.get(id); if (n === undefined || seen.has(id) || depth > 8) return; seen.add(id);
    const reads = model.edges.filter(e => e.from === id && (e.rel === 'reads' || e.rel === 'comes-from')).map(e => byId.get(e.to)?.label).filter(Boolean);
    out.push({ id, depth, text: `${describe(n)}${reads.length ? `. ${REL_WORDS[model.edges.find(e => e.from === id && (e.rel === 'reads' || e.rel === 'comes-from'))!.rel]} ${reads.join(', ')}` : ''}` });
    for (const e of kids.get(id) ?? []) walk(e.to, depth + 1);
  };
  walk('machine', 0);
  for (const n of model.nodes) if (!seen.has(n.id)) walk(n.id, 0);
  return out;
}

/** What a hover says: one plain line. */
export const hoverLine = (n: MapNode): string => `${KIND_WORDS_MAP[n.kind]}${n.status === null ? '' : ` (${STATUS_WORDS[n.status]})`}. ${n.description}`;
