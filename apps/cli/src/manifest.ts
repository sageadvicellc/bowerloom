/**
 * `bowerloom skills add <source> [--id <id>] [--team <team>]... [--replace] [--approve <revision>] [--json]` and
 * `bowerloom skills check [--json]` (build plan 01, M3).
 *
 * skills add checks the command line and the source pin, finds the project, checks the teams and the current
 * skills.json, and only then reads the network. The write runs through the approval wrapper, under the project lock.
 *
 * --replace moves an existing id to another version or commit of the same npm package or GitHub repository. Without
 * --team it keeps the entry's teams. A change of kind, package or repository, or a local entry, refuses with
 * SKILLS_ADD_SOURCE_CHANGED; an id skills.json does not hold refuses with SKILLS_ADD_REPLACE_MISSING.
 */
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, verifyProjectPins, withProjectLock } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { parseSkillSpec } from '../../../packages/skill-manifest/src/spec.js';
import type { SkillSpec } from '../../../packages/skill-manifest/src/spec.js';
import { isEntryId, isId, parseManifest } from '../../../packages/skill-manifest/src/schema.js';
import type { Entry, GitSource, NpmSource, PinnedContent } from '../../../packages/skill-manifest/src/schema.js';
import { applyManifestChange, planManifestChange, readManifestState, replaceTarget } from '../../../packages/skill-manifest/src/add.js';
import type { ManifestChange, ManifestChangePlan, ManifestChangeReceipt } from '../../../packages/skill-manifest/src/add.js';
import { checkManifest } from '../../../packages/skill-manifest/src/check.js';
import { createPublicTransport } from '../../../packages/skill-manifest/src/public-get.js';
import { resolveNpm } from '../../../packages/skill-manifest/src/resolve-npm.js';
import { resolveGit } from '../../../packages/skill-manifest/src/resolve-git.js';
import { manifestRefusal } from '../../../packages/skill-manifest/src/refusal.js';
import { runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, promptStopped } from './human.js';

const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const ADD_USAGE = 'Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id>, --team <team>, --replace, --approve <revision> and --json.';

export interface AddArgs { spec: string; id: string | null; teams: string[]; replace: boolean; approval: string[] }
/** Splits `skills add` words into the source, --id, --team, --replace, and the approval flags for the wrapper. */
export function parseAddArgs(words: readonly string[]): AddArgs {
  let spec: string | null = null, id: string | null = null, replace = false; const teams: string[] = [], approval: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--approve') { approval.push(word); if (i + 1 < words.length) approval.push(words[++i]!); }
    else if (word === '--json') approval.push(word);
    else if (word === '--replace') { if (replace) usage('Use --replace once.'); replace = true; }
    else if (word === '--id' || word === '--team') {
      const value = words[++i];
      if (value === undefined || value.startsWith('-') || !isId(value)) usage(`${word} takes a lower-case id, such as first-team.`);
      if (word === '--id') { if (id !== null || !isEntryId(value)) usage('Use --id once, with an id that is not personal-assistant and does not start with prompt-.'); id = value!; }
      else { if (teams.includes(value!) || teams.length >= 32) usage('Name each team once.'); teams.push(value!); }
    } else if (word.startsWith('-') || spec !== null) usage(ADD_USAGE);
    else spec = word;
  }
  if (spec === null) usage(ADD_USAGE);
  return { spec: spec!, id, teams, replace, approval };
}

const aborted = (error: unknown): boolean => error instanceof Error && (error.name === 'AbortError' || (error as { code?: unknown }).code === 'ABORT_ERR');
/**
 * A prompt on the terminal, when both stdin and stdout are terminals. Review finding 3: Ctrl-C or Ctrl-D closes
 * the prompt, and readline rejects with an AbortError. That is a stop (exit 130), never the generic failure.
 * The streams are parameters so a test can drive this very prompt.
 */
export function terminalIo(input: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin, output: NodeJS.WritableStream & { isTTY?: boolean } = process.stdout): ApprovalIo {
  return {
    interactive: input.isTTY === true && output.isTTY === true,
    async ask(question: string): Promise<string> {
      const rl = createInterface({ input, output });
      // The end of input closes the prompt without settling the question, so a close before an answer is a stop too.
      const closed = new Promise<never>((_, reject) => rl.once('close', () => reject(Object.assign(new Error('The prompt closed.'), { name: 'AbortError' }))));
      closed.catch(() => { /* Raced below. */ });
      try { return await Promise.race([rl.question(question), closed]); }
      catch (error) { if (aborted(error)) { output.write('\n'); throw promptStopped(); } throw error; }
      finally { rl.close(); }
    },
  };
}

function requireTeams(project: ProjectContext, teams: readonly string[]): void {
  for (const team of teams) {
    let ok = false;
    try { const s = lstatSync(join(project.dir, '.bowerloom', 'teams', team)); ok = s.isDirectory() && !s.isSymbolicLink(); } catch { ok = false; }
    if (!ok) throw manifestRefusal('TEAM_NOT_FOUND');
  }
}

