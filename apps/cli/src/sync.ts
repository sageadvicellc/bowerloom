/**
 * `bowerloom skills sync [--offline] [--team <id>] [--approve <revision>] [--json]`,
 * `bowerloom skills recover plan|apply --item <id> [--action resume|rollback|abandon] [--approve <revision>] [--json]` and
 * `bowerloom skills migrate plan|apply --state <v1-state-dir> [--approve <revision>] [--json]` (build plan 01, M5).
 *
 * Each runs through the approval wrapper. `plan` forms only show the plan (exit 3). Sync with nothing to change
 * shows its plan and exits 0. Ctrl-C during a sync stops it between two skills, never inside one.
 */
import { isAbsolute, resolve } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { isId } from '../../../packages/skill-manifest/src/schema.js';
import { planSync, applySync, productionAcquirer, managedPort, planItemRecovery, applyItemRecovery, planMigrate, applyMigrate } from '../../../packages/project-sync/src/index.js';
import type { SyncPlan, SyncItem, SyncResult, MigratePlan, SyncDeps, ManagedPort } from '../../../packages/project-sync/src/index.js';
import { requestNote } from '../../../packages/project-sync/src/change.js';
import { GITHUB_REQUEST_LIMIT } from '../../../packages/project-sync/src/store-git.js';
import type { Credentials } from '../../../packages/project-sync/src/store-git.js';
import { TOKEN_STALE_NOTE } from '../../../packages/project-sync/src/store-git.js';
import { GithubToken } from '../../../packages/skill-manifest/src/github-token.js';
import { itemId } from '../../../packages/managed-skills/src/v2-observed.js';
import type { RecoveryAction, RecoveryPlanV2 } from '../../../packages/managed-skills/src/v2-types.js';
import { approvalFault, parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { allowedToolsLine, terminalIo } from './manifest.js';

const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const SYNC_USAGE = 'Use bowerloom skills sync [--offline] [--team <team>] [--frozen] [--max-github-requests <n>], with optional --approve <revision> and --json.';
/** `--max-github-requests <n>`: a whole number; planSync and planProjectApply refuse one outside 1 to 5000 (second review L2). */
export function maxRequestsFlag(value: string | undefined, message: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9]{1,6}$/.test(value)) usage(message);
  return Number(value);
}
const RECOVER_USAGE = 'Use bowerloom skills recover plan|apply --item <id> [--action resume|rollback|abandon], with optional --approve <revision> (apply only) and --json.';
const MIGRATE_USAGE = 'Use bowerloom skills migrate plan|apply --state <earlier-state-folder>, with optional --approve <revision> (apply only) and --json.';
const HARNESS_NAMES: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' };
export const harnessWords = (h: readonly string[]) => h.map(x => HARNESS_NAMES[x] ?? x).join(' and ');

/** Takes the named value flags out of the words; the rest goes to the approval wrapper. */
function takeFlags(words: readonly string[], valued: readonly string[], plain: readonly string[], message: string): { values: Map<string, string>; flags: Set<string>; rest: string[] } {
  const values = new Map<string, string>(), flags = new Set<string>(), rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (valued.includes(word)) { const value = words[++i]; if (value === undefined || value.startsWith('-') || values.has(word)) usage(message); values.set(word, value!); }
    else if (plain.includes(word)) { if (flags.has(word)) usage(message); flags.add(word); }
    else rest.push(word);
  }
  return { values, flags, rest };
}

/**
 * Spec 07, 3.2 and 3.8 property 1: the token is read in the CLI layer only, from the `env` argument, and only when a plan
 * needs a store repository. The planner calls this reader at that point; it reads the variable once per command.
 * A value outside the token shape throws GITHUB_TOKEN_INVALID, before any network call.
 */
export function githubTokenReader(env: NodeJS.ProcessEnv): () => GithubToken | null {
  let read = false, token: GithubToken | null = null;
  return () => { if (!read) { token = GithubToken.fromEnv(env); read = true; } return token; };
}
/**
 * Review F5 of PR 97: the STALE_APPROVAL of a sync plan names the token when the plan fetches an authored lock item,
 * because only then can setting or removing BOWERLOOM_GITHUB_TOKEN have changed it.
 */
