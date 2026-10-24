/**
 * The prototype's in-memory ViewerApi (spec section 11, "Prototype rules").
 * `createFakeApi(world)` answers every call from the given World or from a plain empty default. The calls that save something in the
 * real app (theme, role, map layout, sketches, mode, folders) keep the value in variables inside the closure, and nothing else.
 * It reaches no bridge, no file, no network, no clock and no random number. Two fakes share nothing, and the World is never changed.
 * Every result is a copy, so changing a result changes nothing inside the fake.
 */
import type {
  AppInfo, AppSettings, GraphResult, ItemContent, KnowledgeGraph, Mode, PageResult, SettingsResult, Sketch, SketchResult, SketchSummary, Snapshot, ViewerApi,
} from '../../shared/types.js';
import type { HarnessItem, World } from '../../shared/proto/types.js';

const clone = <T>(value: T): T => structuredClone(value);
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;
const GRAPH_LIMITS = { nodes: 5000, edges: 20000 } as const;

/** A World with the three interfaces, one global scope and nothing else. Plain JSON, a fresh object on every call. */
export function createEmptyWorld(): World {
  return {
    interfaces: [
      { id: 'claude-code', installed: 'unknown', notice: null, enforcement: 'blocks reads' },
      { id: 'codex', installed: 'unknown', notice: null, enforcement: 'advisory only' },
      { id: 'opencode', installed: 'unknown', notice: null, enforcement: 'advisory only' },
    ],
    items: [],
    scopes: [{ id: 'global', kind: 'global', name: 'Global', parentId: null, path: '/sample/harness' }],
    overrides: [],
    wikiPages: [],
    slices: [],
    versions: [],
    libraries: [],
  };
}

function emptySnapshot(mode: Mode): Snapshot {
  return {
    mode, at: '',
    store: { state: 'absent', code: null, path: '', message: null, git: null, gitignoreMissing: false, foldersTracked: false, leftovers: [], token: 'not-set', counts: null },
    library: { skills: [], prompts: [], teams: [], unlisted: 0, pinsError: null, failed: null },
    folders: [], projects: [],
    cache: { state: 'ok', code: null, entries: [], totalBytes: 0, totalEntries: 0, unknownSize: 0, unlisted: 0, truncated: false, unreadable: [] },
    scan: { roots: [], skipped: [], truncated: false, found: 0, depthReached: false, skippedMore: false, depthLimit: 0, linkedFolders: [], linkedFoldersTotal: 0, depthFolders: [], unopenedFolders: 0, exampleFolders: [], exampleFoldersTotal: 0 },
    problems: [],
  };
}

function graphOf(world: World): KnowledgeGraph {
  const ids = new Set(world.wikiPages.map(p => p.id)), seen = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  let broken = 0;
  for (const page of world.wikiPages) {
    for (const target of page.links) {
      if (!ids.has(target)) { broken += 1; continue; }
      const key = `${page.id}>${target}`;
      if (target === page.id || seen.has(key)) continue;
      seen.add(key); edges.push({ from: page.id, to: target });
    }
  }
  const degree = new Map<string, number>(), inDegree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1); degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  return {
    nodes: world.wikiPages.map(p => ({ id: p.id, title: p.title, folder: p.folder, tags: [...p.tags], bytes: p.bytes, degree: degree.get(p.id) ?? 0, inDegree: inDegree.get(p.id) ?? 0, orphan: (degree.get(p.id) ?? 0) === 0, big: false })),
    edges,
    folders: [...new Set(world.wikiPages.map(p => p.folder))].sort(),
    tags: [...new Set(world.wikiPages.flatMap(p => p.tags))].sort(),
    broken, notices: [], limits: { ...GRAPH_LIMITS },
  };
}

/** The item a 0.7 style `{ kind, id }` request names: a skill is a skill, a prompt is a prompt tool. Teams have no match in the 0.8 model. */
function findItem(world: World, kind: 'skill' | 'prompt' | 'team', id: string): HarnessItem | undefined {
  return world.items.find(i => i.id === id && (kind === 'skill' ? i.kind === 'skill' : kind === 'prompt' ? i.kind === 'tool' && i.toolKind === 'prompt' : false));
}

/**
 * Makes a ViewerApi that lives in memory. Each key matches a call the real preload exposes (`CHANNELS` in shared/channels.ts).
 * `getKnowledgeGraph` ignores its store key: the world holds one knowledge base. `addRoot` adds nothing, because no folder chooser exists.
 * `openLink` opens nothing and answers false. `copyText` answers true and keeps the text nowhere.
 */
export function createFakeApi(world: World): ViewerApi {
  let mode: Mode = 'sample';
  let settings: AppSettings = { theme: 'system', roots: [], mode, includeExamples: false, roles: {}, mapLayout: {}, discovered: true };
  const sketches = new Map<string, Sketch>();

  const settled = (): SettingsResult => ({ settings: clone(settings), message: null });
  const change = (patch: Partial<AppSettings>): SettingsResult => { settings = { ...settings, ...patch }; return settled(); };
  const summary = (s: Sketch): SketchSummary => ({ name: s.name, nodes: s.nodes.length, edges: s.edges.length });
  const info = (): AppInfo => ({ version: '0.8.0-prototype', mode, storePath: '', updates: { enabled: false, status: 'off' }, platform: 'prototype', firstRun: false, sandbox: { path: '', exists: false }, notice: null });

  return {
    getInfo: async () => info(),
    getSettings: async () => clone(settings),
    getSnapshot: async () => emptySnapshot(mode),
    getItemContent: async ({ kind, id }): Promise<ItemContent> => {
      const item = findItem(world, kind, id);
      const files = item === undefined ? [] : item.foundAt.map(f => ({ path: f.path, text: f.text, note: null, bytes: utf8Bytes(f.text) }));
      return { kind, id, where: 'store', files, pinned: null, note: null };
    },
    getFileText: async () => ({ text: null, note: null }),
    chooseMode: async (next: Mode) => { mode = next; settings = { ...settings, mode: next }; return info(); },
    addRoot: async () => settled(),
    removeRoot: async (path: string) => change({ roots: settings.roots.filter(r => r !== path) }),
    setTheme: async theme => change({ theme }),
    setIncludeExamples: async on => change({ includeExamples: on }),
    setRole: async (projectKey, role) => {
      const roles = { ...settings.roles };
      if (role === null) delete roles[projectKey]; else roles[projectKey] = role;
      return change({ roles });
    },
    setMapLayout: async layout => change({ mapLayout: layout === null ? {} : clone(layout) }),
    listSketches: async (): Promise<SketchResult<SketchSummary[]>> => ({ ok: true, value: [...sketches.values()].map(summary), message: null }),
    saveSketch: async (sketch): Promise<SketchResult<SketchSummary>> => { const kept = clone(sketch); sketches.set(kept.name, kept); return { ok: true, value: summary(kept), message: null }; },
    loadSketch: async (name): Promise<SketchResult<Sketch>> => {
      const found = sketches.get(name);
      return found === undefined ? { ok: false, value: null, message: null } : { ok: true, value: clone(found), message: null };
    },
    deleteSketch: async (name): Promise<SketchResult<null>> => ({ ok: sketches.delete(name), value: null, message: null }),
    getKnowledgeGraph: async (): Promise<GraphResult> => ({ ok: true, graph: graphOf(world), message: null }),
    getPageText: async ({ page }): Promise<PageResult> => ({ text: world.wikiPages.find(p => p.id === page)?.summary ?? null, note: null }),
    copyText: async () => true,
    checkForUpdates: async () => ({ status: 'off' }),
    openLink: async () => false,
  };
}