type Pinned = Entry & PinnedContent<NpmSource | GitSource>;
const pinWords = (entry: Pinned): string => {
  const s = entry.source;
  return `${s.kind === 'npm' ? `npm ${s.package} ${s.version}` : `GitHub ${s.repository} at ${s.commit}`}, folder ${entry.skill.sourceRoot}`;
};
/** The plan in plain words. Values are checked ids, paths, hashes and pins; confirm.ts escapes control characters again. */
export function renderAddReview(plan: ManifestChangePlan): string {
  const replace = 'replace' in plan.change ? plan.change.replace : null;
  const entry = (replace ? replace.to : (plan.change as { add: Entry }).add) as Pinned;
  return [
    ...(replace
      ? [`Replace the pin of skill ${entry.id} in ${plan.manifest}`, `  Old pin: ${pinWords(replace.from as Pinned)}`, `  New pin: ${pinWords(entry)}`]
      : [`Add skill ${entry.id} to ${plan.manifest}`, `  Source: ${pinWords(entry)}`]),
    `  Skill name: ${entry.skill.name}`,
    `  License: ${entry.license.spdx} (${entry.license.files.join(', ')})`,
    `  Files: ${entry.files.length}`,
    `  Teams: ${entry.teams ? entry.teams.join(', ') : 'every team'}`,
    `  skills.json: ${plan.before === null ? 'a new file' : `replaces the file with sha256 ${plan.before.sha256}`}`,
    replace ? 'This records the new pin only. Nothing is installed or run. Run bowerloom skills sync to update the installed copies.' : 'This records the pin only. Nothing is installed or run.',
  ].join('\n');
}

/** The entry `spec` would replace, checked before the network: same id, same kind, same package or repository. */
function checkReplaceBeforeFetch(skills: readonly Entry[], id: string, spec: SkillSpec): void {
  const probe = { id, source: spec.kind === 'npm' ? { kind: 'npm', package: spec.package } : { kind: 'git', repository: spec.repository } } as Entry;
  const from = replaceTarget(skills, probe) as Pinned, s = from.source;
  const samePin = s.kind === 'npm' ? spec.kind === 'npm' && s.version === spec.version : spec.kind === 'github' && s.commit === spec.commit;
  if (samePin && from.skill.sourceRoot === spec.path) throw manifestRefusal('SKILLS_ADD_EXISTS');
}

async function resolveSpec(spec: SkillSpec, signal: AbortSignal): Promise<PinnedContent<NpmSource | GitSource>> {
  const transport = createPublicTransport();
  try { return spec.kind === 'npm' ? await resolveNpm(spec, transport, signal) : await resolveGit(spec, transport, signal); }
  finally { transport.close(); }
}

async function runAdd(words: readonly string[], cwd: string, home: string, io: ApprovalIo, write: (text: string) => void): Promise<number> {
  const args = parseAddArgs(words);
  const spec = parseSkillSpec(args.spec);
  const project = discoverProject(cwd, home);
  requireTeams(project, args.teams);
  const state = readManifestState(project.dir);
  const current = state.file !== null ? parseManifest(state.file.bytes).skills : [];
  if (args.replace) { if (args.id !== null) checkReplaceBeforeFetch(current, args.id, spec); else if (state.file === null) throw manifestRefusal('SKILLS_ADD_REPLACE_MISSING'); }
  else if (args.id !== null && current.some(s => s.id === args.id)) throw manifestRefusal('SKILLS_ADD_EXISTS');
  verifyProjectPins(project);

  const controller = new AbortController();
  let resolved: Promise<PinnedContent<NpmSource | GitSource>> | null = null;
  // Pins are immutable, so one read serves every plan of this run. A later run reads again; the revision binds the result.
  // A replace without --team keeps the teams of the entry as skills.json holds it now; the revision binds that file.
  const entry = async (): Promise<ManifestChange> => {
    resolved ??= resolveSpec(spec, controller.signal);
    const content = await resolved, id = args.id ?? content.skill.name;
    let teams: readonly string[] = args.teams;
    if (args.replace && !teams.length) { const now = readManifestState(project.dir); teams = (now.file ? parseManifest(now.file.bytes).skills.find(s => s.id === id)?.teams : undefined) ?? []; }
    const next = { id, ...(teams.length ? { teams: [...teams] } : {}), ...content } as Entry;
    return args.replace ? { replace: next } : { add: next };
  };
  const change: PlannedChange<ManifestChangePlan> = {
    async plan() { const add = await entry(); verifyProjectPins(project); return planManifestChange(project.dir, add); },
    revision: plan => plan.revision,
    review: renderAddReview,
    async apply(revision: string): Promise<ManifestChangeReceipt> {
      const add = await entry();
      return withProjectLock(project.dir, controller.signal, async held => {
        verifyProjectPins(project);
        const again = planManifestChange(project.dir, add);
        if (again.revision !== revision) throw manifestRefusal('STALE_APPROVAL');
        return applyManifestChange(again, revision, held);
      });
    },
  };
  return runApprovalCommand(args.approval, change, io, write);
}

function runCheck(words: readonly string[], cwd: string, home: string, write: (text: string) => void): number {
  if (words.length > 1 || words.some(w => w !== '--json')) usage('Use bowerloom skills check [--json].');
  const project = discoverProject(cwd, home);
  const check = checkManifest(project.dir);
  verifyProjectPins(project);
  if (words[0] === '--json') { write(newCommandJson(check)); return 0; }
  // Review freeze finding 10: the harness names every other command uses, and one column for the ids.
  const count = check.skills.length, width = Math.max(0, ...check.skills.map(s => s.id.length));
  const harness: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' };
  write([
    `skills.json is valid: ${count} ${count === 1 ? 'skill' : 'skills'}, for ${check.harnesses.map(h => harness[h] ?? h).join(' and ')}.`,
    ...check.skills.map(s => `  ${s.id.padEnd(width)}  ${s.kind} ${s.pin}${s.teams ? `  (teams: ${s.teams.join(', ')})` : ''}`),
    '',
  ].join('\n'));
  return 0;
}

/** Runs `skills add` or `skills check` and returns the exit code: 0 done, 3 approval required. A refusal throws. */
export async function runManifestCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo()): Promise<number> {
  const [, command, ...words] = args;
  if (command === 'check') return runCheck(words, cwd, home, write);
  if (command === 'add') return runAdd(words, cwd, home, io, write);
  return usage(ADD_USAGE);
}