export function syncStaleNote(plan: SyncPlan): string | null {
  const needs = !plan.offline && (plan.network?.credentials != null || plan.items.some(i => (i.action === 'install' || i.action === 'update') && i.lockPin !== null) || plan.storeFetch.length > 0);
  return needs ? TOKEN_STALE_NOTE : null;
}
/** Spec 07, 3.5: the tail every token form of the Network: line ends its store part with. */
export const TOKEN_TAIL = 'Store items use your GitHub token for the repositories above.';
/** Spec 07, 3.5: the one Credentials: line of a plan with credentials, or none. */
export function credentialsLines(credentials: Credentials | null | undefined): string[] {
  if (!credentials) return [];
  const names = credentials.repositories.map(r => `github.com/${r}`);
  const joined = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return [`Credentials: BOWERLOOM_GITHUB_TOKEN is set. It is sent to api.github.com for ${joined} only.`];
}
/** The source tag of 3.18: `[store]`, `[project]`, or `[store, from the lock: ...]`. Empty for an orphan. */
export function sourceTag(item: { origin: 'store' | 'project' | null; resolvedFrom: 'store' | 'lock' | 'project'; lockPin: { remote: string } | null; kind?: string | null; pin?: string | null }): string {
  if (item.origin === null || item.origin === undefined) return '';
  if (item.origin === 'project') return '  [project]';
  if (item.resolvedFrom !== 'lock') return '  [store]';
  if (item.lockPin) return `  [store, from the lock: ${item.lockPin.remote.slice('https://'.length)}]`;
  const pin = item.pin ?? '';
  return item.kind === 'npm' ? `  [store, from the lock: npm ${pin.split(':')[0]}]` : `  [store, from the lock: github.com/${pin.split('@')[0]}]`;
}
/** One sync item in plain words, its id padded to `width`. `apply` (M6) reuses it. */
export function itemLine(item: SyncItem, width: number): string[] {
  const base = itemLineBase(item, width), lines = base.length ? [`${base[0]}${sourceTag(item)}`, ...base.slice(1)] : base;
  const tools = item.allowedTools !== undefined && item.action !== 'hold' && item.state !== 'up-to-date' ? [`  ${''.padEnd(width)} ${allowedToolsLine(item.allowedTools).trim()}`] : [];
  return [...lines, ...tools, ...skillNoticeLine(item), ...extraFilesLine(item)];
}
/** Second review INFO: a store skill's files besides SKILL.md are named, so scripts that come with it show. */
function extraFilesLine(item: SyncItem): string[] {
  if (item.origin !== 'store' || (item.action !== 'install' && item.action !== 'update')) return [];
  const extra = item.expected.files.map(f => f.path).filter(p => p !== 'SKILL.md');
  if (!extra.length) return [];
  const shown = extra.slice(0, 20).map(p => plainText(p)).join(', ');
  return [`  skill ${item.id} also holds: ${shown}${extra.length > 20 ? `, and ${extra.length - 20} more` : ''}`];
}
/** Second review L2: the GitHub requests of the run and its limit, when the run makes any or the limit was set. */
export function requestLine(network: { requests?: number; maxRequests?: number; hosts?: readonly string[] } | undefined, maxSet = false): string[] {
  const requests = network?.requests ?? 0, max = network?.maxRequests ?? GITHUB_REQUEST_LIMIT;
  // Round 5 of the reviews of PR 101: the note that the flag has no effect sits beside the request line it is about.
  const note = requestNote(maxSet, network?.hosts ?? [], requests);
  if (requests === 0 && max === GITHUB_REQUEST_LIMIT) return note;
  const over = requests > max ? ` Run it with --max-github-requests ${requests} or more.` : '';
  return [`GitHub requests: at most ${requests}, of the ${max} this run allows.${over}`, ...note];
}
const SKILL_NOTICE_WORDS: Record<string, string> = { 'allowed-tools': 'sets allowed-tools in its frontmatter', hooks: 'registers hooks that keep running for the rest of the session', 'shell-lines': 'runs shell commands marked with !' };
/** Review H1: a store skill that can do more than text is named, as a prompt is; allowed-tools a pin shows is not repeated. */
function skillNoticeLine(item: SyncItem): string[] {
  const notices = (item.notices ?? []).filter(n => !(n === 'allowed-tools' && item.allowedTools !== undefined));
  if (item.origin !== 'store' || !notices.length || (item.action !== 'install' && item.action !== 'update')) return [];
  const what = notices.map(n => SKILL_NOTICE_WORDS[n] ?? n).reduce((all, w, i, list) => i === 0 ? w : `${all}${i === list.length - 1 ? ' and ' : ', '}${w}`, '');
  const where = item.resolvedFrom === 'lock' && item.lockPin ? item.lockPin.remote.slice('https://'.length) : `~/.bowerloom/skills/${item.id}`;
  return [`  Note: skill ${item.id} ${what}. Review ${where}.`];
}
function itemLineBase(item: SyncItem, width: number): string[] {
  const id = item.id.padEnd(width), pin = item.pin ?? '';
  const how = item.cache?.status === 'needs-fetch' ? `, fetched from ${item.kind === 'git' ? 'api.github.com' : 'registry.npmjs.org'}` : item.cache?.status === 'cached' ? ", from this machine's cache" : '';
  if (item.action === 'hold') return [`  ${id} held (${item.hold!.code})`, `  ${''.padEnd(width)} Next: ${item.hold!.next}`];
  switch (item.state) {
    case 'up-to-date': return [`  ${id} up to date${item.action === 'update' ? ' (puts back .bowerloom/managed/.gitignore)' : ''}`];
    case 'orphaned': return [`  ${id} kept: no longer in skills.json, and sync removes nothing`];
    case 'local': return [`  ${id} ${item.action} ${item.origin === 'store' ? (item.resolvedFrom === 'lock' ? `a skill from the store at ${item.lockPin!.remote.slice('https://'.length)}` : `your skill in ~/.bowerloom/skills/${item.id}`) : `your skill in .bowerloom/skills/${item.id}`}`];
    case 'pin-changed': return [`  ${id} update to ${pin}${how}`];
    case 'harnesses-changed': return [item.action === 'update' ? `  ${id} add ${harnessWords(item.harnesses)} copies` : `  ${id} kept for ${harnessWords(item.harnesses)}: removing a harness is not supported yet`];
    default:
      // An authored skill from the lock: its places, and whether it is on this machine yet (3.16).
      if (item.lockPin) return [`  ${id} install skill: ${item.expected.surfaces.filter(s => s.id === 'projection-claude' || s.id === 'projection-codex').map(s => s.path).join(' and ')}${item.storeCache === 'missing' ? ' (not on this machine yet; Bowerloom shows what it can do after the fetch)' : ''}`];
      return [`  ${id} install ${item.kind} ${pin}${how}`];
  }
}
/** The sync plan in plain words. confirm.ts escapes control characters again before printing. */
export function renderSyncReview(plan: SyncPlan, maxSet = false): string {
  const fetch = plan.items.filter(i => (i.action === 'install' || i.action === 'update') && (i.cache?.status === 'needs-fetch' || i.storeCache === 'missing'));
  const stored = (plan.storeFetch ?? []).filter(f => f.storeCache === 'missing'), config = plan.config != null, n = fetch.length + stored.length;
  const width = Math.max(0, ...plan.items.map(x => x.id.length), ...plan.storeFetch.map(f => f.id.length)) + 1;
  return [
    ...(plan.bowerloomFolder === 'create' && plan.items.some(i => i.action === 'install' || i.action === 'update') ? ['Create .bowerloom (records of the copies). Its contents are git-ignored.'] : []),
    `${config ? 'Sync skills' : 'Sync skills from .bowerloom/skills.json'} for ${harnessWords(plan.harnesses)}${plan.team ? `, team ${plan.team}` : ''}${plan.offline ? ', offline' : ''}`,
    ...(plan.items.length ? plan.items.flatMap(i => itemLine(i, width)) : [config ? '  Nothing is selected to sync yet.' : '  skills.json names no skill for this sync.']),
    ...plan.storeFetch.map(f => `  ${f.id.padEnd(width)} fetch ${f.kind} into the store cache [store, from the lock: ${f.lockPin.remote.slice('https://'.length)}]`),
    ...plan.notes,
    ...credentialsLines(plan.network.credentials),
    n && plan.network.credentials ? `Network: reads ${plan.network.hosts.join(' and ')} for ${n} ${n === 1 ? 'item' : 'items'}.${plan.network.hosts.includes('registry.npmjs.org') ? ' Pins are fetched without credentials.' : ''} ${TOKEN_TAIL}`
      : n ? `Network: reads ${plan.network.hosts.join(' and ')} for ${n} ${n === 1 ? 'item' : 'items'}, public and without credentials. Bytes must match their pins or bowerloom.lock.json.`
      : plan.network.hosts.length ? `Network: none now. Every pinned skill is in this machine's cache. Only if one is gone when this applies does sync read ${plan.network.hosts.join(' and ')} for it.` : 'Network: none.',
    ...requestLine(plan.network, maxSet),
    `Skills cache: ${plan.privateState.cacheRoot}, shared by every project on this machine.`,
    `Private state: ${plan.privateState.root}${plan.privateState.create.length ? ' (new folders get mode 0700)' : ''}`,
    'Copies go to .bowerloom/managed, .claude/skills and .agents/skills, and stay on this machine. Commit .bowerloom/skills.json and your own skills.',
    'This copies text files only. It starts no workers and runs nothing.',
  ].join('\n');
}
/** What a finished sync did, in plain words. Every line passes through plainText (review M5 finding 7). */
export function resultWords(result: SyncResult): string {
  return plainText([
    ...result.applied.map(a => `  ${a.id}: ${a.action === 'install' ? 'installed' : 'updated'}`),
    ...result.held.map(h => `  ${h.id}: held (${h.code}). Next: ${h.next}`),
    ...(result.orphaned.length ? [`  kept, not in skills.json: ${result.orphaned.join(', ')}`] : []),
    '',
  ].join('\n'), true);
}

