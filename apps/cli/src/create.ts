/**
 * `bowerloom team create <name> [--profile engineer|founder|research]`,
 * `bowerloom skill create <name> [--team <team>]...` and `bowerloom prompt create <name> [--team <team>]...`,
 * each with `[--approve <revision>] [--json]` (build plan 01, M2).
 *
 * The command finds the project, plans, and writes only through the approval wrapper, under the project lock.
 *
 * With `--global` the command works on the store, `~/.bowerloom`, from any folder. It never looks for a project, and the
 * first `--global` write makes the store (spec 04, 3.3). The store holds definitions only.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, inspectStore, projectRefusal, readFolderRecord, storeRootOf, verifyProjectPins, verifyStorePins, withProjectLock, withStoreForWrite } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { applyCreate, planCreate } from '../../../packages/project-authoring/src/index.js';
import type { AuthoringReceipt, CreateInput, CreatePlan } from '../../../packages/project-authoring/src/index.js';
import { startupProfiles } from '../../../packages/startup/src/index.js';
import { compilePattern } from '../../../packages/context-slices/src/glob.js';
import { SLICE_LIMITS, isFolderName, validRootPath } from '../../../packages/context-slices/src/slice-file.js';
import type { StartupProfile } from '../../../packages/startup/src/index.js';
import { runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { terminalIo } from './manifest.js';

export const CREATE_NOUNS = ['team', 'skill', 'prompt', 'slice'] as const;
type Noun = typeof CREATE_NOUNS[number];
const USAGE: Readonly<Record<Noun, string>> = {
  team: 'Use bowerloom team create <name> [--profile engineer|founder|research], with optional --global, --approve <revision> and --json.',
  skill: 'Use bowerloom skill create <name> [--team <team>]..., with optional --global, --approve <revision> and --json.',
  prompt: 'Use bowerloom prompt create <name> [--team <team>]..., with optional --global, --approve <revision> and --json.',
  slice: 'Use bowerloom slice create <name> [--root <folder>] [--registered <folder-name>] [--include <pattern>]..., with optional --approve <revision> and --json.',
};
const usage = (noun: Noun): never => { throw new DefinitionError('USAGE', USAGE[noun]); };

export interface CreateArgs { noun: Noun; name: string; profile: StartupProfile | null; teams: string[]; global: boolean; approval: string[]; root: string | null; includes: string[]; registered: string | null }
/** Splits a create command line into its name, --profile or --team, --global, and the approval flags for the wrapper. */
export function parseCreateArgs(args: readonly string[]): CreateArgs {
  const noun = args[0] as Noun;
  if (!(CREATE_NOUNS as readonly string[]).includes(noun)) throw new DefinitionError('USAGE', USAGE.team);
  if (args[1] !== 'create') usage(noun);
  let name: string | null = null, profile: StartupProfile | null = null, global = false, root: string | null = null, registered: string | null = null; const teams: string[] = [], approval: string[] = [], includes: string[] = [];
  const words = args.slice(2);
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--approve') { approval.push(word); if (i + 1 < words.length) approval.push(words[++i]!); }
    else if (word === '--json') approval.push(word);
    else if (word === '--global' && noun !== 'slice') { if (global) throw new DefinitionError('USAGE', 'Use --global once.'); global = true; }
    else if (word === '--profile' && noun === 'team') {
      const value = words[++i];
      if (profile !== null || value === undefined || !Object.hasOwn(startupProfiles, value)) usage(noun);
      profile = value as StartupProfile;
    } else if (word === '--root' && noun === 'slice') {
      const value = words[++i];
      if (root !== null || value === undefined || !validRootPath(value)) usage(noun);
      root = value!;
    } else if (word === '--registered' && noun === 'slice') {
      const value = words[++i];
      if (registered !== null || value === undefined || !isFolderName(value)) usage(noun);
      registered = value!;
    } else if (word === '--include' && noun === 'slice') {
      const value = words[++i];
      if (value === undefined || includes.length >= SLICE_LIMITS.patterns || Buffer.byteLength(value) > SLICE_LIMITS.patternBytes || !compilePattern(value).ok) usage(noun);
      includes.push(value!);
    } else if (word === '--team' && noun !== 'team' && noun !== 'slice') {
      const value = words[++i];
      if (value === undefined || value.startsWith('-') || teams.includes(value) || teams.length >= 32) usage(noun);
      teams.push(value!);
    } else if (word.startsWith('-') || name !== null) usage(noun);
    else name = word;
  }
  if (name === null) usage(noun);
  return { noun, name: name!, profile, teams, global, approval, root, includes, registered };
}

