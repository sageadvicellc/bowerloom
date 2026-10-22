/**
 * `bowerloom apply [--harness claude|codex|both]` (build plan 01, M6). It puts the project's skills and prompts in
 * place for the chosen harnesses from what this machine already holds: pinned skills from the private cache, local
 * skills and prompts from `.bowerloom/`. It never fetches; a pin that is not cached refuses SKILLS_OFFLINE and names
 * `skills sync`. It adds copies for the chosen harnesses and never removes one. It never edits AGENTS.md or
 * CLAUDE.md: the plan carries a pointer a person can add there instead (owner, answer 5).
 *
 * The plan binds the `skills sync` plan of the same skills (computed offline, for the chosen harnesses) and every
 * prompt's inventory, surfaces, before-pins and previous receipt. Apply reuses the M5 locked run: under one held
 * project lock it plans again, refuses STALE_APPROVAL unless the revision is equal, builds every child plan
 * (phase B, no project write), then applies each child with a revision planned right before it in the same run.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { freezeSkillData, revisionOf } from '../../skill-sources/src/validation.js';
import { exists, names } from '../../managed-skills/src/observed.js';
import { MANAGED_ROOT, MARKER_V2, catalogItem, ignoreState } from '../../managed-skills/src/v2-observed.js';
import { legacyPresent } from '../../managed-skills/src/migrate.js';
import { temporary } from '../../managed-skills/src/observed.js';
import type { Harness, ManagedItemRequest } from '../../managed-skills/src/v2-types.js';
import type { Identity } from '../../managed-skills/src/observed-types.js';
import { readManifestState } from '../../skill-manifest/src/add.js';
import { MANIFEST_LIMITS, isId, parseManifest } from '../../skill-manifest/src/schema.js';
import type { Entry } from '../../skill-manifest/src/schema.js';
import { manifestRefusal } from '../../skill-manifest/src/refusal.js';
import { withProjectLock } from '../../project-context/src/index.js';
import type { DirectoryIdentity, PinnedDirectory, ProjectContext } from '../../project-context/src/types.js';
import { DefinitionError } from '../../contracts/src/index.js';
import { applyChildren, createPrivateFolders, interrupted } from './apply.js';
import type { Child } from './apply.js';
import { managedPort } from './deps.js';
import type { Acquirer, ManagedPort } from './deps.js';
import { bindPrivateState, checkProjectAncestry, ignoreCarrier, isActionable, observeSync, offlineHold, pendingRefusal, requireReadableLock, stateLayout, storeBinding, storeCacheStatus } from './plan.js';
import type { StoreFetch, StorePlanBinding, SyncItem, SyncPlan } from './plan.js';
import { checkPromptChild, classifyPrompt, heldPrompt, orphanPrompt, promptRequest, registeredPrompts } from './prompts.js';
import { promptNotices } from './notices.js';
import { resolveProject } from './resolve.js';
import type { Resolved } from './resolve.js';
import { authoredFolder, bowerloomBeforePhaseB, fetchSkillSources, fetchStoreOnly, originOf, planSkillChildren, reviewHold, storeText } from './apply.js';
import { productionAcquirer } from './deps.js';
import type { SyncDeps } from './deps.js';
import { credentialsFor, fetchRequests, missingRequests, onceTokenSource, requestLimit, requireRequestBudget } from './store-git.js';
import type { Credentials, StoreTransportFactory, TokenSource } from './store-git.js';
import type { GithubToken } from '../../skill-manifest/src/github-token.js';
import { verifyProjectPins } from '../../project-context/src/index.js';
import { readConfig } from '../../project-config/src/config.js';
import { homedir } from 'node:os';
import type { PromptItem } from './prompts.js';
import { ALLOW_FLAG, agentRequest, checkAgentChild, checkClaudeFolders, classifyAgent, orphanAgent, scanAgents } from './agents.js';
import type { AgentItem } from './agents.js';
import { agentsMayBeTracked, checkSliceChild, listSlices, scanSlices, sliceRequest } from './slices.js';
import type { SliceItem, SliceTreeHook } from './slices.js';
import { readSliceTree } from '../../managed-skills/src/local-source.js';
import { managedCode, outward, syncError } from './refusal.js';

export const APPLY_PLAN_FORMAT = 'bowerloom/project-apply-plan/v1beta2' as const;
export const APPLY_RESULT_FORMAT = 'bowerloom/project-apply-result/v1beta2' as const;
/**
 * What apply prints in place of an edit to AGENTS.md or CLAUDE.md, for the harnesses it adds copies for (review
 * freeze finding 9). Fixed text: it names no path of this machine.
 */
