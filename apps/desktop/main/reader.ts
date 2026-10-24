/**
 * Reads everything Bowerloom manages and returns it as plain data. It calls Bowerloom's own read functions in this
 * process: it starts no command, opens no port, and never calls a function that writes.
 */
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { discoverProject, inspectStore, listFolderGrants, listFolders, privateStateRoot, resolveRegisteredFolder } from '../../../packages/project-context/src/index.js';
import type { ProjectContext } from '../../../packages/project-context/src/types.js';
import { LOCK_FILE, readConfig, readLock, lockItem, lockSourceLabel } from '../../../packages/project-config/src/index.js';
import { listCache } from '../../../packages/project-sync/src/index.js';
import { measureContext } from '../../../packages/project-sync/src/context-measure.js';
import { resolveProject } from '../../../packages/project-sync/src/index.js';
import type { Resolved, ResolvedItem } from '../../../packages/project-sync/src/index.js';
import { listProject, listStore } from '../../cli/src/ls.js';
import type { Listing } from '../../cli/src/ls.js';
import { report } from '../../cli/src/store.js';
import { runProjectStatus } from '../../cli/src/project-status.js';
import { readProjectPlan } from '../../cli/src/viewer-read.js';
import { parseSlice } from '../../../packages/context-slices/src/index.js';
import { LIMITS, readGuarded } from '../../../packages/project-authoring/src/files.js';
import type {
  FolderRole, AgentRow, CacheData, FolderData, ItemKind, Library, LibraryItem, LockMatch, MeasureRow, Mode, Origin, ProjectData, ProjectItem, ProjectStatus, Snapshot, SliceRow, StoreData,
} from '../shared/types.js';
import { scanRoots } from './scan.js';
import { guessRole, pageCount } from './roles.js';
import { OutsideRoot, resolveInside } from './safe.js';
import { tokenState } from './token.js';

export interface ReadContext { mode: Mode; home: string; env: NodeJS.ProcessEnv; roots: string[]; includeExamples?: boolean; roles?: Record<string, FolderRole>; tokenSource?: NodeJS.ProcessEnv }

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
  try { listing = listStore(ctx.home); } catch (error) { return { library: { skills: [], prompts: [], teams: [], unlisted: 0, pinsError: null, failed: codeOf(error) }, storeProblem: codeOf(error) }; }
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
      unlisted: listing.unlisted, pinsError: listing.pinsError ?? null, failed: null,
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
      out.push({ kind, id: row.id, from: row.origin === 'project' ? 'project' : 'store', via: row.via, resolvedFrom: row.resolvedFrom, origin, pin: pinOfRow(row), hold: row.hold, lock: matchOf(resolved, kind, row), note: null });
    }
  }
  return out;
}

/**
 * Items that sit in the project's own folders but that Bowerloom does not list as items: the personal assistant skill that setup
 * writes and keeps for itself (it is never in skills.json), and anything else a person left there. They are shown, so that the counts
 * match what is on disk, and are marked as what they are. Names only come from Bowerloom's own listing (`ls`).
 */
