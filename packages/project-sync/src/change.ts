/**
 * Changes to `bowerloom.json` and `bowerloom.lock.json` (spec 06, 3.5 to 3.15): `use`, `unuse`, the config and lock part
 * of `team adopt`, and `lock update`. A plan reads the config, the lock, the store definitions and, for an authored
 * store item a lock must record, its pushed copy on github.com. Apply reads no network: under the project lock it reads
 * the same files again, refuses STALE_APPROVAL for any difference, and writes the planned bytes.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DefinitionError, canonicalJson } from '../../contracts/src/index.js';
import { inspectStore, isHeldProjectLock, projectRefusal, adoptCreatedMarker, verifyProjectPins } from '../../project-context/src/index.js';
import type { HeldProjectLock, ProjectContext } from '../../project-context/src/types.js';
import { readConfig } from '../../project-config/src/config.js';
import { CONFIG_FORMAT, serializeConfig } from '../../project-config/src/schema.js';
import type { ConfigEntry, ProjectConfig } from '../../project-config/src/schema.js';
import { configRefusal, honestShared, notShareable, refusalWithNext } from '../../project-config/src/refusal.js';
import { LOCK_FILE, LOCK_FORMAT, LOCK_LISTS, lockItem, lockSourceLabel, readLock, serializeLock } from '../../project-config/src/lock.js';
import type { LockItem, ProjectLock } from '../../project-config/src/lock.js';
import { isSharedProject } from '../../project-config/src/shared.js';
import { readStoreRepo } from '../../project-config/src/git.js';
import { scratchName, writeGuardedFile } from '../../project-config/src/write.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { HARNESSES, MANIFEST_LIMITS, parseManifest } from '../../skill-manifest/src/schema.js';
import type { Entry, Harness, PinnedEntry } from '../../skill-manifest/src/schema.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { createPublicTransport } from '../../skill-manifest/src/public-get.js';
import { proveAuthored } from '../../skill-manifest/src/resolve-store-git.js';
import type { AuthoredPin } from '../../skill-manifest/src/resolve-store-git.js';
import { readAuthoringState } from '../../project-authoring/src/state.js';
import { readStoreDefinitions } from './resolve.js';
import type { StoreDefinitions } from './resolve.js';
import { localItemRows } from './store-items.js';
import type { Credentials, StoreTransportFactory, TokenSource } from './store-git.js';
import { credentialsFor, onceTokenSource, repositoryOf, requireRequestBudget } from './store-git.js';
import type { GithubToken } from '../../skill-manifest/src/github-token.js';
import { syncError } from './refusal.js';
import { join } from 'node:path';
export { localItemRows } from './store-items.js';

export const CONFIG_CHANGE_FORMAT = 'bowerloom/config-change-plan/v1beta1' as const;
export const CONFIG_CHANGE_RESULT_FORMAT = 'bowerloom/config-change-result/v1beta1' as const;
export const LOCK_UPDATE_FORMAT = 'bowerloom/lock-update-plan/v1beta1' as const;
export const LOCK_UPDATE_RESULT_FORMAT = 'bowerloom/lock-update-result/v1beta1' as const;
type Kind = 'skill' | 'prompt' | 'team';
type Read = { sha256: string; bytes: number };
const LIST = { skill: 'skills', prompt: 'prompts', team: 'teams' } as const;
const sha = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const stale = (): Error => manifestRefusal('STALE_APPROVAL');
const HEX40 = /^[a-f0-9]{40}$/;

export interface StoreBindingRead { dir: string; identity: { device: string; inode: string; birthtimeNs: string; uid: number; mode: number }; skills: Read | null; authoring: Read | null }
export interface ConfigChangePlan {
  format: typeof CONFIG_CHANGE_FORMAT;
  project: { dir: string; identity: ProjectContext['identity']; ancestry: ProjectContext['ancestry']; bowerloomIdentity: ProjectContext['bowerloomIdentity'] };
  change: { op: 'use' | 'unuse' | 'adopt'; kind: Kind; id: string; source: 'store' | 'project' };
  created: boolean;
  bowerloomFolder: 'present' | 'create';
  adds: { kind: string; id: string; source: string; via: string[] }[];
  removes: { kind: string; id: string; source: string }[];
  /** Entries whose `via` this change removes: they become direct picks. */
  direct: { kind: string; id: string; via: string[] }[];
  config: { before: Read | null; after: Read; text: string };
  lock: { before: Read | null; after: Read; text: string; adds: string[]; removes: string[] } | null;
  /** The lock file as the plan read it, bound even when the plan writes no lock: one that appears before apply is stale (review C3). */
  lockBefore: Read | null;
  scratch: string[];
  store: StoreBindingRead | null;
  projectManifest: Read | null;
  /** `credentials` (spec 07, 4.3): the store repository when a token proves an authored item; else null. Bound. */
  network: { hosts: string[]; credentials: Credentials | null };
  /** The hash of each added authored item's live bytes, which apply reads again. */
  authored: { kind: Kind; id: string; hash: string }[];
  /** What the review shows of the picked item: its source line, teams, and cache. Null for unuse and adopt. */
  detail: { source: string; teams: string | null; cache: string | null } | null;
  /** The number of project items a new bowerloom.json lists. */
  listed: number;
  notes: string[];
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface ConfigChangeResult { format: typeof CONFIG_CHANGE_RESULT_FORMAT; planRevision: string; change: ConfigChangePlan['change']; created: boolean; configSha256: string; configBytes: number; lockSha256: string | null; lockBytes: number | null; executionAuthorized: false }
export interface ChangeInput {
  project: ProjectContext; home: string; op: 'use' | 'unuse' | 'adopt'; kind: Kind; id: string;
  /** `use --project` picks the project item; else the store item. */
  source?: 'store' | 'project';
  /** `--commit <sha>`: the commit of the store remote a lock records. */
  commit?: string | null;
  signal?: AbortSignal; storeTransport?: StoreTransportFactory;
  /** Test hook: true when a token is set. A token in `githubToken` sets it too. */
  tokenSet?: boolean;
  /** Spec 07: the token of a private store remote, or the CLI's reader. Read only when an authored item is proved. */
  githubToken?: TokenSource;
}
export interface ChangeHooks { readonly afterConfig?: () => void }

