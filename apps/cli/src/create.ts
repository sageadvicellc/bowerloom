/**
 * `bowerloom team create <name> [--profile engineer|founder|research]`,
 * `bowerloom skill create <name> [--team <team>]...` and `bowerloom prompt create <name> [--team <team>]...`,
 * each with `[--approve <revision>] [--json]` (build plan 01, M2).
 *
 * The command finds the project, plans, and writes only through the approval wrapper, under the project lock.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, verifyProjectPins, withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { applyCreate, planCreate } from '../../../packages/project-authoring/src/index.js';
import type { AuthoringReceipt, CreateInput, CreatePlan } from '../../../packages/project-authoring/src/index.js';
import { startupProfiles } from '../../../packages/startup/src/index.js';
import type { StartupProfile } from '../../../packages/startup/src/index.js';
import { runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { terminalIo } from './manifest.js';

export const CREATE_NOUNS = ['team', 'skill', 'prompt'] as const;
type Noun = typeof CREATE_NOUNS[number];
const USAGE: Readonly<Record<Noun, string>> = {
  team: 'Use bowerloom team create <name> [--profile engineer|founder|research], with optional --approve <revision> and --json.',
  skill: 'Use bowerloom skill create <name> [--team <team>]..., with optional --approve <revision> and --json.',
  prompt: 'Use bowerloom prompt create <name> [--team <team>]..., with optional --approve <revision> and --json.',
};
const usage = (noun: Noun): never => { throw new DefinitionError('USAGE', USAGE[noun]); };

export interface CreateArgs { noun: Noun; name: string; profile: StartupProfile | null; teams: string[]; approval: string[] }
/** Splits a create command line into its name, --profile or --team, and the approval flags for the wrapper. */
export function parseCreateArgs(args: readonly string[]): CreateArgs {
  const noun = args[0] as Noun;
  if (!(CREATE_NOUNS as readonly string[]).includes(noun)) throw new DefinitionError('USAGE', USAGE.team);
  if (args[1] !== 'create') usage(noun);
  let name: string | null = null, profile: StartupProfile | null = null; const teams: string[] = [], approval: string[] = [];
  const words = args.slice(2);
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--approve') { approval.push(word); if (i + 1 < words.length) approval.push(words[++i]!); }
    else if (word === '--json') approval.push(word);
    else if (word === '--profile' && noun === 'team') {
      const value = words[++i];
      if (profile !== null || value === undefined || !Object.hasOwn(startupProfiles, value)) usage(noun);
      profile = value as StartupProfile;
    } else if (word === '--team' && noun !== 'team') {
      const value = words[++i];
      if (value === undefined || value.startsWith('-') || teams.includes(value) || teams.length >= 32) usage(noun);
      teams.push(value!);
    } else if (word.startsWith('-') || name !== null) usage(noun);
    else name = word;
  }
  if (name === null) usage(noun);
  return { noun, name: name!, profile, teams, approval };
}

/** The plan in plain words. The wrapper escapes control characters before it prints. */
export function renderCreateReview(plan: CreatePlan): string {
  const lines: string[] = [];
  const where = (kind: string, id: string) => kind === 'prompt' ? `.bowerloom/prompts/${id}.md` : `.bowerloom/${kind === 'team' ? 'teams' : 'skills'}/${id}`;
  if (plan.scratch.length) lines.push(`Remove ${plan.scratch.length} scratch ${plan.scratch.length === 1 ? 'entry' : 'entries'} that an interrupted create left in .bowerloom/authoring`);
  if (plan.settled) lines.push(`Remove the leftover record of ${plan.settled.kind} ${plan.settled.id}. It was created and registered; only its record stayed.`);
  if (plan.discard) lines.push(`Clear the record of an interrupted create of ${plan.discard.kind} ${plan.discard.id}. Nothing of it was put in place.`);
  if (plan.finish) lines.push(`Finish ${plan.finish.kind} ${plan.finish.id} from an interrupted create. Its ${plan.finish.files.length === 1 ? 'file is' : 'files are'} already in ${where(plan.finish.kind, plan.finish.id)}, with the recorded bytes.`);
  if (plan.restore) {
    // Review freeze finding 1: a registered prompt whose file is gone comes back with the text it was created with.
    const item = plan.restore;
    lines.push(`Restore prompt ${item.id} in ${where('prompt', item.id)}`, '  Its file is gone. Create writes it again with the text it was created with.',
      `  Teams: ${item.teams.length ? item.teams.join(', ') : 'every team'}`, `  Files: ${item.files.length}`);
  }
  if (plan.item) {
    const item = plan.item;
    lines.push(`Create ${item.kind} ${item.id} in ${where(item.kind, item.id)}`);
    if (item.kind === 'team') {
      const brief = plan.files.find(f => f.path.endsWith('/assets/brief.json'));
      const profile = brief ? (JSON.parse(brief.text) as { profile?: string }).profile ?? 'engineer' : 'engineer';
      lines.push(`  Profile: ${profile}`, '  Built from the project brief, with the lead, maker and reviewer templates.');
    } else lines.push(`  Teams: ${item.teams.length ? item.teams.join(', ') : 'every team'}`);
    lines.push(`  Files: ${item.files.length}`);
  }
  if (plan.manifest) lines.push(`  skills.json: adds a local entry; ${plan.manifest.before === null ? 'a new file' : `replaces the file with sha256 ${plan.manifest.before.sha256}`}`);
  lines.push('You and your agents own these files and can edit them.', 'This writes inside .bowerloom only. It starts no workers and runs nothing.');
  return lines.join('\n');
}

/** Runs one create command and returns the exit code: 0 done, 3 approval required. A refusal throws. */
export async function runCreateCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo()): Promise<number> {
  const parsed = parseCreateArgs(args);
  const project = discoverProject(cwd, home);
  const input: CreateInput = parsed.noun === 'team'
    ? { kind: 'team', project: project.dir, name: parsed.name, ...(parsed.profile !== null ? { profile: parsed.profile } : {}) }
    : { kind: parsed.noun, project: project.dir, name: parsed.name, teams: parsed.teams };
  return runApprovalCommand(parsed.approval, createChange(project, input), io, write);
}

/** One create as a change for the approval wrapper: plan reads only; apply runs under the project lock. `up --team` reuses it. */
export function createChange(project: ProjectContext, input: CreateInput): PlannedChange<CreatePlan> {
  const controller = new AbortController();
  return {
    async plan() { verifyProjectPins(project); const plan = await planCreate(input); verifyProjectPins(project); return plan; },
    revision: plan => plan.revision,
    review: renderCreateReview,
    async apply(revision: string): Promise<AuthoringReceipt> {
      return withProjectLock(project.dir, controller.signal, async held => { verifyProjectPins(project); return applyCreate(input, revision, held); });
    },
  };
}