function onDiskOnly(project: ProjectContext, resolved: Resolved | null): ProjectItem[] {
  let listing: Listing;
  try { listing = listProject(project); } catch { return []; }
  const have = (kind: ItemKind): Set<string> => new Set((resolved === null ? [] : kind === 'skill' ? resolved.skills : kind === 'prompt' ? resolved.prompts : resolved.teams).map(r => r.id));
  const out: ProjectItem[] = [];
  for (const [kind, ids] of [['skill', listing.skills], ['prompt', listing.prompts], ['team', listing.teams]] as const) {
    const known = have(kind);
    for (const id of ids) if (!known.has(id)) out.push({ kind, id, from: 'project', via: [], resolvedFrom: 'project', origin: 'yours', pin: null, hold: null, lock: 'not-used', note: id === 'personal-assistant' && kind === 'skill' ? 'reserved' : 'unlisted' });
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

/** The repository that a folder is a checkout of, found cheaply from its `.git`: a `gitdir:` file (a linked work tree) or a folder. Null when none. */
export function gitCommonDir(dir: string): string | null {
  const dot = join(dir, '.git');
  try {
    const stat = lstatSync(dot);
    if (stat.isDirectory()) return dot;
    if (!stat.isFile() || stat.size > 4096) return null;
    const m = /^gitdir:\s*(.+)\s*$/m.exec(readFileSync(dot, 'utf8'));
    if (m === null) return null;
    const git = resolve(dir, m[1]!);
    const at = git.lastIndexOf(`${sep}worktrees${sep}`);
    return at > 0 ? git.slice(0, at) : git;
  } catch { return null; }
}

const empty = (dir: string): ProjectData => ({
  key: dir, name: basename(dir), dir, layout: 'none', role: 'project', roleGuess: 'project', roleChosen: false, pages: null, readBy: [], ownedEdited: [], gitCommon: null, label: basename(dir), status: 'unreadable', openCode: null, setup: null, configState: 'absent', configCode: null, lockState: 'not-used', lockCode: null,
  drift: [], notes: [], storeCode: null, unavailable: null, items: [], agents: [], slices: [], held: [], measure: [], measureCode: null, baselineBytes: null, baselineFiles: null, lockRows: [], shared: false,
});


/**
 * What a slice definition says about its folder and what it wants to show, read with Bowerloom's own slice parser
 * (parseSlice) from the definition file, which is read with the guarded reader. Known even when the slice is held.
 */
function sliceDefinition(dir: string, id: string): { folder: string | null; wants: SliceRow['wants']; wantsKey: string | null } {
  try {
    const real = resolveInside([dir], join(dir, '.bowerloom', 'slices', `${id}.yaml`));
    const parsed = parseSlice(readGuarded(real, LIMITS.fileBytes).toString('utf8'), id);
    if (!parsed.ok) return { folder: null, wants: null, wantsKey: null };
    const def = parsed.slice, folder = def.root.kind === 'registered' ? def.root.name : null;
    return { folder, wants: def.summary.kind, wantsKey: def.summary.kind === 'frontmatter' ? def.summary.key : null };
  } catch { return { folder: null, wants: null, wantsKey: null }; }
}
export type Grant = { state: 'absent' } | { state: 'legacy' } | { state: 'kind'; style: 'heading' | 'frontmatter'; key: string | null } | { state: 'unknown'; code: string };
/**
 * What this project's permission for a registered folder says, learned from Bowerloom's own lookup (resolveRegisteredFolder).
 * Asking for the `heading` style: "ok" means the permission is for headings; FOLDER_NOT_ALLOWED names the style the permission
 * is for (`granted`), says it is an older one (`legacy`), or names neither (no permission). Any other answer, such as a folder
 * or record that is gone or unsafe, or an error, says nothing about the permission: it is `unknown`, with its code, and is
 * never read as "no permission" or as a style.
 */
export function grantOf(home: string, folder: string, project: ProjectContext): Grant {
  try {
    const found = resolveRegisteredFolder(home, folder, { projectId: project.projectId, birthtimeNs: project.identity.birthtimeNs, summary: 'heading' });
    if (found.ok) return { state: 'kind', style: 'heading', key: null };
    if (found.code !== 'FOLDER_NOT_ALLOWED') return { state: 'unknown', code: found.cause ?? found.code };
    if (found.legacy === true) return { state: 'legacy' };
    if (found.granted === undefined) return { state: 'absent' };
    return found.granted.startsWith('frontmatter:') ? { state: 'kind', style: 'frontmatter', key: found.granted.slice(12) } : { state: 'kind', style: 'heading', key: null };
  } catch (error) { return { state: 'unknown', code: codeOf(error) }; }
}
const grantFields = (g: Grant | null): Pick<SliceRow, 'grantStyle' | 'grantKey' | 'grantCode'> =>
  g === null ? { grantStyle: null, grantKey: null, grantCode: null }
    : g.state === 'absent' ? { grantStyle: 'absent', grantKey: null, grantCode: null } : g.state === 'legacy' ? { grantStyle: 'unset', grantKey: null, grantCode: null }
    : g.state === 'unknown' ? { grantStyle: 'unknown', grantKey: null, grantCode: g.code } : { grantStyle: g.style, grantKey: g.key, grantCode: null };

/** Gives each folder its kind: the guess, then the person's own choice if they made one. Context stores also get their pages and who reads them. */
function assignRoles(ctx: ReadContext, projects: ProjectData[], folders: readonly FolderData[]): void {
  const allDirs = projects.map(p => p.dir), registeredDirs = folders.flatMap(f => f.dir === null ? [] : [f.dir]);
  for (const p of projects) {
    p.roleGuess = guessRole({ dir: p.dir, allDirs, registeredDirs });
    const chosen = ctx.roles?.[p.dir];
    p.role = chosen ?? p.roleGuess; p.roleChosen = chosen !== undefined;
    if (p.role === 'context-store') {
      p.pages = pageCount(p.dir);
      // Who reads it: a project allowed to read a registered folder that is this store, or that has a reading list on it.
      for (const f of folders) {
        if (f.dir === null || f.dir !== p.dir) continue;
        for (const key of f.allowed) { const q = projects.find(x => x.key === key); if (q !== undefined) p.readBy.push({ key, name: q.name, via: 'permission', list: null }); }
        for (const q of projects) for (const sl of q.slices) if (sl.folder === f.name) p.readBy.push({ key: q.key, name: q.name, via: 'reading-list', list: sl.id });
      }
    }
  }
}

/** Reads one project. One project that cannot be read never fails the others: any unexpected error makes it `Cannot open`. */
export async function readProject(ctx: ReadContext, dir: string): Promise<ProjectData> {
  try { return await readProjectInner(ctx, dir); } catch (error) { return { ...empty(dir), openCode: codeOf(error) }; }
}

async function readProjectInner(ctx: ReadContext, dir: string): Promise<ProjectData> {
  const data = empty(dir);
  let project: ProjectContext;
  try { resolveInside(ctx.roots, dir); project = discoverProject(dir, ctx.home); }
  catch (error) { return { ...data, openCode: codeOf(error) }; }
  if (project.dir !== dir) return { ...data, openCode: 'PROJECT_MOVED' };

  // 1. The same words `bowerloom status` gives.
  let status: { status?: string; setup?: string; drift?: { kind: string; path: string; code?: string }[]; owned?: { path: string; state: string }[]; config?: Record<string, unknown> | null } = {};
  let statusCode: string | null = null;
  try { status = JSON.parse(await runProjectStatus(['status', '--json'], dir, ctx.home, ctx.env)); } catch (error) { statusCode = codeOf(error); }

  // 2. The items the project uses, and the lock.
  let resolved: Resolved | null = null, lockError: string | null = null, resolveCode: string | null = null;
  let configProblem: string | null = null;
  const config = (() => { try { return readConfig(project); } catch (error) { configProblem = codeOf(error); return { state: 'absent' as const }; } })();
  // A bowerloom.json that is there but cannot be read is a project Bowerloom cannot open, never one that is not set up.
  if (configProblem === null && config.state === 'absent' && project.configPresent) configProblem = 'CONFIG_UNREADABLE';
  if (configProblem !== null) return { ...data, status: 'unreadable', openCode: configProblem, configState: 'invalid', configCode: configProblem };
  const older = config.state === 'absent' && project.bowerloomIdentity !== null;
  // A project with no bowerloom.json but a .bowerloom folder is set up the older way. Bowerloom's resolver reads it as it always has:
  // the skills in its skills.json, its prompts, and its teams.
  if (config.state === 'valid' || older) {
    try { resolved = resolveProject({ project, home: ctx.home, frozen: false, tolerateStore: true }); }
    catch (error) { const code = codeOf(error); if (code.startsWith('LOCK_')) lockError = code; else resolveCode = code; }
  }
  let lockOrphan = false;
  if (config.state !== 'valid') { try { lockOrphan = readLock(project).state === 'present'; } catch { lockOrphan = true; } }

  // 3. The agents, slices, and holds.
  const plan = await readProjectPlan(project, ctx.env, ctx.home).catch((error: unknown) => ({ agents: [], prompts: [], skills: [], slices: [], held: [], unavailable: codeOf(error) } as Awaited<ReturnType<typeof readProjectPlan>>));
  const agents: AgentRow[] = plan.agents.map(a => ({ role: a.id, team: a.team, state: a.state, action: a.action, hold: a.hold, notices: [...a.notices], slices: [...a.context.slices] }));
  const slices: SliceRow[] = plan.slices.map(s => {
    const def = sliceDefinition(dir, s.id), folder = s.root?.kind === 'registered' ? s.root.name : def.folder;
    return {
      id: s.id, state: s.state, hold: s.hold ?? null, rootKind: s.root === null ? 'unknown' : s.root.kind, rootName: s.root?.kind === 'registered' ? s.root.name : null, rootPath: s.root?.path ?? null,
      members: s.members.length, agents: s.agents, indexBytes: null, memberBytes: null, folder, wants: def.wants, wantsKey: def.wantsKey,
      ...grantFields(folder === null ? null : grantOf(ctx.home, folder, project)),
    };
  });

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
  const items = [...(resolved === null ? [] : itemsOf(resolved)), ...onDiskOnly(project, resolved)];
  const staleItems = items.filter(i => i.lock === 'changed' || i.lock === 'missing').length;
  const lockProblem = ['invalid', 'orphan'].includes(lockState) || drift.some(d => d.kind === 'lock-invalid' || d.kind === 'lock-orphan');
  const notSetUp = config.state === 'absent' && project.bowerloomIdentity === null && !lockOrphan;
  // Anything the plan could not do is a thing to look at: a pinned skill not downloaded yet, a change that was started and not
  // finished, or a recovery that is needed. `Ready` is for a project whose lock is used and matches, with nothing held.
  const drifted = status.status === 'drifted' || status.status === 'revision-pending' || ['stale', 'mismatch', 'absent'].includes(lockState) || plan.held.length > 0 || staleItems > 0 || resolved?.storeCode != null || resolveCode !== null
    || plan.unavailable !== null || config.state === 'invalid' || items.some(i => i.hold !== null) || slices.some(x => x.grantStyle === 'unknown');
  // Only a project that uses the shared library has a lock to compare. One set up the older way has none, and is Ready or not by its own check.
  const unlocked = !older && lockState !== 'valid';
  const projectStatus: ProjectStatus = notSetUp ? 'not-set-up' : statusCode !== null && status.status === undefined ? 'unreadable' : lockProblem ? 'lock-problem' : drifted ? 'drifted' : unlocked ? 'not-locked' : 'ready';

  return {
    ...data, layout: older ? 'older' : config.state === 'absent' ? 'none' : 'library', ownedEdited: (status.owned ?? []).filter(o => o.state === 'edited').map(o => o.path), gitCommon: gitCommonDir(dir), status: projectStatus, setup: status.status ?? null,
    configState: config.state, configCode: config.state === 'invalid' ? config.code : null, lockState, lockCode,
    drift: resolveCode === null ? drift : [...drift, { kind: 'resolve-error', path: 'bowerloom.json', code: resolveCode }],
    notes: resolved?.notes.map(n => n.trim()) ?? [], storeCode: resolved?.storeCode ?? null, unavailable: plan.unavailable,
    items, agents, slices, held: plan.held.map(h => ({ kind: h.kind, id: h.id, code: h.code, next: h.next })), measure, measureCode, baselineBytes, baselineFiles,
    lockRows: lockRowsOf(resolved), shared: resolved?.shared ?? false,
    openCode: statusCode !== null && status.status === undefined ? statusCode : null,
  };
}

// ------------------------------------------------------------------------------------------------------------ folders

/** The registered folders and who may read them. A list that cannot be read is `failed`, never an empty list. */
export function readFolders(ctx: ReadContext, projects: readonly ProjectData[], contexts: ReadonlyMap<string, ProjectContext>): { folders: FolderData[]; failed: string | null } {
  let list;
  try { list = listFolders(ctx.home); } catch (error) { return { folders: [], failed: codeOf(error) }; }
  const folders = list.folders.map(f => {
    const allowed: string[] = [], outdated: string[] = [], unstyled: string[] = [], styles: FolderData['styles'] = [], unknown: FolderData['unknown'] = [];
    if (f.state !== 'refused' || f.code !== 'FOLDER_INVALID') {
      let ids: readonly string[] | null = null, listCode = '';
      try { ids = listFolderGrants(ctx.home, f.name).projectIds; } catch (error) { listCode = codeOf(error); }
      for (const p of projects) {
        const pc = contexts.get(p.key);
        if (pc === undefined) continue;
        // If the grant list cannot be read, no project's permission is known.
        if (ids === null) { unknown.push({ key: p.key, code: listCode }); continue; }
        if (!ids.includes(pc.projectId)) continue;
        const g = grantOf(ctx.home, f.name, pc);
        if (g.state === 'kind') { allowed.push(p.key); styles.push({ key: p.key, style: g.style, styleKey: g.key }); }
        else if (g.state === 'legacy') unstyled.push(p.key);
        else if (g.state === 'unknown') unknown.push({ key: p.key, code: g.code });
        else outdated.push(p.key);
      }
    }
    return { name: f.name, path: f.path, dir: f.path === null ? null : join(ctx.home, f.path.replace(/^~\//, '')), state: f.state, code: f.code, allowed, outdated, styles, unstyled, unknown };
  });
  return { folders, failed: null };
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
  const found = scanRoots(ctx.roots, { includeExamples: ctx.includeExamples === true });
  const projects: ProjectData[] = [];
  const contexts = new Map<string, ProjectContext>();
  for (const dir of found.dirs) {
    projects.push(await readProject(ctx, dir));
    try { contexts.set(dir, discoverProject(dir, ctx.home)); } catch { /* shown as unreadable */ }
  }
  // Two projects with one name are told apart by their path inside the folder that was chosen.
  const byName = new Map<string, ProjectData[]>();
  for (const p of projects) byName.set(p.name, [...(byName.get(p.name) ?? []), p]);
  for (const same of byName.values()) {
    if (same.length < 2) continue;
    for (const p of same) {
      const root = ctx.roots.map(r => { try { return realpathSync(r); } catch { return r; } }).filter(r => p.dir === r || p.dir.startsWith(r.endsWith(sep) ? r : r + sep)).sort((a, b) => b.length - a.length)[0];
      const rel = root === undefined ? p.dir : relative(root, p.dir);
      p.name = rel === '' ? `${basename(p.dir)} (the folder you chose)` : rel;
    }
  }
  for (const p of projects) p.label = p.name;
  // Which projects use which library item.
  for (const p of projects) for (const i of p.items) {
    if (i.from !== 'store') continue;
    const list = i.kind === 'skill' ? library.skills : i.kind === 'prompt' ? library.prompts : library.teams;
    list.find(x => x.id === i.id)?.usedBy.push(p.key);
  }
  const folderRead = readFolders(ctx, projects, contexts), folders = folderRead.folders;
  if (folderRead.failed !== null) problems.push({ area: 'folders', code: folderRead.failed });
  assignRoles(ctx, projects, folders);
  const cache = await readCache(ctx);
  if (inspectStoreSafe(ctx.home) === 'foreign') problems.push({ area: 'store', code: 'STORE_INVALID' });
  return { snapshot: { mode: ctx.mode, at: new Date().toISOString(), store, library, folders, projects, cache, scan: found.info, problems }, contexts };
}
function inspectStoreSafe(home: string): string { try { return inspectStore(home).state; } catch { return 'unreadable'; } }
export { LOCK_FILE };
