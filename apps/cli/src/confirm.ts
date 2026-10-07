import { canonicalJson, DefinitionError } from '../../../packages/contracts/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { plainText } from './human.js';

export interface ApprovalIo { readonly interactive: boolean; ask(question: string): Promise<string> }
export interface ApprovalFlags { readonly approve?: string; readonly json: boolean }

const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const REVISION = /^[a-f0-9]{64}$/;

/**
 * Takes `--approve <64 lowercase hex>` and `--json` out of a command line. `--yes` is a usage error:
 * approval always names the plan it approves. No environment variable changes this.
 */
export function parseApprovalFlags(args: readonly string[]): { approve?: string; json: boolean; rest: string[] } {
  const rest: string[] = []; let approve: string | undefined, json = false;
  for (let i = 0; i < args.length; i++) {
    const word = args[i]!;
    if (word === '--yes' || word.startsWith('--yes=') || word === '-y') usage('There is no --yes. Review the plan, then pass --approve <revision>.');
    else if (word === '--approve' || word.startsWith('--approve=')) {
      const value = args[++i];
      if (word !== '--approve' || approve !== undefined || value === undefined || !REVISION.test(value)) usage('Use --approve once, followed by the 64-character revision from the plan.');
      approve = value;
    } else if (word === '--json') { if (json) usage('Use --json once.'); json = true; }
    else rest.push(word);
  }
  return { ...(approve !== undefined ? { approve } : {}), json, rest };
}

// Flags of the CLI that take no value. Any other `--flag` without `=` takes the next word as its value.
const NO_VALUE = new Set(['--json', '--synthetic', '--demo', '--pro', '--5x', '--20x', '--help', '--version']);
const takesValue = (word: string | undefined): boolean => word !== undefined && word.startsWith('--') && !word.includes('=') && !NO_VALUE.has(word);
/**
 * True when a command line passes `--yes` or `-y` as a flag. `--yes` and `--yes=...` count anywhere. `-y` counts only in a
 * flag position, not as the value of the flag before it, so `init plan --goal -y` keeps working as it did before 0.7.0.
 */
export function namesYesFlag(args: readonly string[]): boolean {
  return args.some((word, i) => word === '--yes' || word.startsWith('--yes=') || (word === '-y' && !takesValue(args[i - 1])));
}

const shorten = (revision: string): string => `${revision.slice(0, 4)}…${revision.slice(-4)}`;
const stale = (): DefinitionError => new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');

/**
 * Plans, then applies only what was approved.
 * - With a matching `--approve`: applies once and never asks.
 * - In a terminal without `--json`: shows the plan, asks, plans again, and applies only if the revision is unchanged.
 * - Otherwise: prints the plan and its revision and returns exit code 3 (APPROVAL_REQUIRED). Nothing is written.
 */
export async function runWithApproval<P>(change: PlannedChange<P>, flags: ApprovalFlags, io: ApprovalIo): Promise<{ output: string; exitCode: 0 | 3 }> {
  const plan = await change.plan(), revision = change.revision(plan);
  if (!REVISION.test(revision)) throw new DefinitionError('IO_ERROR', 'The plan has no valid revision, so nothing was applied.');
  const applied = async (value: string): Promise<{ output: string; exitCode: 0 }> => {
    const result = await change.apply(value);
    return { output: flags.json ? `${canonicalJson({ applied: true, revision: value, result })}\n` : `Applied plan ${value}.\n`, exitCode: 0 };
  };
  if (flags.approve !== undefined) { if (flags.approve !== revision) throw stale(); return applied(revision); }
  if (io.interactive && !flags.json) {
    const answer = await io.ask(`${plainText(change.review(plan), true)}\nApply plan ${shorten(revision)}? [y/N] `);
    if (!/^y(?:es)?$/i.test(answer.trim())) throw new DefinitionError('APPROVAL_DECLINED', 'You declined the plan. Nothing was changed.');
    const again = change.revision(await change.plan());
    if (again !== revision) throw stale();
    return applied(revision);
  }
  return {
    output: flags.json
      ? `${canonicalJson({ approvalRequired: true, code: 'APPROVAL_REQUIRED', plan, revision })}\n`
      : `${plainText(change.review(plan), true)}\nRevision: ${revision}\nApproval required. Run the same command again with --approve ${revision}\n`,
    exitCode: 3,
  };
}

/** The wiring a write command in main.ts uses: parse the flags, run the change, print the result, return the exit code. */
export async function runApprovalCommand<P>(args: readonly string[], change: PlannedChange<P>, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  const flags = parseApprovalFlags(args);
  if (flags.rest.length) usage('This command takes only --approve <revision> and --json.');
  const result = await runWithApproval(change, { ...(flags.approve !== undefined ? { approve: flags.approve } : {}), json: flags.json }, io);
  write(result.output); return result.exitCode;
}