/** The plan in plain words. The wrapper escapes control characters before it prints. */
export function renderCreateReview(plan: CreatePlan, registeredRel?: string): string {
  const lines: string[] = [];
  const store = plan.scope === 'store', root = store ? '~/.bowerloom' : '.bowerloom';
  const where = (kind: string, id: string) => kind === 'prompt' ? `${root}/prompts/${id}.md` : kind === 'slice' ? `${root}/slices/${id}.yaml` : `${root}/${kind === 'team' ? 'teams' : 'skills'}/${id}`;
  const after = (id: string): string[] => [`After this, bowerloom apply puts the index skill slice-${id} in place. An agent loads it when its skills list names slice-${id}.`];
  if (plan.storeCreate) lines.push('Create the store at ~/.bowerloom (store.json). It holds definitions only.');
  if (plan.scratch.length) lines.push(`Remove ${plan.scratch.length} scratch ${plan.scratch.length === 1 ? 'entry' : 'entries'} that an interrupted create left in ${root}/authoring`);
  if (plan.settled) lines.push(`Remove the leftover record of ${plan.settled.kind} ${plan.settled.id}. It was created and registered; only its record stayed.`);
  if (plan.discard) lines.push(`Clear the record of an interrupted create of ${plan.discard.kind} ${plan.discard.id}. Nothing of it was put in place.`);
  if (plan.finish) lines.push(`Finish ${plan.finish.kind} ${plan.finish.id} from an interrupted create. Its ${plan.finish.files.length === 1 ? 'file is' : 'files are'} already in ${where(plan.finish.kind, plan.finish.id)}, with the recorded bytes.`);
  if (plan.restore) {
    // Review freeze finding 1: a registered prompt whose file is gone comes back with the text it was created with.
    const item = plan.restore;
    lines.push(`Restore prompt ${item.id} in ${where('prompt', item.id)}`, '  Its file is gone. Create writes it again with the text it was created with.',
      `  Teams: ${item.teams.length ? item.teams.join(', ') : 'every team'}`, `  Files: ${item.files.length}`);
  }
  if (plan.register) {
    const item = plan.register;
    lines.push(`Register slice ${item.id} from ${where('slice', item.id)}, which is already there`, '  Its bytes stay as they are.', ...after(item.id));
  }
  if (plan.item) {
    const item = plan.item;
    lines.push(`Create ${item.kind} ${item.id} in ${store ? 'the store at ' : ''}${where(item.kind, item.id)}`);
    if (item.kind === 'slice' && plan.slice) {
      const slice = plan.slice.root;
      lines.push(slice.kind === 'project' ? `  Root: ${slice.path} in this project` : `  Root: ${slice.path} in registered folder ${slice.name} (~/${registeredRel ?? '?'})`, `  Include: ${plan.slice.includes.join(', ')}`);
    } else if (item.kind === 'team') {
      const brief = plan.files.find(f => f.path.endsWith('/assets/brief.json'));
      const profile = brief ? (JSON.parse(brief.text) as { profile?: string }).profile ?? 'engineer' : 'engineer';
      lines.push(`  Profile: ${profile}`, store ? '  Built from a fixed store brief, with the lead, maker and reviewer templates.' : '  Built from the project brief, with the lead, maker and reviewer templates.');
    } else lines.push(`  Teams: ${item.teams.length ? item.teams.join(', ') : 'every team'}`);
    lines.push(`  Files: ${item.files.length}`);
    if (item.kind === 'slice') lines.push(...after(item.id));
  }
  if (plan.manifest) {
    if (store) { const added = plan.manifest.steps.at(-1); if (added) lines.push(`  skills.json: adds a local entry for ${added.id}`); }
    else lines.push(`  skills.json: adds a local entry; ${plan.manifest.before === null ? 'a new file' : `replaces the file with sha256 ${plan.manifest.before.sha256}`}`);
  }
  lines.push('You and your agents own these files and can edit them.', store ? 'This writes the store only. It changes no project, and it installs nothing.' : 'This writes inside .bowerloom only. It starts no workers and runs nothing.');
  return lines.join('\n');
}