/** The scratch files of an interrupted writer in the project folder: regular files the user owns, named `.<file>.<16 hex>.tmp`. */
export function scratchFiles(dir: string): string[] {
  const names: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!scratchName('bowerloom.json').test(name) && !scratchName(LOCK_FILE).test(name)) continue;
    try { const s = fs.lstatSync(join(dir, name)); if (s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid?.()) names.push(name); } catch { /* gone */ }
  }
  return names.sort(byteOrder);
}

/** The store, opened for a change: STORE_NOT_FOUND when absent, its own refusal when foreign or unsafe. */
function openStoreDefinitions(home: string): StoreDefinitions {
  const found = inspectStore(home);
  if (found.state === 'absent') throw projectRefusal('STORE_NOT_FOUND');
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  return readStoreDefinitions(found.context);
}
const storeRead = (defs: StoreDefinitions): StoreBindingRead => ({ dir: defs.view.context!.dir, identity: defs.view.context!.identity, skills: defs.view.skills ? { sha256: defs.view.skills.sha256, bytes: defs.view.skills.bytes } : null, authoring: defs.view.authoring?.sha256 && defs.view.authoring.bytes !== null ? { sha256: defs.view.authoring.sha256, bytes: defs.view.authoring.bytes } : null });

/** The config a first `use` creates: the project's harnesses, and every item the project defines now, from the project. */
export function initialConfig(project: ProjectContext): { config: ProjectConfig; manifest: Read | null; listed: number } {
  const state = readManifestState(project.dir, { allowAbsent: true });
  const manifest = state.file ? parseManifest(state.file.bytes, MANIFEST_LIMITS) : null;
  const items = project.bowerloomIdentity === null ? [] : readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? [];
  const first = project.bowerloomIdentity !== null && (() => { try { const s = fs.lstatSync(join(project.dir, '.bowerloom', 'teams', 'first-team')); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } })();
  const entry = (id: string): ConfigEntry => ({ id, source: 'project' });
  const config: ProjectConfig = {
    format: CONFIG_FORMAT, harnesses: manifest ? [...manifest.harnesses] : [...HARNESSES] as Harness[],
    skills: (manifest?.skills ?? []).map(s => entry(s.id)).sort((a, b) => byteOrder(a.id, b.id)),
    prompts: items.filter(i => i.kind === 'prompt').map(i => entry(i.id)).sort((a, b) => byteOrder(a.id, b.id)),
    teams: [...items.filter(i => i.kind === 'team').map(i => entry(i.id)), ...(first ? [entry('first-team')] : [])].sort((a, b) => byteOrder(a.id, b.id)),
  };
  return { config, manifest: state.file ? { sha256: state.file.sha256, bytes: state.file.bytes.length } : null, listed: config.skills.length + config.prompts.length + config.teams.length };
}

/** True when the project defines the item in `.bowerloom` (the definitions `use --project` and the resolver read). */
function projectDefines(project: ProjectContext, kind: Kind, id: string): boolean {
  if (kind === 'skill') { const s = readManifestState(project.dir, { allowAbsent: true }); return s.file !== null && parseManifest(s.file.bytes, MANIFEST_LIMITS).skills.some(e => e.id === id); }
  if (project.bowerloomIdentity === null) return false;
  if (kind === 'team' && id === 'first-team') { try { const s = fs.lstatSync(join(project.dir, '.bowerloom', 'teams', 'first-team')); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } }
  return (readAuthoringState(join(project.dir, '.bowerloom')).receipt?.value.items ?? []).some(i => i.kind === kind && i.id === id);
}
const storeDefines = (defs: StoreDefinitions, kind: Kind, id: string): boolean => kind === 'skill' ? defs.skills.has(id) : kind === 'prompt' ? defs.prompts.has(id) : defs.teams.has(id);
const duplicate = (kind: Kind, id: string): Error => configRefusal('CONFIG_DUPLICATE_ID', `bowerloom.json lists ${kind} ${id} twice: once from store and once from project.`);
const clone = (c: ProjectConfig): ProjectConfig => JSON.parse(JSON.stringify(c)) as ProjectConfig;
const listOf = (c: ProjectConfig, kind: Kind): ConfigEntry[] => c[LIST[kind]];
function put(c: ProjectConfig, kind: Kind, e: ConfigEntry): void { const list = listOf(c, kind); list.push(e); list.sort((a, b) => byteOrder(a.id, b.id)); }