/**
 * Ctrl-C during a write (review M5 finding 8). The first one stops between two items, never inside one. A second one
 * stops at once: it names the item whose change is running, which then needs recovery, and exits 130.
 */
export function interruptHandler(controller: AbortController, current: () => string | null, write: (text: string) => void, exit: (code: number) => void): () => void {
  let count = 0;
  return () => {
    if (++count === 1) { write('Stopping after the item in progress. No item is left half done. Press Ctrl-C again to stop at once.\n'); controller.abort(); return; }
    const id = current();
    write(id !== null
      ? plainText(`Stopped at once, during ${id}. Its change is unfinished: run bowerloom skills recover plan --item ${id}.\n`, true)
      : 'Stopped at once. No item was changing in the project, so nothing there is left unfinished.\n');
    exit(130);
  };
}
/** The production managed port, watched: `current()` names the item whose apply is running, or null. */
export function watchedPort(): { managed: ManagedPort; current: () => string | null } {
  let running: string | null = null;
  return {
    current: () => running,
    managed: {
      plan: (req, options) => managedPort.plan(req, options),
      async apply(held, req, revision, options) {
        running = itemId(req.item);
        try { return await managedPort.apply(held, req, revision, options); } finally { running = null; }
      },
    },
  };
}
/** Installs the Ctrl-C handler for the length of one write. */
export async function withInterrupt<T>(run: (signal: AbortSignal, managed: ManagedPort) => Promise<T>): Promise<T> {
  const controller = new AbortController(), watched = watchedPort();
  const handler = interruptHandler(controller, watched.current, text => { process.stderr.write(text); }, code => process.exit(code));
  process.on('SIGINT', handler);
  try { return await run(controller.signal, watched.managed); } finally { process.removeListener('SIGINT', handler); }
}

