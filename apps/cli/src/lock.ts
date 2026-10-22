/**
 * `bowerloom lock verify [--json]` and
 * `bowerloom lock update [--item <kind>:<id>]... [--commit <sha>] [--approve <revision>] [--json]` (spec 06, 3.15).
 * verify reads only and uses no network. update rewrites the lock items from the live store, through the approval wrapper.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { LOCK_LISTS, lockAgrees, lockMismatch, lockSourceLabel, readConfig, readLock, configRefusal } from '../../../packages/project-config/src/index.js';
import { applyLockUpdate, lockUpdateIsNoop, planLockUpdate } from '../../../packages/project-sync/src/index.js';
import type { LockUpdatePlan, LockUpdateResult } from '../../../packages/project-sync/src/index.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

const USAGE = 'Use bowerloom lock verify [--json], or bowerloom lock update [--item <kind>:<id>]... [--commit <sha>], with optional --approve <revision> and --json.';
const usage = (): never => { throw new DefinitionError('USAGE', USAGE); };
type Kind = 'skill' | 'prompt' | 'team';

/** `lock verify`: the file, its hashes, and its agreement with bowerloom.json. No network. */
function verify(words: readonly string[], cwd: string, home: string): string {
  if (words.length > 1 || (words.length === 1 && words[0] !== '--json')) usage();
  const project = discoverProject(cwd, home), got = readLock(project);
  if (got.state === 'absent') throw configRefusal('LOCK_MISSING');
  const config = readConfig(project);
  if (config.state === 'absent') throw configRefusal('LOCK_CONFIG_MISSING');
  if (config.state === 'invalid') throw configRefusal(config.code);
  const agree = lockAgrees(got.lock, config.config);
  if (!agree.agrees) throw lockMismatch([...agree.added, ...agree.removed]);
  const items = LOCK_LISTS.flatMap(([name, kind]) => got.lock[name].map(i => ({ kind, id: i.id, from: i.from, source: 'pin' in i ? 'pin' : 'authored', label: lockSourceLabel(i) })));
  if (words[0] === '--json') return newCommandJson({ format: 'bowerloom/lock-verify/v1beta1', valid: true, sha256: got.sha256, bytes: got.bytes, items });
  return plainText([`bowerloom.lock.json is valid: ${items.length} ${items.length === 1 ? 'item' : 'items'}.`, ...items.map(i => `  ${i.kind} ${i.id}  ${i.label}`), ''].join('\n'), true);
}

const CHANGE_WORDS: Readonly<Record<string, (u: LockUpdatePlan['updated'][number]) => string>> = {
  unchanged: () => 'unchanged', added: () => 'added', removed: () => 'removed',
  pin: u => `pin changed: ${u.from} to ${u.to}`, teams: u => `teams changed: ${u.from} to ${u.to}`,
  commit: u => `commit changed: ${(u.from ?? '').match(/commit ([a-f0-9]{8})/)?.[1] ?? u.from} to ${(u.to ?? '').match(/commit ([a-f0-9]{8})/)?.[1] ?? u.to}`,
};
/** The update plan in plain words (3.15). */
export function renderLockUpdate(plan: LockUpdatePlan): string {
  return ['Update bowerloom.lock.json from your store', ...plan.updated.map(u => `  ${u.kind} ${u.id}  ${CHANGE_WORDS[u.change]!(u)}`), ...plan.notes, 'This changes bowerloom.lock.json only.'].join('\n');
}

/** `lock update`. Returns 0 done or nothing to do, 3 approval required. */
async function update(words: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo): Promise<number> {
  const items: { kind: Kind; id: string }[] = [], rest: string[] = []; let commit: string | null = null, itemsGiven = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === '--item') { const v = words[++i], m = v === undefined ? null : /^(skill|prompt|team):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(v); if (!m) usage(); items.push({ kind: m![1] as Kind, id: m![2]! }); itemsGiven = true; }
    else if (w === '--commit') { const v = words[++i]; if (commit !== null || v === undefined || !/^[a-f0-9]{40}$/.test(v)) throw new DefinitionError('USAGE', 'Use --commit once, with the 40 lower-case hex characters of a pushed commit of the store remote.'); commit = v; }
    else rest.push(w);
  }
  const approval = parseApprovalFlags(rest); if (approval.rest.length) usage();
  const project = discoverProject(cwd, home), controller = new AbortController(), plans = new Map<string, LockUpdatePlan>();
  const plan = () => planLockUpdate({ project, home, items: itemsGiven ? items : null, commit, signal: controller.signal });
  const first = await plan(); plans.set(first.revision, first);
  if (first.nothing) { write(approval.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : 'Nothing to lock.\n'); return 0; }
  if (lockUpdateIsNoop(first) && approval.approve === undefined) { write(approval.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : `${plainText(renderLockUpdate(first), true)}\nNothing to change.\n`); return 0; }
  let pending: LockUpdatePlan | null = first, result: LockUpdateResult | null = null;
  const change: PlannedChange<LockUpdatePlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } const p = await plan(); plans.set(p.revision, p); return p; },
    revision: p => p.revision, review: renderLockUpdate,
    async apply(revision: string) {
      const p = plans.get(revision); if (!p) throw new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');
      result = await withProjectLock(project.dir, controller.signal, async held => applyLockUpdate(p, revision, held, project, home)); return result;
    },
  };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json: approval.json }, io);
  write(outcome.output + (outcome.exitCode === 0 && result && !approval.json ? 'Updated bowerloom.lock.json.\n' : ''));
  return outcome.exitCode;
}

/** `lock verify` and `lock update`. */
export async function runLockCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), _env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (args[1] === 'verify') { write(verify(args.slice(2), cwd, home)); return 0; }
  if (args[1] === 'update') return update(args.slice(2), cwd, home, write, io);
  return usage();
}