/** The store teams tag of an item: the skill's own tag, a prompt's receipt teams. A team has none. */
function storeTeams(defs: StoreDefinitions, kind: Kind, id: string): string[] {
  if (kind === 'skill') return [...(defs.skills.get(id)?.teams ?? [])];
  if (kind === 'prompt') return [...(defs.prompts.get(id)?.teams ?? [])];
  return [];
}
/** The source line of a store item (3.5). */
function sourceLine(defs: StoreDefinitions, kind: Kind, id: string): string {
  if (kind === 'skill') {
    const e = defs.skills.get(id)!;
    if (e.source.kind === 'npm') return `npm ${e.source.package}@${e.source.version}:${(e as PinnedEntry).skill.sourceRoot}`;
    if (e.source.kind === 'git') return `GitHub ${e.source.repository}@${e.source.commit}:${(e as PinnedEntry).skill.sourceRoot}`;
    return `store skill (written in ~/.bowerloom/skills/${id})`;
  }
  return kind === 'prompt' ? `store prompt (written in ~/.bowerloom/prompts/${id}.md)` : `store team (written in ~/.bowerloom/teams/${id})`;
}

/** What a lock item needs: a copy of a pinned store entry, or the proof of an authored item on github.com. */
interface LockNeed { kind: Kind; id: string; pin: PinnedEntry | null; local: { hash: string; distinct: number; teams: string[] } | null }
function lockNeed(defs: StoreDefinitions, kind: Kind, id: string): LockNeed {
  if (kind === 'skill') { const e = defs.skills.get(id); if (!e) throw configRefusal('STORE_ITEM_MISSING'); if (e.source.kind !== 'local') return { kind, id, pin: e as PinnedEntry, local: null }; }
  else if (!storeDefines(defs, kind, id)) throw configRefusal('STORE_ITEM_MISSING');
  const rows = localItemRows(defs.view.context!.dir, kind, id);
  return { kind, id, pin: null, local: { hash: rows.hash, distinct: new Set(rows.rows.map(r => r.sha256)).size, teams: storeTeams(defs, kind, id) } };
}
/** The requests the proofs of `needs` take: 4 plus one per distinct sha256 each (3.10). */
export const requestCount = (needs: readonly { local: { distinct: number } | null }[]): number => needs.reduce((n, x) => n + (x.local ? 4 + x.local.distinct : 0), 0);
export const NETWORK_LINE = (n: number, r: number): string => `Network: reads api.github.com, to check the pushed copy of ${n} ${n === 1 ? 'item' : 'items'}, about ${r} requests to api.github.com.`;
export const NO_TOKEN_LINE = 'Without a token GitHub allows about 60 requests an hour. Set BOWERLOOM_GITHUB_TOKEN, or run the command again after an hour to finish.';

/**
 * Proves the authored needs against the store remote (3.10) and returns their lock items. The commit is `commit`
 * (`--commit`), else the pushed commit of the current branch. Network refusals follow the table of 3.10, and with a
 * token the table of spec 07, 3.7. `proof.credentials` gets the repository the token goes to.
 */