export function applyPointer(harnesses: readonly Harness[]): string {
  const claude = harnesses.includes('claude'), codex = harnesses.includes('codex');
  if (claude && !codex) return [
    'Bowerloom never edits AGENTS.md or CLAUDE.md. To point Claude Code at these copies, add a line like this to CLAUDE.md yourself:',
    '  Project skills are in .claude/skills. Prompts are Claude Code commands in .claude/commands. Agents are in .claude/agents. Context slices are skills named slice-<name> in .claude/skills.',
  ].join('\n');
  if (codex && !claude) return [
    'Bowerloom never edits AGENTS.md or CLAUDE.md. To point Codex at these copies, add a line like this to AGENTS.md yourself:',
    '  Project skills are in .agents/skills. Prompts are Codex skills named prompt-<name>.',
  ].join('\n');
  return [
    'Bowerloom never edits AGENTS.md or CLAUDE.md. To point your agents at these copies, add a line like this to AGENTS.md and CLAUDE.md yourself:',
    '  Project skills are in .claude/skills and .agents/skills. Prompts are Claude Code commands in .claude/commands, and Codex skills named prompt-<name>. Agents are in .claude/agents. Context slices are skills named slice-<name> in .claude/skills.',
  ].join('\n');
}
/** The pointer for both harnesses, the default. */
export const APPLY_POINTER = applyPointer(['claude', 'codex']);

export interface ApplyInput {
  project: ProjectContext; stateRoot: string;
  /** The home folder: the store is `<home>/.bowerloom` (spec 06). */
  home?: string;
  /** `--frozen`: only what bowerloom.lock.json records; fetches what this machine lacks (spec 06, 3.16). */
  frozen?: boolean;
  /** Sorted, unique, not empty: the harnesses to add copies for. */
  harnesses: Harness[];
  /** Only this team's skills and prompts (`up --team`). Null or absent: every skill and prompt. */
  team?: string | null;
  /** `<role>:<64 hex>` allowances from `--allow-agent`. An agent that sets bypassPermissions, hooks or mcpServers installs only with its own. */
  allow?: readonly string[];
  /** Plan the agents alone, for `status`: no skills, no prompts, and none of the write-side checks. */
  agentsOnly?: boolean;
  /** `--max-github-requests`: the GitHub requests this run may make, 1 to 5000. Default 1000 (second review L2). */
  maxGithubRequests?: number;
  /** A test hook: stands in for the reader of a slice's tree, to change a file during the read. Product code never passes it. */
  sliceTree?: SliceTreeHook;
  /** Spec 07: the token of a private store remote, or the CLI's reader. Read only by a frozen run that needs a repository. */
  githubToken?: TokenSource;
}
export interface ApplyPlan {
  format: typeof APPLY_PLAN_FORMAT;
  project: { dir: string; identity: DirectoryIdentity; ancestry: readonly PinnedDirectory[]; bowerloomIdentity: DirectoryIdentity | null };
  /** Spec 06, 4.4. */
  bowerloomFolder: 'present' | 'create'; frozen: boolean;
  config: { sha256: string; bytes: number } | null; lock: { sha256: string; bytes: number } | null;
  store: StorePlanBinding | null;
  /** The hosts this run may contact: those of the skills sub-plan, and api.github.com for a locked authored prompt or team it fetches. */
  /** `requests` is shown, not bound: phase A counts again. `maxRequests` is bound (second review L2). */
  /** `credentials` (spec 07, 4.3): the union of the skills sub-plan's and the locked prompts' and teams' repositories. Bound. */
  network: { hosts: string[]; requests: number; maxRequests: number; credentials: Credentials | null };
  /** Locked authored teams a frozen apply puts in the store cache, so that team adopt can read them. */
  storeFetch: StoreFetch[];
  notes: string[];
  harnesses: Harness[]; team: string | null;
  /** The offline `skills sync` plan of the same skills for these harnesses; null when there is no skills.json. */
  skills: SyncPlan | null;
  prompts: PromptItem[];
  /** The team agents of this project, planned for Claude Code only (spec 01a). Empty under `--harness codex`. */
  agents: AgentItem[];
  /** The allowances this plan was made with, sorted. They are part of the revision. */
  allow: string[];
  /** The context slices of this project, planned for Claude Code only (spec 05). Empty under `--harness codex`. */
  slices: SliceItem[];
  /** True when the harnesses include Codex and at least one slice is registered: Codex slices are not projected in this beta. */
  codexSlicesSkipped: boolean;
  /** File names in `.bowerloom/slices` that no receipt lists: apply skips them. */
  unregisteredSlices: string[];
  /** True when a guarded agent copy is planned and `.claude/agents` may not be git-ignored (spec 05, section 3.8). */
  agentsMayBeTracked: boolean;
  /** True when the harnesses include Codex and at least one agent file exists: Codex agents are not projected in this beta. */
  codexAgentsSkipped: boolean;
  privateState: { root: string; projectId: string; cacheRoot: string; storeCacheRoot: string; itemsRoot: string; create: string[]; pins: { path: string; identity: Identity }[] };
  managed: { ignore: 'absent' | 'exact' };
  /** True when at least one skill, prompt or agent is installed or updated, or a locked team is fetched. */
  actionable: boolean;
  pointer: string;
  writesAuthorized: false; executionAuthorized: false; revision: string;
}
export interface ApplyItemRef { kind: 'skill' | 'prompt' | 'agent' | 'slice'; id: string; origin: 'store' | 'project' | null; resolvedFrom: 'store' | 'lock' | 'project' }
export interface ApplyResult {
  format: typeof APPLY_RESULT_FORMAT; planRevision: string; harnesses: Harness[];
  applied: (ApplyItemRef & { action: 'install' | 'update'; receiptRevision: string })[];
  held: (ApplyItemRef & { code: string; next: string })[];
  upToDate: ApplyItemRef[]; orphaned: ApplyItemRef[];
  pointer: string; executionAuthorized: false;
}

