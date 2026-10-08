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
import type { RecoveryAction, RecoveryPlanV2 } from '../../../packages/managed-skills/src/v2-types.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const SYNC_USAGE = 'Use bowerloom skills sync [--offline] [--team <team>], with optional --approve <revision> and --json.';
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

/** One sync item in plain words, its id padded to `width`. `apply` (M6) reuses it. */
export function itemLine(item: SyncItem, width: number): string[] {
  const id = item.id.padEnd(width), pin = item.pin ?? '';
  const how = item.cache?.status === 'needs-fetch' ? `, fetched from ${item.kind === 'git' ? 'api.github.com' : 'registry.npmjs.org'}` : item.cache?.status === 'cached' ? ", from this machine's cache" : '';
  if (item.action === 'hold') return [`  ${id} held (${item.hold!.code})`, `  ${''.padEnd(width)} Next: ${item.hold!.next}`];
  switch (item.state) {
    case 'up-to-date': return [`  ${id} up to date${item.action === 'update' ? ' (puts back .bowerloom/managed/.gitignore)' : ''}`];
    case 'orphaned': return [`  ${id} kept: no longer in skills.json, and sync removes nothing`];
    case 'local': return [`  ${id} ${item.action} your skill in .bowerloom/skills/${item.id}`];
    case 'pin-changed': return [`  ${id} update to ${pin}${how}`];
    case 'harnesses-changed': return [item.action === 'update' ? `  ${id} add ${harnessWords(item.harnesses)} copies` : `  ${id} kept for ${harnessWords(item.harnesses)}: removing a harness is not supported yet`];
    default: return [`  ${id} install ${item.kind} ${pin}${how}`];
  }
}
/** The sync plan in plain words. confirm.ts escapes control characters again before printing. */
export function renderSyncReview(plan: SyncPlan): string {
  const fetch = plan.items.filter(i => (i.action === 'install' || i.action === 'update') && i.cache?.status === 'needs-fetch');
  return [
    `Sync skills from .bowerloom/skills.json for ${harnessWords(plan.harnesses)}${plan.team ? `, team ${plan.team}` : ''}${plan.offline ? ', offline' : ''}`,
    ...(plan.items.length ? plan.items.flatMap(i => itemLine(i, Math.max(...plan.items.map(x => x.id.length)) + 1)) : ['  skills.json names no skill for this sync.']),
    fetch.length ? `Network: reads ${plan.network.hosts.join(' and ')} for ${fetch.length} ${fetch.length === 1 ? 'skill' : 'skills'}, public and without credentials. Bytes must match their pins.` : 'Network: none.',
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
        running = req.item.kind === 'prompt' ? 'prompt-' + req.item.id : req.item.id;
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
  const { values, flags, rest } = takeFlags(args.slice(2), ['--team'], ['--offline'], SYNC_USAGE);
  const approval = parseApprovalFlags(rest); if (approval.rest.length) usage(SYNC_USAGE);
  const team = values.get('--team') ?? null; if (team !== null && !isId(team)) usage(SYNC_USAGE);
  const { project, stateRoot } = contextOf(cwd, home, env), input = () => ({ project, stateRoot, team, offline: flags.has('--offline') });
  const first = await planSync(input());
  if (!actionable(first) && approval.approve === undefined) { write(approval.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : `${plainText(renderSyncReview(first), true)}\nNothing to change.\n`); return 0; }
  let pending: SyncPlan | null = first, result: SyncResult | null = null;
  const change: PlannedChange<SyncPlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planSync(input()); },
    revision: plan => plan.revision, review: renderSyncReview,
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
    `  Bytes from: ${plan.bytesFrom === 'project-cache' ? "this project's cache" : plan.bytesFrom === 'legacy-cache' ? 'the cache the earlier install read' : `a fetch from ${plan.network.hosts.join(' and ')}`}`,
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
  const change: PlannedChange<MigratePlan> = { plan: () => planMigrate(input), revision: p => p.revision, review: renderMigrateReview, apply: revision => applyMigrate(input, revision, { acquirer, signal: new AbortController().signal }) };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json }, mode === 'plan' ? { interactive: false, ask: async () => '' } : io);
  write(outcome.output); return outcome.exitCode;
}
