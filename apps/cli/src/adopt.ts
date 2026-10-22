/**
 * `bowerloom team adopt <id> [--approve <revision>] [--json]` (spec 06, 3.17). The create plan of the copy and the
 * config change run under one project lock. The plan reads no network.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot, withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { applyAdopt, planAdopt } from '../../../packages/project-sync/src/index.js';
import type { AdoptPlan } from '../../../packages/project-sync/src/index.js';
import { runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { terminalIo } from './manifest.js';

/** The adopt plan in plain words (3.17). */
export function renderAdopt(plan: AdoptPlan): string {
  const id = plan.config.change.id, lines: string[] = [];
  if (plan.finishing) lines.push(`Finish adopting team ${id}.`);
  if (plan.create?.bowerloomFolder === 'create') lines.push('Create .bowerloom (records of the copies). Its contents are git-ignored.');
  if (plan.create) {
    const files = plan.create.files.filter(f => f.path.startsWith(`teams/${id}/`)).length;
    lines.push(`Adopt team ${id} from the store`, `  Copies teams/${id} (${files} files) to .bowerloom/teams/${id}`, '  Registers it in .bowerloom/authoring/receipt.json');
  }
  lines.push(`bowerloom.json: team ${id} changes from store to project`);
  for (const d of plan.config.direct) lines.push(`bowerloom.json: ${d.kind} ${d.id} is now picked directly`);
  if (plan.config.lock?.removes.includes(`team ${id}`)) lines.push(`bowerloom.lock.json: removes team ${id}`);
  lines.push('The project now owns this copy. Later store changes do not reach it.');
  return lines.join('\n');
}

/** `team adopt <id>`. Returns 0 done, 3 approval required. */
export async function runAdoptCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const id = args[2];
  if (args[0] !== 'team' || args[1] !== 'adopt' || id === undefined || id.startsWith('-')) throw new DefinitionError('USAGE', 'Use bowerloom team adopt <id>, with optional --approve <revision> and --json.');
  const project = discoverProject(cwd, home), input = { project, home, stateRoot: privateStateRoot(env, home), id };
  const plans = new Map<string, AdoptPlan>(), controller = new AbortController();
  const change: PlannedChange<AdoptPlan> = {
    async plan() { const p = await planAdopt(input); plans.set(p.revision, p); return p; },
    revision: p => p.revision, review: renderAdopt,
    async apply(revision: string) {
      const p = plans.get(revision); if (!p) throw new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');
      return withProjectLock(project.dir, controller.signal, held => applyAdopt(input, p, revision, held));
    },
  };
  return runApprovalCommand(args.slice(3), change, io, write);
}