const usage = (): never => { throw new DefinitionError('USAGE', 'Use bowerloom apply [--harness claude|codex|both], with optional --approve <revision> and --json.'); };
const stale = (extra?: string) => syncError('STALE_APPROVAL', extra);
const HEX64 = /^[a-f0-9]{64}$/;
const promptActionable = (p: PromptItem): boolean => p.action === 'install' || p.action === 'update';
const agentActionable = (a: AgentItem): boolean => a.action === 'install' || a.action === 'update';
const sliceActionable = (s: SliceItem): boolean => s.action === 'install' || s.action === 'update';

/** Ids that start with slice- and name a skill of this project: a folder in .bowerloom/skills, or an entry of skills.json. */
function plainSkillIds(dir: string): Set<string> {
  const out = new Set<string>();
  try { for (const n of readdirSync(join(dir, '.bowerloom', 'skills'))) if (n.startsWith('slice-')) out.add(n); } catch { /* No local skills folder. */ }
  try { const state = readManifestState(dir); if (state.file !== null) for (const e of parseManifest(state.file.bytes, MANIFEST_LIMITS).skills) if (e.id.startsWith('slice-')) out.add(e.id); } catch { /* A manifest that cannot be read names none. */ }
  return out;
}

function harnessSet(value: unknown): Harness[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2 || !value.every((h, i) => (h === 'claude' || h === 'codex') && (i === 0 || value[i - 1] < h))) return usage();
  return [...value] as Harness[];
}

/** No item may take a place another item takes, and no new copy may land on something Bowerloom did not install. */
function checkNames(skills: SyncItem[], prompts: PromptItem[], agents: AgentItem[], slices: SliceItem[] = []): void {
  for (const item of skills) if (item.hold?.code === 'MANAGED_SKILL_PATH_OCCUPIED') {
    throw syncError('APPLY_NAME_COLLISION', `Skill ${item.id}: ${item.hold.next.replace('bowerloom skills sync', 'bowerloom apply')}`);
  }
  const owner = new Map<string, string>();
  const rows = [...skills.filter(i => i.state !== 'orphaned').map(i => ({ name: `skill ${i.id}`, surfaces: i.expected.surfaces })), ...prompts.filter(p => p.state !== 'orphaned').map(p => ({ name: `prompt ${p.id}`, surfaces: p.expected.surfaces })), ...slices.filter(s => s.state !== 'orphaned').map(s => ({ name: `slice ${s.id}`, surfaces: s.expected.surfaces })), ...agents.filter(a => a.state !== 'orphaned').map(a => ({ name: `agent ${a.id}`, surfaces: a.expected.surfaces }))];
  for (const row of rows) for (const s of row.surfaces) {
    const key = s.path.normalize('NFC').toLowerCase(), was = owner.get(key);
    if (was !== undefined && was !== row.name) throw syncError('APPLY_NAME_COLLISION', `Both ${was} and ${row.name} would go to ${s.path}. Give one of them another name, then run bowerloom apply.`);
    owner.set(key, row.name);
  }
}