async function prove(defs: StoreDefinitions, needs: readonly LockNeed[], commit: string | null, input: Pick<ChangeInput, 'signal' | 'storeTransport'>, notes: string[], token: GithubToken | null = null, proof: { credentials: Credentials | null } = { credentials: null }): Promise<Map<string, LockItem>> {
  const out = new Map<string, LockItem>();
  for (const n of needs) if (n.pin !== null) out.set(`${n.kind} ${n.id}`, { id: n.id, from: 'store', pin: n.pin });
  const authored = needs.filter(n => n.local !== null);
  if (!authored.length) return out;
  const repo = readStoreRepo(defs.view.context!.dir, commit);
  if (repo.problem !== null) throw notShareable(repo.problem);
  if (commit === null && repo.head !== null && repo.head !== repo.pushed) notes.push(`Your store has commits that are not pushed (HEAD differs from origin/${repo.branch}). The lock records the pushed commit ${repo.pushed!.slice(0, 8)}.`);
  const signal = input.signal ?? new AbortController().signal, ids = authored.map(n => `${n.kind} ${n.id}`).join(', ');
  // Spec 07, section 6: with a token, every transport of the proof gets it for the store repository only.
  const repository = repositoryOf(repo.remote!), options = token !== null ? { githubAuth: { token, repositories: [repository] } } : {};
  proof.credentials = token !== null ? credentialsFor([repo.remote!]) : null;
  const make = () => (input.storeTransport ?? createPublicTransport)(options);
  for (const n of authored) {
    // Review F4 of PR 97: the transport is made inside the try, so a failure to make it is mapped like any other.
    let outcome, transport: ReturnType<typeof make> | null = null;
    try { transport = make(); outcome = await proveAuthored(transport, { remote: repo.remote!, commit: repo.pushed!, kind: n.kind, id: n.id, ...(n.kind !== 'team' ? { teams: n.local!.teams } : {}) }, n.local!.hash, signal, make); }
    catch (error) {
      if (signal.aborted) throw syncError('SKILLS_SYNC_INTERRUPTED', 'It stopped while checking the pushed copy, before any change.');
      // Review F3: only a network failure of the transport is offline; any other error keeps its code, or is rethrown.
      const code = error instanceof DefinitionError ? error.code : null;
      if (code === 'SKILLS_ADD_NETWORK') throw syncError('SKILLS_OFFLINE', `Checking ${ids} needs api.github.com. Connect to the network and run the command again.`);
      if (code === 'SKILLS_ADD_UNSAFE_CONTENT' || code === 'SKILLS_ADD_NOT_FOUND') throw configRefusal('LOCK_STORE_NOT_PUSHED');
      throw error;
    } finally { transport?.close(); }
    // Spec 07, 3.7: a commit of the ref that GitHub does not show, with a token, is a refused token or a wrong repository.
    // Review F2 of PR 97: with a token, an unreachable --commit may be a token that cannot read the repository.
    if (outcome.outcome === 'commit-missing') throw commit !== null ? (token !== null ? refusalWithNext('LOCK_COMMIT_UNREACHABLE', 'Push the store, or pass --commit <sha> of a pushed commit, or check that BOWERLOOM_GITHUB_TOKEN can read the repository.') : configRefusal('LOCK_COMMIT_UNREACHABLE')) : token !== null ? manifestRefusal('STORE_REMOTE_AUTH_FAILED') : configRefusal('STORE_REMOTE_PRIVATE');
    if (outcome.outcome === 'not-pushed') throw configRefusal('LOCK_STORE_NOT_PUSHED');
    out.set(`${n.kind} ${n.id}`, { id: n.id, from: 'store', authored: outcome.pin });
  }
  return out;
}

/** Reads the lock for a change: absent, or present. An unreadable lock refuses with its own code. */
function lockFor(project: ProjectContext): { lock: ProjectLock | null; read: Read | null } {
  const got = readLock(project);
  return got.state === 'present' ? { lock: got.lock, read: { sha256: got.sha256, bytes: got.bytes } } : { lock: null, read: null };
}
const storeEntries = (c: ProjectConfig): string[] => LOCK_LISTS.flatMap(([name, kind]) => c[name].filter(e => e.source === 'store').map(e => `${kind} ${e.id}`));
function lockFrom(items: ReadonlyMap<string, LockItem>): ProjectLock {
  const lock: ProjectLock = { format: LOCK_FORMAT, skills: [], prompts: [], teams: [] };
  for (const [pair, item] of items) { const kind = pair.split(' ')[0] as Kind; lock[LIST[kind]].push(item); }
  for (const [name] of LOCK_LISTS) lock[name].sort((a, b) => byteOrder(a.id, b.id));
  return lock;
}
const pairsOf = (lock: ProjectLock | null): Map<string, LockItem> => new Map(lock ? LOCK_LISTS.flatMap(([name, kind]) => lock[name].map(i => [`${kind} ${i.id}`, i] as const)) : []);

