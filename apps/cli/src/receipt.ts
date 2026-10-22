/**
 * `bowerloom receipt clean [--global] [--approve <revision>] [--json]` (spec 08, 3.4). It removes the entries of created
 * items whose files are gone from the record of created items, through the approval wrapper. It deletes no file.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, inspectStore, projectRefusal, withProjectLock, withStoreForWrite } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { applyReceiptClean, planReceiptClean } from '../../../packages/project-sync/src/index.js';
import type { ReceiptCleanInput, ReceiptCleanPlan, ReceiptCleanResult } from '../../../packages/project-sync/src/index.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

export const RECEIPT_USAGE = 'Use bowerloom receipt clean [--global] [--approve <revision>] [--json].';
const usage = (): never => { throw new DefinitionError('USAGE', RECEIPT_USAGE); };
/** `  <kind> <id>` and the space before the words, so the words of every kind start in one column (spec 08, 3.1). */
export const itemLabel = (kind: string, id: string): string => `  ${kind} ${id}${' '.repeat(Math.max(1, 9 - kind.length))}`;
const entries = (n: number): string => `${n} ${n === 1 ? 'entry' : 'entries'}`;

/** The plan in plain words (3.4). */
export function renderReceiptClean(plan: ReceiptCleanPlan): string {
  const record = plan.scope === 'store' ? '~/.bowerloom/authoring/receipt.json' : '.bowerloom/authoring/receipt.json';
  const lines = [`Remove ${entries(plan.items.length)} from the record of created items (${record})`];
  for (const item of plan.items) lines.push(`${itemLabel(item.kind, item.id)}its files are gone`);
  for (const step of plan.manifest?.steps ?? []) lines.push(`skills.json: removes the local entry for skill ${step.id}`);
  for (const r of plan.config?.removes ?? []) lines.push(`bowerloom.json: removes ${r.kind} ${r.id} (project)`);
  const scratch = plan.scratch.length + plan.projectScratch.length;
  if (scratch) lines.push(`Remove ${scratch} scratch ${scratch === 1 ? 'file' : 'files'} that an interrupted command left.`);
  lines.push('This deletes no file and no installed copy. Copies of these items stay where they are.');
  return lines.join('\n');
}

/** `receipt clean`. Returns 0 done or nothing to clean, 3 approval required. A refusal throws. */
export async function runReceiptCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), _env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (args[1] !== 'clean') usage();
  let global = false; const rest: string[] = [];
  for (const word of args.slice(2)) { if (word === '--global') { if (global) usage(); global = true; } else rest.push(word); }
  const flags = parseApprovalFlags(rest);
  if (flags.rest.length) usage();
  let input: ReceiptCleanInput;
  if (global) {
    // Rule 1: the store scope needs a valid store, checked before withStoreForWrite could make one.
    const found = inspectStore(home);
    if (found.state === 'absent') throw projectRefusal('STORE_NOT_FOUND');
    if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
    input = { scope: 'store', store: found.context };
  } else input = { scope: 'project', project: discoverProject(cwd, home) };
  const controller = new AbortController();
  const first = planReceiptClean(input);
  if (first.items.length === 0) { write(flags.json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : 'Nothing to clean.\n'); return 0; }
  let pending: ReceiptCleanPlan | null = first, result: ReceiptCleanResult | null = null;
  const change: PlannedChange<ReceiptCleanPlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return planReceiptClean(input); },
    revision: p => p.revision,
    review: renderReceiptClean,
    async apply(revision: string) {
      result = input.scope === 'store'
        ? await withStoreForWrite(home, controller.signal, async (context, held, created) => applyReceiptClean({ scope: 'store', store: context }, revision, held, { context, created }))
        : await withProjectLock(input.project.dir, controller.signal, async held => applyReceiptClean(input, revision, held));
      return result;
    },
  };
  const outcome = await runWithApproval(change, { ...(flags.approve !== undefined ? { approve: flags.approve } : {}), json: flags.json }, io);
  write(outcome.output + (outcome.exitCode === 0 && result && !flags.json ? plainText(`Removed ${entries((result as ReceiptCleanResult).removed.length)} from the record of created items.\n`, true) : ''));
  return outcome.exitCode;
}
