/**
 * `bowerloom skills add <source> [--id <id>] [--team <team>]... [--approve <revision>] [--json]` and
 * `bowerloom skills check [--json]` (build plan 01, M3).
 *
 * skills add checks the command line and the source pin, finds the project, checks the teams and the current
 * skills.json, and only then reads the network. The write runs through the approval wrapper, under the project lock.
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
import { applyManifestChange, planManifestChange, readManifestState } from '../../../packages/skill-manifest/src/add.js';
import type { ManifestChangePlan, ManifestChangeReceipt } from '../../../packages/skill-manifest/src/add.js';
import { checkManifest } from '../../../packages/skill-manifest/src/check.js';
import { createPublicTransport } from '../../../packages/skill-manifest/src/public-get.js';
import { resolveNpm } from '../../../packages/skill-manifest/src/resolve-npm.js';
import { resolveGit } from '../../../packages/skill-manifest/src/resolve-git.js';
import { manifestRefusal } from '../../../packages/skill-manifest/src/refusal.js';
import { runApprovalCommand } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson } from './human.js';

const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const ADD_USAGE = 'Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id>, --team <team>, --approve <revision> and --json.';

export interface AddArgs { spec: string; id: string | null; teams: string[]; approval: string[] }
/** Splits `skills add` words into the source, --id, --team, and the approval flags for the wrapper. */
export function parseAddArgs(words: readonly string[]): AddArgs {
  let spec: string | null = null, id: string | null = null; const teams: string[] = [], approval: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--approve') { approval.push(word); if (i + 1 < words.length) approval.push(words[++i]!); }
    else if (word === '--json') approval.push(word);
    else if (word === '--id' || word === '--team') {
      const value = words[++i];
      if (value === undefined || value.startsWith('-') || !isId(value)) usage(`${word} takes a lower-case id, such as first-team.`);
      if (word === '--id') { if (id !== null || !isEntryId(value)) usage('Use --id once, with an id that is not personal-assistant and does not start with prompt-.'); id = value!; }
      else { if (teams.includes(value!) || teams.length >= 32) usage('Name each team once.'); teams.push(value!); }
    } else if (word.startsWith('-') || spec !== null) usage(ADD_USAGE);
    else spec = word;
  }
  if (spec === null) usage(ADD_USAGE);
  return { spec: spec!, id, teams, approval };
}

/** A prompt on the terminal, when both stdin and stdout are terminals. */
export function terminalIo(): ApprovalIo {
  return {
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    async ask(question: string): Promise<string> { const rl = createInterface({ input: process.stdin, output: process.stdout }); try { return await rl.question(question); } finally { rl.close(); } },
  };
}

function requireTeams(project: ProjectContext, teams: readonly string[]): void {
  for (const team of teams) {
    let ok = false;
    try { const s = lstatSync(join(project.dir, '.bowerloom', 'teams', team)); ok = s.isDirectory() && !s.isSymbolicLink(); } catch { ok = false; }
    if (!ok) throw manifestRefusal('TEAM_NOT_FOUND');
  }
}

/** The plan in plain words. Values are checked ids, paths, hashes and pins; confirm.ts escapes control characters again. */
export function renderAddReview(plan: ManifestChangePlan): string {
  const entry = plan.change.add as Entry & PinnedContent<NpmSource | GitSource>, s = entry.source;
  const source = s.kind === 'npm' ? `npm ${s.package} ${s.version}` : `GitHub ${s.repository} at ${s.commit}`;
  return [
    `Add skill ${entry.id} to ${plan.manifest}`,
    `  Source: ${source}, folder ${entry.skill.sourceRoot}`,
    `  Skill name: ${entry.skill.name}`,
    `  License: ${entry.license.spdx} (${entry.license.files.join(', ')})`,
    `  Files: ${entry.files.length}`,
    `  Teams: ${entry.teams ? entry.teams.join(', ') : 'every team'}`,
    `  skills.json: ${plan.before === null ? 'a new file' : `replaces the file with sha256 ${plan.before.sha256}`}`,
    'This records the pin only. Nothing is installed or run.',
  ].join('\n');
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
  if (state.file !== null && args.id !== null) { const current = parseManifest(state.file.bytes); if (current.skills.some(s => s.id === args.id)) throw manifestRefusal('SKILLS_ADD_EXISTS'); }
  else if (state.file !== null) parseManifest(state.file.bytes);
  verifyProjectPins(project);

  const controller = new AbortController();
  let resolved: Promise<PinnedContent<NpmSource | GitSource>> | null = null;
  // Pins are immutable, so one read serves every plan of this run. A later run reads again; the revision binds the result.
  const entry = async (): Promise<Entry> => {
    resolved ??= resolveSpec(spec, controller.signal);
    const content = await resolved;
    return { id: args.id ?? content.skill.name, ...(args.teams.length ? { teams: [...args.teams] } : {}), ...content } as Entry;
  };
  const change: PlannedChange<ManifestChangePlan> = {
    async plan() { const add = await entry(); verifyProjectPins(project); return planManifestChange(project.dir, { add }); },
    revision: plan => plan.revision,
    review: renderAddReview,
    async apply(revision: string): Promise<ManifestChangeReceipt> {
      const add = await entry();
      return withProjectLock(project.dir, controller.signal, async held => {
        verifyProjectPins(project);
        const again = planManifestChange(project.dir, { add });
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
  const count = check.skills.length;
  write([
    `skills.json is valid: ${count} ${count === 1 ? 'skill' : 'skills'}, for ${check.harnesses.join(' and ')}.`,
    ...check.skills.map(s => `  ${s.id}  ${s.kind} ${s.pin}${s.teams ? `  (teams: ${s.teams.join(', ')})` : ''}`),
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
