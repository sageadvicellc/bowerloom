/**
 * `bowerloom folder add <folder-name> <path>`, `bowerloom folder list`, and `bowerloom folder remove <folder-name>` (spec 05,
 * Part B, section 3.3). A registered folder is a folder outside the project, recorded in the store, that a slice can select
 * from. These commands work from any folder and never look for a project. `add` and `remove` plan first and write only
 * through the approval wrapper, under the store lock. `list` reads only.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import {
  applyFolderAdd, applyFolderAllow, applyFolderDeny, applyFolderRemove, listFolders, planFolderAdd, planFolderAllow, planFolderDeny, planFolderRemove, renderFolderAddReview, renderFolderAllowReview, renderFolderDenyReview, renderFolderRemoveReview,
} from '../../../packages/project-context/src/index.js';
import type { FolderAddPlan, FolderAllowPlan, FolderDenyPlan, FolderRemovePlan, PlannedChange } from '../../../packages/project-context/src/index.js';
import { parseApprovalFlags, runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText } from './human.js';
import { terminalIo } from './manifest.js';

export const FOLDER_LIST_FORMAT = 'bowerloom/folder-list/v1beta1';
const USAGE = 'Use bowerloom folder add <folder-name> <path>, bowerloom folder allow <folder-name>, bowerloom folder deny <folder-name>, bowerloom folder list, or bowerloom folder remove <folder-name>, with optional --approve <revision> and --json.';
const usage = (): never => { throw new DefinitionError('USAGE', USAGE); };

/** The flags of a command line, and its words. A word that starts with `-` is no name and no path. */
function words(args: readonly string[]): { flags: string[]; positional: string[]; approve: string | undefined; json: boolean } {
  let parsed: ReturnType<typeof parseApprovalFlags>;
  try { parsed = parseApprovalFlags(args); } catch { return usage(); }
  if (parsed.rest.some(word => word.startsWith('-'))) usage();
  return { flags: [...(parsed.approve !== undefined ? ['--approve', parsed.approve] : []), ...(parsed.json ? ['--json'] : [])], positional: parsed.rest, approve: parsed.approve, json: parsed.json };
}

/** The list in plain words: names padded to the longest, one line each. */
export function renderFolderList(list: ReturnType<typeof listFolders>): string {
  if (!list.store) return 'Registered folders: none yet. There is no store at ~/.bowerloom.\n';
  const head = 'Registered folders in ~/.bowerloom/folders\n';
  if (list.folders.length === 0) return `${head}  none yet\n`;
  const width = Math.max(...list.folders.map(f => plainText(f.name).length));
  return head + list.folders.map(f => `  ${plainText(f.name).padEnd(width)}  ${f.path === null ? '-' : plainText(f.path)}  ${f.state === 'refused' ? `refused (${f.code})` : f.state}`).join('\n') + '\n';
}

/** Runs one folder command and returns the exit code: 0 done, 3 approval required. A refusal throws. */
export async function runFolderCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const sub = args[1];
  if (args[0] !== 'folder') return usage();
  if (sub === 'list') {
    const { positional, approve, json } = words(args.slice(2));
    if (positional.length > 0 || approve !== undefined) usage();
    const list = listFolders(home);
    write(json ? newCommandJson({ format: FOLDER_LIST_FORMAT, folders: list.folders.map(f => ({ name: f.name, path: f.path, state: f.state, code: f.code })) }) : renderFolderList(list));
    return 0;
  }
  if (sub === 'add') {
    const { flags, positional } = words(args.slice(2));
    if (positional.length !== 2) usage();
    const [name, path] = positional as [string, string], controller = new AbortController(), stateRoot = privateStateRoot(env, home);
    const change: PlannedChange<FolderAddPlan> = {
      async plan() { return planFolderAdd(home, cwd, name, path, stateRoot); },
      revision: plan => plan.revision,
      review: renderFolderAddReview,
      async apply(revision: string) { return applyFolderAdd(home, cwd, name, path, revision, controller.signal, stateRoot); },
    };
    return runApprovalCommand(flags, change, io, write);
  }
  if (sub === 'allow' || sub === 'deny') {
    // A grant is for the project that runs the command, found from the working folder.
    const { flags, positional } = words(args.slice(2));
    if (positional.length !== 1) usage();
    const name = positional[0]!, controller = new AbortController(), stateRoot = privateStateRoot(env, home), found = discoverProject(cwd, home), project = { dir: found.dir, projectId: found.projectId };
    if (sub === 'allow') {
      const change: PlannedChange<FolderAllowPlan> = {
        async plan() { return planFolderAllow(home, project, name, stateRoot); },
        revision: plan => plan.revision, review: renderFolderAllowReview,
        async apply(revision: string) { return applyFolderAllow(home, project, name, revision, controller.signal, stateRoot); },
      };
      return runApprovalCommand(flags, change, io, write);
    }
    const change: PlannedChange<FolderDenyPlan> = {
      async plan() { return planFolderDeny(home, project, name); },
      revision: plan => plan.revision, review: renderFolderDenyReview,
      async apply(revision: string) { return applyFolderDeny(home, project, name, revision, controller.signal); },
    };
    return runApprovalCommand(flags, change, io, write);
  }
  if (sub === 'remove') {
    const { flags, positional } = words(args.slice(2));
    if (positional.length !== 1) usage();
    const name = positional[0]!, controller = new AbortController();
    const change: PlannedChange<FolderRemovePlan> = {
      async plan() { return planFolderRemove(home, name); },
      revision: plan => plan.revision,
      review: renderFolderRemoveReview,
      async apply(revision: string) { return applyFolderRemove(home, name, revision, controller.signal); },
    };
    return runApprovalCommand(flags, change, io, write);
  }
  return usage();
}