interface Observed { plan: ApplyPlan; entries: ReadonlyMap<string, Entry>; skillsPlan: SyncPlan | null; token: GithubToken | null }
const FROZEN_LINE = 'Frozen: installing only what bowerloom.lock.json records.';
/** The project teams `bowerloom.json` selects, for the agent projection (spec 06, 3.16 step 7). Null in legacy mode. */
function selectedTeams(project: ProjectContext, resolved: Resolved | null): Set<string> | null {
  if (resolved !== null) return resolved.mode === 'legacy' ? null : new Set(resolved.teams.filter(t => t.origin === 'project' && t.hold === null).map(t => t.id));
  const read = readConfig(project);
  return read.state === 'valid' ? new Set(read.config.teams.filter(t => t.source === 'project').map(t => t.id)) : read.state === 'absent' ? null : new Set();
}
/** Plans the apply. Reads only, and never the network. Every refusal here comes before any write anywhere. */
export async function observeApply(input: ApplyInput): Promise<Observed> {
  try {
    const harnesses = harnessSet(input?.harnesses), team = input.team ?? null, project = input.project, dir = project.dir, frozen = input.frozen === true, maxRequests = requestLimit(input.maxGithubRequests);
    if (team !== null && !isId(team)) throw manifestRefusal('TEAM_NOT_FOUND');
    checkProjectAncestry(project);
    const agentsOnly = input.agentsOnly === true, home = input.home ?? homedir();
    // Spec 07: one read of the token for the whole plan, and none for a plain apply, which never fetches.
    const tokenSource = frozen ? onceTokenSource(input.githubToken) : () => null;
    if (!agentsOnly && legacyPresent(dir)) throw syncError('MANAGED_SKILL_LEGACY_PRESENT');
    if (!agentsOnly && (exists(join(dir, MARKER_V2)) || exists(temporary(join(dir, MARKER_V2))))) throw pendingRefusal(dir);
    if (!agentsOnly && exists(join(dir, '.bowerloom-revision.json'))) throw syncError('REVISION_PENDING');
    let ignore: 'absent' | 'exact' = 'exact';
    if (!agentsOnly) try { ignore = ignoreState(dir); } catch (e) { throw syncError(managedCode(e), 'The file .bowerloom/managed/.gitignore must hold exactly one line, a single *.'); }
    const layout = stateLayout(input);
    const resolved = agentsOnly ? null : resolveProject({ project, home, frozen });
    if (resolved !== null) requireReadableLock(resolved);
    // Skills: the sync planner, for the chosen harnesses. Offline unless frozen: a plain apply never fetches.
    let skills: SyncPlan | null = null, entries: ReadonlyMap<string, Entry> = new Map();
    if (resolved !== null && resolved.manifest !== null && (resolved.mode === 'legacy' || resolved.skills.length > 0)) {
      const observed = await observeSync({ project, stateRoot: input.stateRoot, home, frozen, team, offline: !frozen, apply: { harnesses }, maxGithubRequests: maxRequests, githubToken: tokenSource }, resolved);
      skills = observed.plan; entries = observed.entries;
    }
    // Prompts: legacy, every registered prompt of the team; config, every listed prompt of the team, from where it resolves.
    const inTeam = (teams: readonly string[]) => team === null || teams.length === 0 || teams.includes(team);
    const prompts: PromptItem[] = [], cacheNotes: string[] = [];
    let listedPrompts: string[] = [];
    if (resolved !== null && resolved.mode === 'legacy') {
      const registered = registeredPrompts(dir); listedPrompts = registered.map(p => p.id);
      prompts.push(...registered.filter(p => inTeam(p.teams)).map(p => classifyPrompt(dir, layout.itemsRoot, p.id, p.teams, harnesses)));
    } else if (resolved !== null) {
      listedPrompts = resolved.prompts.map(p => p.id);
      for (const r of resolved.prompts) {
        if (!inTeam(r.teams)) continue;
        if (r.hold !== null) { prompts.push(heldPrompt(dir, r.id, r.teams, harnesses, r.hold, r)); continue; }
        const item = classifyPrompt(dir, layout.itemsRoot, r.id, r.teams, harnesses, { origin: r.origin, via: r.via, resolvedFrom: r.resolvedFrom, storeDir: resolved.store.context?.dir ?? null, lockPin: r.lockPin, storeCacheRoot: layout.storeCacheRoot, notes: cacheNotes, offline: !frozen });
        // A plain apply never fetches: a prompt from the lock that this machine does not hold is held, and the others install.
        if (!frozen && item.storeCache === 'missing' && (item.action === 'install' || item.action === 'update')) { item.action = 'hold'; item.hold = offlineHold('prompt', item.id); }
        prompts.push(item);
      }
    }
    const catalogs = join(dir, MANAGED_ROOT, 'catalog');
    if (!agentsOnly && exists(catalogs)) for (const n of names(catalogs)) {
      const ref = catalogItem(n);
      if (ref.kind === 'prompt' && !listedPrompts.includes(ref.id)) prompts.push(orphanPrompt(dir, layout.itemsRoot, ref.id));
    }
    // Agents: every team folder is listed and checked whatever the harness and team say (spec 01a, section 3.6). In config
    // mode only the project teams bowerloom.json selects project agents; a store team projects none in beta.3.
    const allow = [...new Set(input.allow ?? [])].sort();
    if (allow.some(a => typeof a !== 'string' || !ALLOW_FLAG.test(a))) throw new DefinitionError('USAGE', 'Use --allow-agent <role>:<the 64 hex characters of the agent file\'s sha256>.');
    const selected = selectedTeams(project, resolved);
    const scan = scanAgents(dir), claude = harnesses.includes('claude'), agents: AgentItem[] = [];
    const scanned = scan.entries.filter(e => selected === null || (e.team !== null && selected.has(e.team)));
    // Slices (spec 05): the listing and the limit are checked whatever the harness says; the trees are read for Claude Code only.
    const catalogNames = exists(catalogs) ? names(catalogs) : [];
    const listing = listSlices(dir);
    const sliceScan = claude ? scanSlices(dir, layout.itemsRoot, input.sliceTree ?? readSliceTree, catalogNames) : { items: [] as SliceItem[], unregistered: listing.unregistered };
    const registeredSliceCount = listing.ids.length;
    const plain = plainSkillIds(dir);
    if (claude) {
      const planned = scanned.filter(e => team === null || e.team === team);
      if (planned.some(e => e.hold === null)) checkClaudeFolders(dir);
      agents.push(...planned.map(e => classifyAgent(dir, layout.itemsRoot, e, allow, sliceScan.items, plain)));
      if (exists(catalogs)) for (const n of names(catalogs)) {
        const ref = catalogItem(n);
        if (ref.kind === 'agent' && !scanned.some(e => e.entry === ref.id + '.md')) agents.push(orphanAgent(dir, layout.itemsRoot, ref.id));
      }
      agents.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)) || Buffer.compare(Buffer.from(a.team ?? ''), Buffer.from(b.team ?? '')));
    }
    // Roles that name a slice. A team filter plans only the slices that team's agents name; the others are neither planned nor kept.
    for (const s of sliceScan.items) s.agents = agents.filter(a => a.context.slices.includes(s.id)).map(a => a.id).sort();
    const named = new Set(agents.flatMap(a => a.context.slices));
    const slices = sliceScan.items.filter(s => team === null || s.state === 'orphaned' || named.has(s.id));
    checkNames(skills?.items ?? [], prompts, agents, slices);
    const skillWork = (skills?.items ?? []).filter(isActionable);
    // An apply that changes nothing else still puts back a missing shared ignore file, through one installed prompt, or
    // else one installed agent.
    if (ignore === 'absent' && !skillWork.length && !prompts.some(promptActionable) && !slices.some(sliceActionable) && !agents.some(agentActionable)) {
      const first = ignoreCarrier(prompts.map(p => ({ ...p, kind: 'prompt' })));
      if (first) prompts.find(p => p.id === first.id)!.action = 'update';
      else {
        const slice = ignoreCarrier(slices.map(s => ({ ...s, kind: 'slice' })));
        if (slice) slices.find(s => s.id === slice.id)!.action = 'update';
        else { const agent = ignoreCarrier(agents.map(a => ({ ...a, kind: 'agent' }))); if (agent) agents.find(a => a.itemId === agent.itemId)!.action = 'update'; }
      }
    }
    // A frozen run fetches each locked team the store cache lacks into the store cache, so that team adopt can read it.
    const storeFetch: StoreFetch[] = frozen && resolved !== null ? resolved.teams.filter(t => t.resolvedFrom === 'lock' && t.lockPin !== null).map(t => ({ kind: 'team' as const, id: t.id, lockPin: t.lockPin!, storeCache: storeCacheStatus(layout, 'team', t.id, t.lockPin!.hash, cacheNotes) })) : [];
    const promptWork = prompts.filter(promptActionable), sliceWork = slices.filter(sliceActionable), agentWork = agents.filter(agentActionable), create: string[] = [];
    const lockPrompts = promptWork.filter(p => p.resolvedFrom === 'lock');
    const authoredFetch = (skills?.items ?? []).some(i => isActionable(i) && i.storeCache === 'missing') || lockPrompts.some(p => p.storeCache === 'missing') || storeFetch.some(f => f.storeCache === 'missing');
    const needsFetch = (skills?.network.required ?? false) || authoredFetch;
    if (skillWork.length || promptWork.length || sliceWork.length || agentWork.length || storeFetch.length) {
      create.push(...layout.missing.filter(p => p === layout.cacheRoot ? needsFetch : p === layout.storeCacheRoot ? authoredFetch : true));
      for (const id of [...skillWork.map(i => i.id), ...promptWork.map(p => p.itemId), ...sliceWork.map(s => s.itemId), ...agentWork.map(a => a.itemId)]) { const p = join(layout.itemsRoot, id); if (!exists(p)) create.push(p); }
    }
    const hosts = [...new Set([...(skills?.network.hosts ?? []), ...(frozen && (lockPrompts.length || storeFetch.length) ? ['api.github.com'] : [])])].sort();
    // Review L2: the GitHub requests this run makes at most; a frozen run only fetches.
    const requests = (skills?.network.requests ?? 0) + (frozen ? [...lockPrompts.flatMap(p => p.lockPin && p.storeCache === 'missing' ? [p.lockPin] : []), ...storeFetch.filter(f => f.storeCache === 'missing').map(f => f.lockPin)].reduce((n, p) => n + fetchRequests(p), 0) : 0);
    const fromStore = (skills?.store ?? null) !== null || prompts.some(p => p.origin === 'store' && p.resolvedFrom === 'store');
    // Spec 07, 4.3: the repositories of the skills sub-plan, and of each locked prompt and team this frozen run installs or fetches.
    const remotes = frozen ? [...(skills?.items ?? []).filter(i => isActionable(i) && i.lockPin !== null).map(i => i.lockPin!.remote), ...lockPrompts.flatMap(p => p.lockPin ? [p.lockPin.remote] : []), ...storeFetch.map(f => f.lockPin.remote)] : [];
    const token = remotes.length ? tokenSource() : null, credentials = token !== null ? credentialsFor(remotes) : null;
    const body = {
      format: APPLY_PLAN_FORMAT,
      project: { dir, identity: project.identity, ancestry: project.ancestry, bowerloomIdentity: project.bowerloomIdentity },
      bowerloomFolder: project.bowerloomIdentity === null ? 'create' as const : 'present' as const, frozen,
      config: resolved?.config ?? null, lock: resolved && resolved.lock.sha256 !== null ? { sha256: resolved.lock.sha256, bytes: resolved.lock.bytes! } : null,
      store: resolved !== null ? storeBinding(resolved, fromStore) : null, network: { hosts, requests, maxRequests, credentials }, storeFetch,
      // Review F5: the skills planner's own notes (a store cache entry that fails verification) join the resolver's.
      notes: [...new Set([...(resolved?.notes ?? []), ...(skills?.notes ?? []).filter(n => n !== FROZEN_LINE), ...cacheNotes])].concat(frozen ? [FROZEN_LINE] : []),
      harnesses, team, skills, prompts, slices, agents, allow, codexSlicesSkipped: harnesses.includes('codex') && registeredSliceCount > 0, unregisteredSlices: sliceScan.unregistered,
      agentsMayBeTracked: agentWork.some(a => a.context.guard !== null) && agentsMayBeTracked(dir), codexAgentsSkipped: harnesses.includes('codex') && scan.fileCount > 0,
      privateState: { root: layout.root, projectId: project.projectId, cacheRoot: layout.cacheRoot, storeCacheRoot: layout.storeCacheRoot, itemsRoot: layout.itemsRoot, create, pins: layout.pins },
      managed: { ignore }, actionable: skillWork.length + promptWork.length + sliceWork.length + agentWork.length > 0 || storeFetch.some(f => f.storeCache === 'missing'), pointer: applyPointer(harnesses),
      writesAuthorized: false as const, executionAuthorized: false as const,
    };
    // The skills part is bound through its own revision (syncBinding) and the shared folders by path only, so a
    // sync in another project that fills the machine cache, or creates a shared folder, does not stale this plan. Whether
    // the store cache holds a locked prompt or team now is dropped too; its hash stays.
    const binding = { ...body, network: { hosts: body.network.hosts, maxRequests: body.network.maxRequests, credentials: body.network.credentials }, agentsOnly, skills: skills ? skills.revision : null, privateState: bindPrivateState(body.privateState), prompts: body.prompts.map(p => ({ ...p, storeCache: null })), storeFetch: body.storeFetch.map(f => ({ ...f, storeCache: null })), actionable: null };
    return { plan: freezeSkillData({ ...body, revision: revisionOf(binding) }) as ApplyPlan, entries, skillsPlan: skills, token };
  } catch (e) { throw outward(e); }
}