const actionable = (plan: SyncPlan) => plan.items.some(i => i.action === 'install' || i.action === 'update');
function contextOf(cwd: string, home: string, env: NodeJS.ProcessEnv): { project: ProjectContext; stateRoot: string } {
  const project = discoverProject(cwd, home); return { project, stateRoot: privateStateRoot(env, home) };
}

/** `skills sync`. Returns the exit code: 0 done or nothing to do, 3 approval required. A refusal throws. */
export async function runSyncCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env, acquirer: SyncDeps['acquirer'] = productionAcquirer): Promise<number> {
  const { values, flags, rest } = takeFlags(args.slice(2), ['--team', '--max-github-requests'], ['--offline', '--frozen'], SYNC_USAGE);
  const max = maxRequestsFlag(values.get('--max-github-requests'), SYNC_USAGE);
  const approval = parseApprovalFlags(rest); if (approval.rest.length) usage(SYNC_USAGE);
  const team = values.get('--team') ?? null; if (team !== null && !isId(team)) usage(SYNC_USAGE);
  // Spec 07: the planner reads the token through this reader only when an authored lock item needs its repository.
  const githubToken = githubTokenReader(env);
  const { project, stateRoot } = contextOf(cwd, home, env), input = () => ({ project, stateRoot, home, team, offline: flags.has('--offline'), frozen: flags.has('--frozen'), githubToken, ...(max !== undefined ? { maxGithubRequests: max } : {}) });
  let first: SyncPlan; try { first = await planSync(input()); } catch (error) { throw approvalFault(error, approval.approve); }
  if (!actionable(first) && !first.storeFetch.some(f => f.storeCache === 'missing') && approval.approve === undefined) { write(approval.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : `${plainText(renderSyncReview(first, max !== undefined), true)}\nNothing to change.\n`); return 0; }
  let pending: SyncPlan | null = first, result: SyncResult | null = null;
  const change: PlannedChange<SyncPlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planSync(input()); },
    revision: plan => plan.revision, review: plan => renderSyncReview(plan, max !== undefined), staleNote: syncStaleNote,
    async apply(revision: string) {
      result = await withInterrupt((signal, managed) => applySync(input(), revision, { acquirer, signal, managed })); return result;
    },
  };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json }, io);
  write(outcome.output + (outcome.exitCode === 0 && result && !approval.json ? resultWords(result) : '')); return outcome.exitCode;
}

