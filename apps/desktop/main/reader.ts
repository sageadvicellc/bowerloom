/**
 * Reads everything Bowerloom manages and returns it as plain data. It calls Bowerloom's own read functions in this
 * process: it starts no command, opens no port, and never calls a function that writes.
 */
import { basename, join } from 'node:path';
import { discoverProject, inspectStore, listFolderGrants, listFolders, privateStateRoot, resolveRegisteredFolder } from '../../../packages/project-context/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { LOCK_FILE, readConfig, readLock, lockItem, lockSourceLabel } from '../../../packages/project-config/src/index.js';
import { listCache } from '../../../packages/project-sync/src/index.js';
import { measureContext } from '../../../packages/project-sync/src/context-measure.js';
import { resolveProject } from '../../../packages/project-sync/src/index.js';
import type { Resolved, ResolvedItem } from '../../../packages/project-sync/src/index.js';
import { listStore } from '../../cli/src/ls.js';
import type { Listing } from '../../cli/src/ls.js';
import { report } from '../../cli/src/store.js';
import { runProjectStatus } from '../../cli/src/project-status.js';
import { readProjectPlan } from '../../cli/src/viewer-read.js';
import { LIMITS, readGuarded } from '../../../packages/project-authoring/src/files.js';
import type {
  AgentRow, CacheData, FolderData, ItemKind, Library, LibraryItem, LockMatch, MeasureRow, Mode, Origin, ProjectData, ProjectItem, ProjectStatus, Snapshot, SliceRow, StoreData,
} from '../shared/types.js';
import { scanRoots } from './scan.js';
import { OutsideRoot, resolveInside } from './safe.js';
import { tokenState } from './token.js';

export interface ReadContext { mode: Mode; home: string; env: NodeJS.ProcessEnv; roots: string[]; tokenSource?: NodeJS.ProcessEnv }

export const codeOf = (error: unknown): string => {
  if (error instanceof OutsideRoot) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'UNREADABLE';
};

const originOfKind = (kind: string | undefined): Origin => kind === 'npm' ? 'npm' : kind === 'git' ? 'github' : 'yours';

// ------------------------------------------------------------------------------------------------------------- store

export function readStoreData(ctx: ReadContext): StoreData {
  const token = tokenState(ctx.tokenSource);
  try {
    const r = report(ctx.home);
    const git = r.git === null ? null : { problem: r.git.problem, remote: r.git.remote, branch: r.git.branch, head: r.git.head, pushed: r.git.pushed };
    const c = r.counts;
    return {
      state: r.state === 'store' ? 'ready' : r.state, code: r.code, path: r.path, message: null, git,
      gitignoreMissing: r.gitignore !== undefined && (r.gitignore.state === 'create' || r.gitignore.state === 'update'),
      foldersTracked: r.folders?.tracked === true, leftovers: r.leftovers, token,
      counts: c === null ? null : { skills: c.skillFolders.n, pinned: c.pinnedSkills.count, prompts: c.prompts.n, teams: c.teams.n },
    };
  } catch (error) {
    return { state: 'unreadable', code: codeOf(error), path: join(ctx.home, '.bowerloom'), message: null, git: null, gitignoreMissing: false, foldersTracked: false, leftovers: [], token, counts: null };
  }
}

function pinWords(listing: Listing, id: string): { origin: Origin; pin: string | null } {
  const info = listing.skillInfo?.get(id);
  return { origin: originOfKind(info?.kind), pin: info?.pin ?? null };
}