/** Plans `use`, `unuse`, or the config part of `team adopt`. Reads only; `use` may read api.github.com for a lock proof. */
export async function planConfigChange(input: ChangeInput): Promise<ConfigChangePlan> {
  const { project, op, kind, id } = input, source = op === 'use' ? input.source ?? 'store' : op === 'adopt' ? 'store' : 'store';
  // bowerloom.json lists skills, prompts and teams only. A context slice is a project item (spec 10, 2), and any other kind is no item.
  if (kind !== 'skill' && kind !== 'prompt' && kind !== 'team') throw new DefinitionError('USAGE', 'Use bowerloom use or unuse with skill, prompt, or team.');
  if (input.commit !== undefined && input.commit !== null && !HEX40.test(input.commit)) throw new DefinitionError('USAGE', 'Use --commit with the 40 lower-case hex characters of a pushed commit.');
  verifyProjectPins(project);
  const read = readConfig(project);
  if (read.state === 'invalid') throw configRefusal(read.code);
  if (read.state === 'absent' && project.configPresent) throw projectRefusal('PROJECT_UNSAFE');
  // Decision 1 on #80 (variant A): `team adopt` of a team that is not listed creates bowerloom.json too, as `use` does.
  if (read.state === 'absent' && op !== 'use' && op !== 'adopt') throw configRefusal('CONFIG_ITEM_NOT_SELECTED');
  const initial = read.state === 'absent' ? initialConfig(project) : null;
  // The adopted team is added below. Apply plans again after the copy registers it, so the first list leaves it out.
  if (initial !== null && op === 'adopt') { initial.config.teams = initial.config.teams.filter(e => e.id !== id); initial.listed = initial.config.skills.length + initial.config.prompts.length + initial.config.teams.length; }
  const before: ProjectConfig = read.state === 'valid' ? read.config : initial!.config, next = clone(before);
  const adds: ConfigChangePlan['adds'] = [], removes: ConfigChangePlan['removes'] = [], direct: ConfigChangePlan['direct'] = [], notes: string[] = [];
  let defs: StoreDefinitions | null = null, detail: ConfigChangePlan['detail'] = null;
  const find = (k: Kind, i: string) => listOf(next, k).find(e => e.id === i) ?? null;
  if (op === 'use' && source === 'store') {
    defs = openStoreDefinitions(input.home);
    if (!storeDefines(defs, kind, id)) throw configRefusal('STORE_ITEM_NOT_FOUND');
    const now = find(kind, id);
    if (now?.source === 'project') throw duplicate(kind, id);
    if (now && !now.via) throw configRefusal('CONFIG_ITEM_SELECTED');
    if (now) { direct.push({ kind, id, via: [...now.via!] }); delete now.via; }
    else { put(next, kind, { id, source: 'store' }); adds.push({ kind, id, source: 'store', via: [] }); }
    if (kind === 'team') {
      // 3.6: the store skills and prompts that name the team come with it, through it.
      const tagged: [Kind, string][] = [...[...defs.skills.entries()].filter(([, e]) => (e.teams ?? []).includes(id)).map(([s]) => ['skill', s] as [Kind, string]), ...[...defs.prompts.values()].filter(p => p.teams.includes(id)).map(p => ['prompt', p.id] as [Kind, string])];
      for (const [k, i] of tagged) {
        const e = find(k, i);
        if (e?.source === 'project') throw duplicate(k, i);
        if (e && !e.via) continue;
        if (e) { e.via = [...new Set([...e.via!, id])].sort(byteOrder); continue; }
        put(next, k, { id: i, source: 'store', via: [id] }); adds.push({ kind: k, id: i, source: 'store', via: [id] });
      }
    }
    const e = defs.skills.get(id), teams = kind === 'team' ? null : storeTeams(defs, kind, id);
    detail = { source: sourceLine(defs, kind, id), teams: teams === null ? null : teams.length ? teams.join(', ') : 'every team', cache: kind === 'skill' && e && e.source.kind !== 'local' ? 'pinned' : null };
  } else if (op === 'use') {
    if (!projectDefines(project, kind, id)) throw configRefusal('CONFIG_ITEM_MISSING');
    const now = find(kind, id);
    if (now?.source === 'project') throw configRefusal('CONFIG_ITEM_SELECTED');
    if (now) throw duplicate(kind, id);
    put(next, kind, { id, source: 'project' }); adds.push({ kind, id, source: 'project', via: [] });
  } else if (op === 'unuse') {
    const now = find(kind, id);
    if (!now) throw configRefusal('CONFIG_ITEM_NOT_SELECTED');
    listOf(next, kind).splice(listOf(next, kind).indexOf(now), 1); removes.push({ kind, id, source: now.source });
    if (kind === 'team') for (const k of ['skill', 'prompt', 'team'] as Kind[]) for (const e of [...listOf(next, k)]) {
      if (!e.via?.includes(id)) continue;
      e.via = e.via.filter(v => v !== id);
      if (!e.via.length) { listOf(next, k).splice(listOf(next, k).indexOf(e), 1); removes.push({ kind: k, id: e.id, source: e.source }); }
    }
  } else {
    const now = find('team', id);
    // Decision 1 on #80 (variant A): a team that is not listed is added from the project. One listed from the project
    // stays as it is: apply plans again after the create path, whose finish of a pending record may have listed it.
    if (!now) { put(next, 'team', { id, source: 'project' }); adds.push({ kind: 'team', id, source: 'project', via: [] }); }
    else if (now.source === 'store') { now.source = 'project'; delete now.via; }
    for (const k of ['skill', 'prompt', 'team'] as Kind[]) for (const e of listOf(next, k)) {
      if (!e.via?.includes(id)) continue;
      e.via = e.via.filter(v => v !== id);
      if (!e.via.length) { delete e.via; direct.push({ kind: k, id: e.id, via: [id] }); }
    }
  }
  const text = serializeConfig(next);
  // The lock: kept up to date in a shared project and in a project with a lock (3.9, 3.13).
  const current = lockFor(project), sharedState = isSharedProject(project), shared = sharedState.shared;
  // Review C4: a lock is created only when the new config has a store entry; an existing lock is always kept up to date.
  const writeLock = current.lock !== null || (op === 'use' && shared && storeEntries(next).length > 0);
  let lock: ConfigChangePlan['lock'] = null, authored: ConfigChangePlan['authored'] = [], hosts: string[] = [];
  const proof: { credentials: Credentials | null } = { credentials: null }, tokenOnce = onceTokenSource(input.githubToken);
  if (writeLock) try {
    const items = pairsOf(current.lock), wanted = new Set(storeEntries(next)), lockRemoves: string[] = [], lockAdds: string[] = [];
    for (const pair of [...items.keys()]) if (!wanted.has(pair)) { items.delete(pair); lockRemoves.push(pair); }
    if (op === 'use') {
      // `use` adds a lock item for every store entry that has none, the new ones and any an earlier crash left out.
      const missing = [...wanted].filter(p => !items.has(p)).sort(byteOrder);
      if (missing.length) {
        defs ??= openStoreDefinitions(input.home);
        const needs = missing.map(p => { const [k, i] = p.split(' ') as [Kind, string]; return lockNeed(defs!, k, i); });
        const authoredNeeds = needs.filter(n => n.local !== null);
        // Spec 07, 3.2: the token is read only for a proof, before any network read.
        const token = authoredNeeds.length ? tokenOnce() : null;
        if (authoredNeeds.length) {
          const r = requestCount(authoredNeeds); requireRequestBudget(r); notes.push(NETWORK_LINE(authoredNeeds.length, r)); if (r > 60 && !input.tokenSet && token === null) notes.push(NO_TOKEN_LINE);
          hosts = ['api.github.com']; authored = authoredNeeds.map(n => ({ kind: n.kind, id: n.id, hash: n.local!.hash }));
        }
        for (const [pair, item] of await prove(defs, needs, input.commit ?? null, input, notes, token, proof)) { items.set(pair, item); lockAdds.push(pair); }
      }
    }
    const lockText = serializeLock(lockFrom(items));
    lock = { before: current.read, after: { sha256: sha(lockText), bytes: Buffer.byteLength(lockText) }, text: lockText, adds: lockAdds.sort(byteOrder), removes: lockRemoves.sort(byteOrder) };
  } catch (error) { throw sharedState.unknown !== undefined ? honestShared(error, sharedState.unknown) : error; }
  const body: Omit<ConfigChangePlan, 'revision'> = {
    format: CONFIG_CHANGE_FORMAT,
    project: { dir: project.dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity },
    change: { op, kind, id, source }, created: read.state === 'absent',
    bowerloomFolder: op === 'adopt' && project.bowerloomIdentity === null ? 'create' : 'present',
    adds, removes, direct, config: { before: read.state === 'valid' ? { sha256: read.sha256, bytes: read.bytes } : null, after: { sha256: sha(text), bytes: Buffer.byteLength(text) }, text },
    lock, lockBefore: current.read, scratch: scratchFiles(project.dir), store: defs ? storeRead(defs) : null, projectManifest: initial?.manifest ?? null,
    network: { hosts, credentials: proof.credentials }, authored, detail, listed: initial?.listed ?? 0, notes, writesAuthorized: false, executionAuthorized: false,
  };
  return { ...body, revision: sha(canonicalJson(body)) };
}