const ACTIONS: readonly string[] = ['resume', 'rollback', 'abandon'];
function renderRecoveryReview(item: string) {
  return (plan: RecoveryPlanV2): string => [
    `Recover ${item}: ${plan.action} its unfinished operation ${plan.operationKey.slice(0, 12)}`,
    plan.action === 'resume' ? '  Finish the change that was approved, from where it stopped.' : plan.action === 'rollback' ? '  Put back exactly what was there before the change.' : '  End an operation that never changed the project.',
    'This changes only that item\'s copies and its private records. It starts no workers and runs nothing.',
  ].join('\n');
}
/** `skills recover plan|apply --item <id>`. */
export async function runRecoverItemCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const mode = args[2]; if (mode !== 'plan' && mode !== 'apply') return usage(RECOVER_USAGE);
  const { values, rest } = takeFlags(args.slice(3), ['--item', '--action'], [], RECOVER_USAGE);
  const approval = parseApprovalFlags(rest); if (approval.rest.length || (mode === 'plan' && approval.approve !== undefined)) usage(RECOVER_USAGE);
  const item = values.get('--item'), action = values.get('--action') ?? null;
  if (item === undefined || (action !== null && !ACTIONS.includes(action))) return usage(RECOVER_USAGE);
  const { project, stateRoot } = contextOf(cwd, home, env), input = { project, stateRoot, item, action: action as RecoveryAction | null };
  const change: PlannedChange<RecoveryPlanV2> = { plan: () => planItemRecovery(input), revision: p => p.revision, review: renderRecoveryReview(item), apply: revision => applyItemRecovery(input, revision) };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json }, mode === 'plan' ? { interactive: false, ask: async () => '' } : io);
  write(outcome.output); return outcome.exitCode;
}

function renderMigrateReview(plan: MigratePlan): string {
  return [
    `Migrate skill ${plan.item.id} from the earlier install in .bowerloom-skills to .bowerloom/managed`,
    `  Pin: ${plan.item.pin}`,
    `  Copies for: ${harnessWords(plan.item.harnesses)}`,
    `  Bytes from: ${plan.bytesFrom === 'project-cache' ? "this machine's skills cache" : plan.bytesFrom === 'legacy-cache' ? 'the cache the earlier install read' : `a fetch from ${plan.network.hosts.join(' and ')}`}`,
    '  .bowerloom-skills moves into a private backup. A rollback puts it back exactly.',
    `  The earlier state folder ${plan.legacy.stateDir} is read, never written.`,
    'This copies text files only. It starts no workers and runs nothing.',
  ].join('\n');
}
/** `skills migrate plan|apply --state <v1-state-dir>`. */
export async function runMigrateCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env, acquirer: SyncDeps['acquirer'] = productionAcquirer): Promise<number> {
  const mode = args[2]; if (mode !== 'plan' && mode !== 'apply') return usage(MIGRATE_USAGE);
  const { values, rest } = takeFlags(args.slice(3), ['--state'], [], MIGRATE_USAGE);
  const approval = parseApprovalFlags(rest); if (approval.rest.length || (mode === 'plan' && approval.approve !== undefined)) usage(MIGRATE_USAGE);
  const state = values.get('--state'); if (state === undefined || !isAbsolute(state) || resolve(state) !== state) return usage(MIGRATE_USAGE);
  const { project, stateRoot } = contextOf(cwd, home, env), input = { project, stateRoot, legacyStateDir: state };
  const change: PlannedChange<MigratePlan> = { plan: () => planMigrate(input, mode), revision: p => p.revision, review: renderMigrateReview, apply: revision => applyMigrate(input, revision, { acquirer, signal: new AbortController().signal }) };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json }, mode === 'plan' ? { interactive: false, ask: async () => '' } : io);
  write(outcome.output); return outcome.exitCode;
}