export function readLibrary(ctx: ReadContext): { library: Library; storeProblem: string | null } {
  let listing: Listing;
  try { listing = listStore(ctx.home); } catch (error) { return { library: { skills: [], prompts: [], teams: [], unlisted: 0, pinsError: null }, storeProblem: codeOf(error) }; }
  const item = (kind: ItemKind, id: string): LibraryItem => {
    if (kind === 'skill') {
      const w = pinWords(listing, id), missing = listing.skillInfo?.get(id)?.kind === 'local' && listing.skillFolders !== undefined && !listing.skillFolders.has(id);
      return { kind, id, origin: w.origin, pin: w.pin, problem: missing ? 'FOLDER_MISSING' : null, usedBy: [] };
    }
    return { kind, id, origin: 'yours', pin: null, problem: null, usedBy: [] };
  };
  return {
    storeProblem: null,
    library: {
      skills: listing.skills.map(id => item('skill', id)), prompts: listing.prompts.map(id => item('prompt', id)), teams: listing.teams.map(id => item('team', id)),
      unlisted: listing.unlisted, pinsError: listing.pinsError ?? null,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- projects

function matchOf(resolved: Resolved, kind: ItemKind, row: ResolvedItem): LockMatch {
  if (row.origin === 'project') return 'not-used';
  if (resolved.lock.state === 'not-used' || (resolved.lock.state === 'absent' && !resolved.shared)) return 'not-used';
  if (resolved.lockValue === null) return resolved.lock.state === 'absent' ? 'missing' : 'unknown';
  if (lockItem(resolved.lockValue, kind, row.id) === null) return 'missing';
  return resolved.stale.includes(`${kind} ${row.id}`) ? 'changed' : 'same';
}

function pinOfRow(row: ResolvedItem): string | null {
  const source = row.entry?.source;
  if (source?.kind === 'npm') return `${source.package}@${source.version}`;
  if (source?.kind === 'git') return `${source.repository}@${source.commit.slice(0, 8)}`;
  if (row.lockPin !== null) return `${row.lockPin.remote.replace('https://github.com/', '')}@${row.lockPin.commit.slice(0, 8)}`;
  return null;
}

function itemsOf(resolved: Resolved): ProjectItem[] {
  const out: ProjectItem[] = [];
  for (const [kind, rows] of [['skill', resolved.skills], ['prompt', resolved.prompts], ['team', resolved.teams]] as const) {
    for (const row of rows) {
      const origin: Origin = row.entry !== null ? originOfKind(row.entry.source.kind) : row.lockPin !== null ? 'github' : 'yours';
      out.push({ kind, id: row.id, from: row.origin === 'project' ? 'project' : 'store', via: row.via, resolvedFrom: row.resolvedFrom, origin, pin: pinOfRow(row), hold: row.hold, lock: matchOf(resolved, kind, row) });
    }
  }
  return out;
}

function lockRowsOf(resolved: Resolved | null): ProjectData['lockRows'] {
  const lock = resolved?.lockValue;
  if (!lock) return [];
  const rows: ProjectData['lockRows'] = [];
  for (const [kind, list] of [['skill', lock.skills], ['prompt', lock.prompts], ['team', lock.teams]] as const) for (const item of list) rows.push({ kind, id: item.id, source: lockSourceLabel(item) });
  return rows;
}

const empty = (dir: string): ProjectData => ({
  key: dir, name: basename(dir), dir, status: 'unreadable', openCode: null, setup: null, configState: 'absent', configCode: null, lockState: 'not-used', lockCode: null,
  drift: [], notes: [], storeCode: null, unavailable: null, items: [], agents: [], slices: [], held: [], measure: [], measureCode: null, baselineBytes: null, baselineFiles: null, lockRows: [], shared: false,
});


/** What a slice definition says about its folder and what it wants to show. Read from the definition file with the guarded reader. */
function sliceDefinition(dir: string, id: string): { folder: string | null; wants: SliceRow['wants']; wantsKey: string | null } {
  try {
    const real = resolveInside([dir], join(dir, '.bowerloom', 'slices', `${id}.yaml`));
    const text = readGuarded(real, LIMITS.fileBytes).toString('utf8');
    const folder = /^\s{2}registered:\s*"?([a-z0-9-]{1,64})"?\s*$/m.exec(text)?.[1] ?? null;
    const summary = /^summary:\s*"?([A-Za-z0-9:_-]{1,80})"?\s*$/m.exec(text)?.[1] ?? 'heading';
    if (summary === 'none') return { folder, wants: 'none', wantsKey: null };
    if (summary === 'heading') return { folder, wants: 'heading', wantsKey: null };
    if (summary.startsWith('frontmatter:')) return { folder, wants: 'frontmatter', wantsKey: summary.slice(12) };
    return { folder, wants: null, wantsKey: null };
  } catch { return { folder: null, wants: null, wantsKey: null }; }
}
/** This version of Bowerloom keeps no style in a folder permission, so the style of a permission is unknown. One place to change when it does. */
const grantStyleOf = (): Pick<SliceRow, 'grantStyle' | 'grantKey'> => ({ grantStyle: null, grantKey: null });

export async function readProject(ctx: ReadContext, dir: string): Promise<ProjectData> {
  const data = empty(dir);
  let project: ProjectContext;
  try { resolveInside(ctx.roots, dir); project = discoverProject(dir, ctx.home); }
  catch (error) { return { ...data, openCode: codeOf(error) }; }
  if (project.dir !== dir) return { ...data, openCode: 'PROJECT_MOVED' };

  // 1. The same words `bowerloom status` gives.
  let status: { status?: string; setup?: string; drift?: { kind: string; path: string; code?: string }[]; config?: Record<string, unknown> | null } = {};
  let statusCode: string | null = null;
  try { status = JSON.parse(await runProjectStatus(['status', '--json'], dir, ctx.home, ctx.env)); } catch (error) { statusCode = codeOf(error); }

  // 2. The items the project uses, and the lock.
  let resolved: Resolved | null = null, lockError: string | null = null, resolveCode: string | null = null;
  const config = (() => { try { return readConfig(project); } catch (error) { statusCode = statusCode ?? codeOf(error); return { state: 'absent' as const }; } })();
  if (config.state === 'valid') {
    try { resolved = resolveProject({ project, home: ctx.home, frozen: false, tolerateStore: true }); }
    catch (error) { const code = codeOf(error); if (code.startsWith('LOCK_')) lockError = code; else resolveCode = code; }
  }
  let lockOrphan = false;
  if (config.state !== 'valid') { try { lockOrphan = readLock(project).state === 'present'; } catch { lockOrphan = true; } }

  // 3. The agents, slices, and holds.
  const plan = await readProjectPlan(project, ctx.env, ctx.home);
  const agents: AgentRow[] = plan.agents.map(a => ({ role: a.id, team: a.team, state: a.state, action: a.action, hold: a.hold, notices: [...a.notices], slices: [...a.context.slices] }));
  const slices: SliceRow[] = plan.slices.map(s => ({
    id: s.id, state: s.state, hold: s.hold ?? null, rootKind: s.root === null ? 'unknown' : s.root.kind, rootName: s.root?.kind === 'registered' ? s.root.name : null, rootPath: s.root?.path ?? null,
    members: s.members.length, agents: s.agents, indexBytes: null, memberBytes: null,
    ...((): Pick<SliceRow, 'folder' | 'wants' | 'wantsKey'> => { const d = sliceDefinition(dir, s.id); return { folder: s.root?.kind === 'registered' ? s.root.name : d.folder, wants: d.wants, wantsKey: d.wantsKey }; })(),
    ...grantStyleOf(),
  }));

  // 4. The size comparison, only when there is a slice to compare.
  let measure: MeasureRow[] = [], measureCode: string | null = null, baselineBytes: number | null = null, baselineFiles: number | null = null;
  if (slices.length > 0 && agents.length > 0) {
    try {
      const m = await measureContext({ project, stateRoot: privateStateRoot(ctx.env, ctx.home), home: ctx.home, agents: [], team: null, from: dir, baseline: null, bytesPerTokenMilli: null, user: false });
      baselineBytes = m.baseline.bytes; baselineFiles = m.baseline.files;
      measure = m.agents.map(a => ({ role: a.role, startBytes: a.start.bytes, baselineBytes: a.baseline.bytes, startTokens: a.start.tokens, baselineTokens: a.baseline.tokens }));
      for (const a of m.agents) for (const s of a.start.slices) { const row = slices.find(x => x.id === s.id); if (row && row.indexBytes === null) { row.indexBytes = s.indexBytes; row.memberBytes = s.memberBytes; } }
    } catch (error) { measureCode = codeOf(error); }
  }

  const drift = (status.drift ?? []).map(d => ({ kind: d.kind, path: d.path, code: d.code ?? null }));
  const lockState = resolved?.lock.state ?? (lockError !== null ? 'invalid' : lockOrphan ? 'orphan' : 'not-used');
  const lockCode = resolved?.lock.code ?? lockError ?? null;
  const items = resolved === null ? [] : itemsOf(resolved);
  const staleItems = items.filter(i => i.lock === 'changed' || i.lock === 'missing').length;
  const lockProblem = ['invalid', 'orphan'].includes(lockState) || drift.some(d => d.kind === 'lock-invalid' || d.kind === 'lock-orphan');
  const notSetUp = config.state === 'absent' && project.bowerloomIdentity === null && !lockOrphan;
  const unexpected = plan.unavailable !== null && !['MANAGED_SKILL_LEGACY_PRESENT', 'MANAGED_SKILL_RECOVERY_REQUIRED', 'REVISION_PENDING', 'SKILLS_OFFLINE'].includes(plan.unavailable);
  const drifted = status.status === 'drifted' || status.status === 'revision-pending' || ['stale', 'mismatch'].includes(lockState) || plan.held.length > 0 || staleItems > 0 || resolved?.storeCode != null || resolveCode !== null || unexpected || config.state === 'invalid' || items.some(i => i.hold !== null);
  const projectStatus: ProjectStatus = notSetUp ? 'not-set-up' : statusCode !== null && status.status === undefined ? 'unreadable' : lockProblem ? 'lock-problem' : drifted ? 'drifted' : 'ready';

  return {
    ...data, status: projectStatus, setup: status.status ?? null,
    configState: config.state, configCode: config.state === 'invalid' ? config.code : null, lockState, lockCode,
    drift: resolveCode === null ? drift : [...drift, { kind: 'resolve-error', path: 'bowerloom.json', code: resolveCode }],
    notes: resolved?.notes.map(n => n.trim()) ?? [], storeCode: resolved?.storeCode ?? null, unavailable: plan.unavailable,
    items, agents, slices, held: plan.held.map(h => ({ kind: h.kind, id: h.id, code: h.code, next: h.next })), measure, measureCode, baselineBytes, baselineFiles,
    lockRows: lockRowsOf(resolved), shared: resolved?.shared ?? false,
    openCode: statusCode !== null && status.status === undefined ? statusCode : null,
  };
}

// ------------------------------------------------------------------------------------------------------------ folders

export function readFolders(ctx: ReadContext, projects: readonly ProjectData[], contexts: ReadonlyMap<string, ProjectContext>): FolderData[] {
  let list;
  try { list = listFolders(ctx.home); } catch { return []; }
  return list.folders.map(f => {
    const allowed: string[] = [], outdated: string[] = [];
    if (f.state !== 'refused' || f.code !== 'FOLDER_INVALID') {
      let ids: readonly string[] = [];
      try { ids = listFolderGrants(ctx.home, f.name).projectIds; } catch { ids = []; }
      for (const p of projects) {
        const pc = contexts.get(p.key);
        if (pc === undefined || !ids.includes(pc.projectId)) continue;
        try { (resolveRegisteredFolder(ctx.home, f.name, { projectId: pc.projectId, birthtimeNs: pc.identity.birthtimeNs }).ok ? allowed : outdated).push(p.key); } catch { outdated.push(p.key); }
      }
    }
    return { name: f.name, path: f.path, state: f.state, code: f.code, allowed, outdated };
  });
}

// -------------------------------------------------------------------------------------------------------------- cache

export async function readCache(ctx: ReadContext): Promise<CacheData> {
  try {
    const list = await listCache({ stateRoot: privateStateRoot(ctx.env, ctx.home), project: null, home: ctx.home, env: ctx.env });
    const entries = list.entries.map(e => ({ id: e.id, scope: e.scope, label: e.label, status: e.status, bytes: e.bytes, files: e.files, usedByStore: e.references.store, usedByProject: e.references.project }));
    return {
      state: 'ok', code: null, entries, totalBytes: list.totals.bytes, totalEntries: list.totals.entries, unknownSize: list.entries.filter(e => e.bytes === null).length,
      unlisted: list.unlisted, truncated: list.truncated, unreadable: list.unreadable.map(u => `${u.source} (${u.code})`),
    };
  } catch (error) {
    return { state: 'unavailable', code: codeOf(error), entries: [], totalBytes: 0, totalEntries: 0, unknownSize: 0, unlisted: 0, truncated: false, unreadable: [] };
  }
}

// ----------------------------------------------------------------------------------------------------------- snapshot

export async function readSnapshot(ctx: ReadContext): Promise<{ snapshot: Snapshot; contexts: Map<string, ProjectContext> }> {
  const problems: Snapshot['problems'] = [];
  const store = readStoreData(ctx);
  const { library, storeProblem } = readLibrary(ctx);
  if (storeProblem !== null && store.state === 'ready') problems.push({ area: 'library', code: storeProblem });
  const found = scanRoots(ctx.roots);
  const projects: ProjectData[] = [];
  const contexts = new Map<string, ProjectContext>();
  for (const dir of found.dirs) {
    projects.push(await readProject(ctx, dir));
    try { contexts.set(dir, discoverProject(dir, ctx.home)); } catch { /* shown as unreadable */ }
  }
  // Which projects use which library item.
  for (const p of projects) for (const i of p.items) {
    if (i.from !== 'store') continue;
    const list = i.kind === 'skill' ? library.skills : i.kind === 'prompt' ? library.prompts : library.teams;
    list.find(x => x.id === i.id)?.usedBy.push(p.key);
  }
  const folders = readFolders(ctx, projects, contexts);
  const cache = await readCache(ctx);
  if (inspectStoreSafe(ctx.home) === 'foreign') problems.push({ area: 'store', code: 'STORE_INVALID' });
  return { snapshot: { mode: ctx.mode, at: new Date().toISOString(), store, library, folders, projects, cache, scan: found.info, problems }, contexts };
}
function inspectStoreSafe(home: string): string { try { return inspectStore(home).state; } catch { return 'unreadable'; } }
export { LOCK_FILE };