/** The checks of apply: the files a plan read, read again, and the plan's own revision. Reads no network. */
function recheck(project: ProjectContext, home: string, plan: { revision: string; store: StoreBindingRead | null; authored: { kind: Kind; id: string; hash: string }[] }, configBefore: Read | null, lockBefore: Read | null | undefined, body: unknown): void {
  if (sha(canonicalJson(body)) !== plan.revision) throw stale();
  verifyProjectPins(project);
  const read = readConfig(project), now = read.state === 'absent' ? null : { sha256: read.sha256, bytes: read.bytes };
  if (canonicalJson(now) !== canonicalJson(configBefore)) throw stale();
  if (lockBefore !== undefined) { let l: Read | null; try { l = lockFor(project).read; } catch { throw stale(); } if (canonicalJson(l) !== canonicalJson(lockBefore)) throw stale(); }
  if (plan.store !== null) {
    let defs: StoreDefinitions; try { defs = openStoreDefinitions(home); } catch { throw stale(); }
    if (canonicalJson(storeRead(defs)) !== canonicalJson(plan.store)) throw stale();
    for (const a of plan.authored) { let h: string; try { h = localItemRows(plan.store.dir, a.kind, a.id).hash; } catch { throw stale(); } if (h !== a.hash) throw stale(); }
  }
}
/** Removes the leftover scratch files a plan listed: still regular files the user owns. */
function removeScratch(dir: string, names: readonly string[]): void {
  for (const name of names) { try { const s = fs.lstatSync(join(dir, name)); if (s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid?.()) fs.unlinkSync(join(dir, name)); } catch { /* gone */ } }
}

/**
 * Applies an approved config change under the held project lock (3.14): scratch, `bowerloom.json`, then the lock. A new
 * `bowerloom.json` is adopted as the project's marker right after it is written. Returns the result and the context.
 */
export function applyConfigChange(plan: ConfigChangePlan, revision: string, held: HeldProjectLock, project: ProjectContext, home: string, hooks: ChangeHooks = {}): { result: ConfigChangeResult; project: ProjectContext } {
  if (!isHeldProjectLock(held)) throw manifestRefusal('PROJECT_LOCKED');
  held.assertHeld(project.dir);
  if (typeof revision !== 'string' || revision !== plan.revision) throw stale();
  const { revision: _r, ...body } = plan;
  recheck(project, home, plan, plan.config.before, plan.lockBefore, body);
  serializeConfig(JSON.parse(plan.config.text) as ProjectConfig);
  if (plan.lock) serializeLock(JSON.parse(plan.lock.text) as ProjectLock);
  removeScratch(project.dir, plan.scratch);
  const config = writeGuardedFile(project.dir, 'bowerloom.json', plan.config.text, plan.config.before?.sha256 ?? null, held, '.bowerloom.json');
  let context = project;
  if (plan.created) context = adoptCreatedMarker(project, 'config', { device: config.device, inode: config.inode });
  hooks.afterConfig?.();
  let lockWrite: { sha256: string; bytes: number } | null = null;
  if (plan.lock) lockWrite = writeGuardedFile(project.dir, LOCK_FILE, plan.lock.text, plan.lock.before?.sha256 ?? null, held, `.${LOCK_FILE}`);
  return { result: { format: CONFIG_CHANGE_RESULT_FORMAT, planRevision: plan.revision, change: plan.change, created: plan.created, configSha256: config.sha256, configBytes: config.bytes, lockSha256: lockWrite?.sha256 ?? null, lockBytes: lockWrite?.bytes ?? null, executionAuthorized: false }, project: context };
}