/** `bowerloom apply` plan. Reads only. */
export async function planProjectApply(input: ApplyInput): Promise<ApplyPlan> { return (await observeApply(input)).plan; }

/** Apply never fetches: phase A only reads the cache. This acquirer is never reached, and refuses if it were. */
const NO_FETCH: Acquirer = Object.freeze({
  npm: async () => { throw syncError('SKILLS_OFFLINE', 'bowerloom apply never fetches. Run bowerloom skills sync first.'); },
  git: async () => { throw syncError('SKILLS_OFFLINE', 'bowerloom apply never fetches. Run bowerloom skills sync first.'); },
});

/** What applyProjectApply takes beside the plan input: test ports. `acquirer` and `storeTransport` serve a frozen apply only. */
export interface ApplyDeps { managed?: ManagedPort; acquirer?: Acquirer; storeTransport?: StoreTransportFactory; beforeStoreRead?: SyncDeps['beforeStoreRead'] }
/**
 * Applies an approved apply plan. `revision` must equal the revision this run computes again under the lock.
 * `signal` is the person's interrupt: it is read between children, never inside one. A plain apply uses NO_FETCH; a frozen
 * apply fetches what this machine lacks, from the hosts the plan names.
 */
export async function applyProjectApply(input: ApplyInput, revision: string, signal: AbortSignal, deps: ApplyDeps = {}): Promise<ApplyResult> {
  if (typeof revision !== 'string' || !HEX64.test(revision)) throw stale();
  if (input?.agentsOnly === true) throw usage();
  if (!(signal instanceof AbortSignal)) throw new TypeError('applyProjectApply needs a signal.');
  const managed = deps.managed ?? managedPort, lock = new AbortController();
  const syncDeps: SyncDeps = { acquirer: input.frozen === true ? deps.acquirer ?? productionAcquirer : NO_FETCH, signal, ...(deps.storeTransport ? { storeTransport: deps.storeTransport } : {}), ...(deps.beforeStoreRead ? { beforeStoreRead: deps.beforeStoreRead } : {}) };
  try {
    return await withProjectLock(input.project.dir, lock.signal, async held => {
      const { plan, entries, token } = await observeApply(input);
      if (plan.revision !== revision) throw stale();
      // Spec 07: the token this run read for the plan reaches the store fetches, and nothing else.
      syncDeps.githubToken = token;
      const dir = plan.project.dir, prompts = plan.prompts.filter(promptActionable), slices = plan.slices.filter(sliceActionable), agents = plan.agents.filter(agentActionable), skillWork = (plan.skills?.items ?? []).filter(isActionable);
      if (signal.aborted) throw interrupted([], [...skillWork.map(i => i.id), ...prompts.map(p => p.itemId), ...slices.map(s => s.itemId), ...agents.map(a => a.itemId)], 'bowerloom apply');
      createPrivateFolders(plan, held, dir);
      // Review L2: checked again before any fetch.
      // Second review L2: the items the store cache lacks now, counted again, within the bound limit.
      requireRequestBudget(missingRequests(plan.privateState.storeCacheRoot, [
        ...(plan.skills?.items ?? []).filter(i => isActionable(i) && i.lockPin !== null).map(i => ({ kind: 'skill' as const, id: i.id, lockPin: i.lockPin! })),
        ...(plan.frozen ? prompts.filter(p => p.resolvedFrom === 'lock' && p.lockPin !== null).map(p => ({ kind: 'prompt' as const, id: p.id, lockPin: p.lockPin! })) : []),
        ...plan.storeFetch,
      ]), plan.network.maxRequests);
      // Phase A: the private caches only. Skills; locked prompts; locked teams. A lock-fetched item with a notice the plan
      // did not show is held for review and gets no child.
      const got = plan.skills ? await fetchSkillSources(plan.skills, entries, held, syncDeps, 'bowerloom apply') : null;
      const promptDirs = new Map<string, string>(), review: ApplyResult['held'] = [];
      for (const item of prompts) {
        if (item.origin !== 'store') continue;
        if (item.resolvedFrom === 'store') { if (plan.store === null) throw stale(); promptDirs.set(item.id, plan.store.dir); continue; }
        held.assertHeld(dir);
        const folder = await authoredFolder({ kind: 'prompt', id: item.id, requestDigest: item.lockPin?.hash ?? null, lockPin: item.lockPin }, plan.privateState, plan.network.hosts, syncDeps, plan.network.credentials);
        // Decision A, widened by review H1: held when its notices are not exactly the ones the approved plan showed.
        const notices = promptNotices(storeText(dir, 'prompt', item.id, folder.dir));
        if (notices.length && revisionOf(notices) !== revisionOf(item.notices)) { review.push({ kind: 'prompt', id: item.id, ...reviewHold(), ...originOf(item) }); continue; }
        promptDirs.set(item.id, folder.dir);
      }
      await fetchStoreOnly(plan, held, syncDeps);
      const promptChildren = prompts.filter(p => p.origin !== 'store' || promptDirs.has(p.id));
      // Review C2: the context that names the folder this run made, checked again before phase C writes.
      const context = bowerloomBeforePhaseB(input.project, plan, held, (got?.sources.size ?? 0) + promptChildren.length + slices.length + agents.length > 0);
      // Phase B for the skills, then the prompts, the slices, and the agents. No project write.
      const children: Child[] = plan.skills && got ? await planSkillChildren(plan.skills, got, syncDeps, managed, 'bowerloom apply') : [];
      for (const item of promptChildren) {
        if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...prompts.map(p => p.itemId), ...slices.map(s => s.itemId), ...agents.map(a => a.itemId)], 'bowerloom apply');
        const req: ManagedItemRequest = promptRequest(dir, plan.privateState.itemsRoot, item, promptDirs.get(item.id) ?? null);
        let child; try { child = await managed.plan(req, { signal }); } catch (e) {
          // Review M6 finding 6: an interrupt here is an interrupt, as it is for a skill (apply.ts phase B).
          if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...prompts.map(p => p.itemId), ...slices.map(s => s.itemId), ...agents.map(a => a.itemId)], 'bowerloom apply');
          throw outward(e, 'MANAGED_SKILL_REFUSED', `It belongs to prompt ${item.id}; nothing was changed.`);
        }
        children.push({ item: { id: item.itemId, action: item.action }, req, plan: checkPromptChild(dir, item, req, child) });
      }
      for (const item of slices) {
        if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...slices.map(s => s.itemId), ...agents.map(a => a.itemId)], 'bowerloom apply');
        const req: ManagedItemRequest = sliceRequest(dir, plan.privateState.itemsRoot, item);
        let child; try { child = await managed.plan(req, { signal }); } catch (e) {
          if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...slices.map(s => s.itemId), ...agents.map(a => a.itemId)], 'bowerloom apply');
          throw outward(e, 'MANAGED_SKILL_REFUSED', `It belongs to slice ${item.id}; nothing was changed.`);
        }
        children.push({ item: { id: item.itemId, action: item.action }, req, plan: checkSliceChild(dir, item, req, child) });
      }
      for (const item of agents) {
        if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...agents.map(a => a.itemId)], 'bowerloom apply');
        const req: ManagedItemRequest = agentRequest(dir, plan.privateState.itemsRoot, item);
        let child; try { child = await managed.plan(req, { signal }); } catch (e) {
          if (signal.aborted) throw interrupted([], [...children.map(c => c.item.id), ...agents.map(a => a.itemId)], 'bowerloom apply');
          throw outward(e, 'MANAGED_SKILL_REFUSED', `It belongs to agent ${item.id}; nothing was changed.`);
        }
        children.push({ item: { id: item.itemId, action: item.action }, req, plan: checkAgentChild(dir, item, req, child, plan.allow) });
      }
      verifyProjectPins(context);
      // Phase C: every child, in order, with a revision planned right before it in this run.
      const applied = await applyChildren(children, held, dir, plan.managed.ignore === 'exact', managed, signal, 'bowerloom apply');
      const project = { origin: 'project' as const, resolvedFrom: 'project' as const };
      const refOf = (id: string): ApplyItemRef => {
        const p = plan.prompts.find(x => x.itemId === id); if (p) return { kind: 'prompt', id: p.id, ...originOf(p) };
        // Spec 10, 2: a slice is a project item only.
        const sl = plan.slices.find(x => x.itemId === id && sliceActionable(x)); if (sl) return { kind: 'slice', id: sl.id, ...project };
        const a = plan.agents.find(x => x.itemId === id && agentActionable(x)); if (a) return { kind: 'agent', id: a.id, ...project };
        const s = plan.skills?.items.find(x => x.id === id); return { kind: 'skill', id, ...(s ? originOf(s) : project) };
      };
      const skills = plan.skills?.items ?? [];
      return {
        format: APPLY_RESULT_FORMAT, planRevision: plan.revision, harnesses: plan.harnesses,
        applied: applied.map(a => ({ ...refOf(a.id), action: a.action, receiptRevision: a.receiptRevision })),
        held: [...skills.filter(i => i.action === 'hold').map(i => ({ kind: 'skill' as const, id: i.id, code: i.hold!.code, next: i.hold!.next, ...originOf(i) })), ...(got?.review ?? []).map(id => ({ kind: 'skill' as const, id, ...reviewHold(), ...originOf(skills.find(i => i.id === id)!) })), ...plan.prompts.filter(p => p.action === 'hold').map(p => ({ kind: 'prompt' as const, id: p.id, code: p.hold!.code, next: p.hold!.next, ...originOf(p) })), ...review, ...plan.slices.filter(s => s.action === 'hold').map(s => ({ kind: 'slice' as const, id: s.id, code: s.hold!.code, next: s.hold!.next, ...project })), ...plan.agents.filter(a => a.action === 'hold').map(a => ({ kind: 'agent' as const, id: a.id, code: a.hold!.code, next: a.hold!.next, ...project }))],
        upToDate: [...skills.filter(i => i.state === 'up-to-date' && i.action === 'none').map(i => ({ kind: 'skill' as const, id: i.id, ...originOf(i) })), ...plan.prompts.filter(p => p.state === 'up-to-date' && p.action === 'none').map(p => ({ kind: 'prompt' as const, id: p.id, ...originOf(p) })), ...plan.slices.filter(s => s.state === 'up-to-date' && s.action === 'none').map(s => ({ kind: 'slice' as const, id: s.id, ...project })), ...plan.agents.filter(a => a.state === 'up-to-date' && a.action === 'none').map(a => ({ kind: 'agent' as const, id: a.id, ...project }))],
        orphaned: [...skills.filter(i => i.state === 'orphaned').map(i => ({ kind: 'skill' as const, id: i.id, ...originOf(i) })), ...plan.prompts.filter(p => p.state === 'orphaned').map(p => ({ kind: 'prompt' as const, id: p.id, ...originOf(p) })), ...plan.slices.filter(s => s.state === 'orphaned').map(s => ({ kind: 'slice' as const, id: s.id, origin: null, resolvedFrom: 'project' as const })), ...plan.agents.filter(a => a.state === 'orphaned').map(a => ({ kind: 'agent' as const, id: a.id, origin: null, resolvedFrom: 'project' as const }))],
        pointer: plan.pointer, executionAuthorized: false,
      };
    });
  } catch (e) { throw outward(e); }
}