/** Runs one create command and returns the exit code: 0 done, 3 approval required. A refusal throws. */
export async function runCreateCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo()): Promise<number> {
  const parsed = parseCreateArgs(args);
  if (parsed.global) {
    const input: CreateInput = parsed.noun === 'team'
      ? { kind: 'team', scope: 'store', project: storeRootOf(home), name: parsed.name, ...(parsed.profile !== null ? { profile: parsed.profile } : {}) }
      : { kind: parsed.noun as 'skill' | 'prompt', scope: 'store', project: storeRootOf(home), name: parsed.name, teams: parsed.teams };
    return runApprovalCommand(parsed.approval, createStoreChange(home, input), io, write);
  }
  const project = discoverProject(cwd, home);
  const input: CreateInput = parsed.noun === 'team'
    ? { kind: 'team', project: project.dir, name: parsed.name, ...(parsed.profile !== null ? { profile: parsed.profile } : {}) }
    : parsed.noun === 'slice'
    ? { kind: 'slice', project: project.dir, name: parsed.name, root: parsed.registered !== null ? { kind: 'registered', name: parsed.registered, path: parsed.root ?? '.' } : parsed.root === null ? null : { kind: 'project', path: parsed.root }, includes: parsed.includes.length ? parsed.includes : null }
    : { kind: parsed.noun, project: project.dir, name: parsed.name, teams: parsed.teams };
  // A registered folder must be in the store. The recorded path is part of the plan's words.
  return runApprovalCommand(parsed.approval, createChange(project, input, parsed.registered === null ? undefined : registeredPath(home, parsed.registered)), io, write);
}

/** The path below home that the store records for registered folder `name`. FOLDER_NOT_FOUND when the store or the record is absent. */
function registeredPath(home: string, name: string): string {
  const found = inspectStore(home);
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  if (found.state === 'absent') throw projectRefusal('FOLDER_NOT_FOUND');
  return readFolderRecord(found.context, name).path;
}

/** One create as a change for the approval wrapper: plan reads only; apply runs under the project lock. `up --team` reuses it. */
export function createChange(project: ProjectContext, input: CreateInput, registeredRel?: string): PlannedChange<CreatePlan> {
  const controller = new AbortController();
  return {
    async plan() { verifyProjectPins(project); const plan = await planCreate(input); verifyProjectPins(project); return plan; },
    revision: plan => plan.revision,
    review: plan => renderCreateReview(plan, registeredRel),
    async apply(revision: string): Promise<AuthoringReceipt> {
      return withProjectLock(project.dir, controller.signal, async held => { verifyProjectPins(project); return applyCreate(input, revision, held); });
    },
  };
}

/**
 * One create in the store as a change for the approval wrapper. The plan reads only, and checks the store pins before and
 * after its reads. Apply runs inside `withStoreForWrite`, which makes the store when it is absent and holds its lock.
 */
export function createStoreChange(home: string, input: CreateInput): PlannedChange<CreatePlan> {
  const controller = new AbortController();
  return {
    async plan() {
      const found = inspectStore(home);
      if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
      if (found.state === 'store') verifyStorePins(found.context);
      const plan = await planCreate(input);
      if (found.state === 'store') verifyStorePins(found.context);
      return plan;
    },
    revision: plan => plan.revision,
    review: renderCreateReview,
    async apply(revision: string): Promise<AuthoringReceipt> {
      return withStoreForWrite(home, controller.signal, (context, held, created) => applyCreate(input, revision, held, { context, created }));
    },
  };
}