export type LockChange = 'added' | 'pin' | 'commit' | 'teams' | 'removed' | 'unchanged';
export interface LockUpdatePlan {
  format: typeof LOCK_UPDATE_FORMAT;
  project: ConfigChangePlan['project'];
  config: Read;
  /** True when there is nothing to lock: no store entry and no lock file. */
  nothing: boolean;
  lock: { before: Read | null; after: Read; text: string; rebuilt: boolean };
  updated: { kind: Kind; id: string; change: LockChange; from: string | null; to: string | null }[];
  scratch: string[];
  store: StoreBindingRead | null;
  authored: { kind: Kind; id: string; hash: string }[];
  network: { hosts: string[]; credentials: Credentials | null };
  notes: string[];
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface LockUpdateResult { format: typeof LOCK_UPDATE_RESULT_FORMAT; planRevision: string; updated: { kind: Kind; id: string; change: LockChange }[]; sha256: string; bytes: number; executionAuthorized: false }
export interface LockUpdateInput { project: ProjectContext; home: string; items: { kind: Kind; id: string }[] | null; commit: string | null; signal?: AbortSignal; storeTransport?: StoreTransportFactory; tokenSet?: boolean; githubToken?: TokenSource }

/** Plans `lock update` (3.15). Reads the store and, for a changed authored item or with --commit, its pushed copy. */
export async function planLockUpdate(input: LockUpdateInput): Promise<LockUpdatePlan> {
  const { project } = input;
  verifyProjectPins(project);
  const read = readConfig(project);
  if (read.state === 'absent') throw configRefusal('CONFIG_ITEM_NOT_SELECTED');
  if (read.state === 'invalid') throw configRefusal(read.code);
  const config = read.config, wanted = storeEntries(config);
  let current: { lock: ProjectLock | null; read: Read | null }, rebuilt = false;
  try { current = lockFor(project); }
  catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== 'LOCK_INVALID' || input.items !== null) throw error;
    // A lock that does not parse (a merge conflict) is rebuilt from the config.
    let raw: Read | null = null; try { const b = fs.readFileSync(join(project.dir, LOCK_FILE)); raw = { sha256: sha(b), bytes: b.length }; } catch { raw = null; }
    current = { lock: null, read: raw }; rebuilt = true;
  }
  const empty = !wanted.length && current.read === null;
  const items = pairsOf(current.lock), updated: LockUpdatePlan['updated'] = [], notes: string[] = [];
  // Review F2: a rebuilt lock says so; nothing of the old file is kept.
  if (rebuilt) notes.push('bowerloom.lock.json could not be read (LOCK_INVALID); it is rebuilt from your store. The old pins are dropped.');
  for (const pair of [...items.keys()]) if (!wanted.includes(pair)) { const [k, i] = pair.split(' ') as [Kind, string]; updated.push({ kind: k, id: i, change: 'removed', from: lockSourceLabel(items.get(pair)!), to: null }); items.delete(pair); }
  let defs: StoreDefinitions | null = null, authored: LockUpdatePlan['authored'] = [], hosts: string[] = [];
  const proof: { credentials: Credentials | null } = { credentials: null };
  if (wanted.length) {
    defs = openStoreDefinitions(input.home);
    const selected = input.items === null ? wanted : input.items.map(x => `${x.kind} ${x.id}`);
    for (const p of selected) if (!wanted.includes(p)) throw configRefusal('CONFIG_ITEM_NOT_SELECTED');
    const prove: LockNeed[] = [];
    for (const pair of [...selected].sort(byteOrder)) {
      const [k, i] = pair.split(' ') as [Kind, string], old = items.get(pair) ?? null, need = lockNeed(defs, k, i);
      if (need.pin !== null) {
        const item: LockItem = { id: i, from: 'store', pin: need.pin };
        const same = old !== null && 'pin' in old && canonicalJson(old.pin) === canonicalJson(need.pin);
        const untagged = (e: PinnedEntry) => { const { teams: _t, ...rest } = e; return rest; };
        const teamsOnly = old !== null && 'pin' in old && !same && canonicalJson(untagged(old.pin)) === canonicalJson(untagged(need.pin));
        updated.push({ kind: k, id: i, change: old === null ? 'added' : same ? 'unchanged' : teamsOnly ? 'teams' : 'pin', from: old ? lockSourceLabel(old) : null, to: lockSourceLabel(item) });
        items.set(pair, item); continue;
      }
      if (old !== null && 'authored' in old && old.authored.hash === need.local!.hash && input.commit === null) {
        const teams = need.local!.teams, oldTeams = old.authored.teams ?? [];
        if (canonicalJson(teams) === canonicalJson(oldTeams)) { updated.push({ kind: k, id: i, change: 'unchanged', from: lockSourceLabel(old), to: lockSourceLabel(old) }); continue; }
        const item: LockItem = { id: i, from: 'store', authored: { ...old.authored, ...(teams.length && k !== 'team' ? { teams } : {}) } };
        if (!teams.length) delete (item as { authored: AuthoredPin }).authored.teams;
        updated.push({ kind: k, id: i, change: 'teams', from: oldTeams.join(', ') || 'every team', to: teams.join(', ') || 'every team' }); items.set(pair, item); continue;
      }
      prove.push(need);
    }
    if (prove.length) {
      // Spec 07, 3.2: the token is read only for a proof, before any network read.
      const token = onceTokenSource(input.githubToken)();
      const r = requestCount(prove); requireRequestBudget(r); notes.push(NETWORK_LINE(prove.length, r)); if (r > 60 && !input.tokenSet && token === null) notes.push(NO_TOKEN_LINE);
      hosts = ['api.github.com']; authored = prove.map(n => ({ kind: n.kind, id: n.id, hash: n.local!.hash }));
      for (const [pair, item] of await (async () => { const out = new Map<string, LockItem>(); const got = await proveNeeds(defs!, prove, input, notes, token, proof); for (const [p, it] of got) out.set(p, it); return out; })()) {
        const [k, i] = pair.split(' ') as [Kind, string], old = items.get(pair) ?? null;
        const change: LockChange = old === null ? 'added' : 'authored' in old && 'authored' in item && old.authored.commit !== item.authored.commit ? 'commit' : 'authored' in old && 'authored' in item && old.authored.hash === item.authored.hash && canonicalJson(old.authored.teams ?? []) !== canonicalJson(item.authored.teams ?? []) ? 'teams' : canonicalJson(old) === canonicalJson(item) ? 'unchanged' : 'commit';
        updated.push({ kind: k, id: i, change, from: old ? lockSourceLabel(old) : null, to: lockSourceLabel(item) }); items.set(pair, item);
      }
    }
  }
  updated.sort((a, b) => byteOrder(`${a.kind} ${a.id}`, `${b.kind} ${b.id}`));
  const text = serializeLock(lockFrom(items));
  const body: Omit<LockUpdatePlan, 'revision'> = {
    format: LOCK_UPDATE_FORMAT, project: { dir: project.dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity },
    config: { sha256: read.sha256, bytes: read.bytes }, nothing: empty, lock: { before: current.read, after: { sha256: sha(text), bytes: Buffer.byteLength(text) }, text, rebuilt },
    updated, scratch: scratchFiles(project.dir), store: defs ? storeRead(defs) : null, authored, network: { hosts, credentials: proof.credentials }, notes, writesAuthorized: false, executionAuthorized: false,
  };
  return { ...body, revision: sha(canonicalJson(body)) };
}
const proveNeeds = (defs: StoreDefinitions, needs: LockNeed[], input: LockUpdateInput, notes: string[], token: GithubToken | null, proof: { credentials: Credentials | null }) => prove(defs, needs, input.commit, input, notes, token, proof);
/** True when the plan changes nothing: the lock's bytes stay and no item changes. */
export const lockUpdateIsNoop = (plan: LockUpdatePlan): boolean => plan.nothing || (plan.lock.before?.sha256 === plan.lock.after.sha256 && plan.updated.every(u => u.change === 'unchanged'));

/** Applies an approved lock update under the held project lock: scratch, then the lock (3.14 steps 1 and 5). Reads no network. */
export function applyLockUpdate(plan: LockUpdatePlan, revision: string, held: HeldProjectLock, project: ProjectContext, home: string): LockUpdateResult {
  if (!isHeldProjectLock(held)) throw manifestRefusal('PROJECT_LOCKED');
  held.assertHeld(project.dir);
  if (typeof revision !== 'string' || revision !== plan.revision) throw stale();
  const { revision: _r, ...body } = plan;
  if (plan.lock.rebuilt) { recheck(project, home, plan, plan.config, undefined, body); let raw: Read | null = null; try { const b = fs.readFileSync(join(project.dir, LOCK_FILE)); raw = { sha256: sha(b), bytes: b.length }; } catch { raw = null; } if (canonicalJson(raw) !== canonicalJson(plan.lock.before)) throw stale(); }
  else recheck(project, home, plan, plan.config, plan.lock.before, body);
  serializeLock(JSON.parse(plan.lock.text) as ProjectLock);
  removeScratch(project.dir, plan.scratch);
  const wrote = writeGuardedFile(project.dir, LOCK_FILE, plan.lock.text, plan.lock.before?.sha256 ?? null, held, `.${LOCK_FILE}`);
  return { format: LOCK_UPDATE_RESULT_FORMAT, planRevision: plan.revision, updated: plan.updated.map(u => ({ kind: u.kind, id: u.id, change: u.change })), sha256: wrote.sha256, bytes: wrote.bytes, executionAuthorized: false };
}
export { lockItem };
export type { Entry };
