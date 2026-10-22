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
 *
 * With `--global` both commands work on the store, `~/.bowerloom`, from any folder (spec 04, 3.6 and 3.7). The write runs
 * inside `withStoreForWrite`, which makes the store when it is absent. The cache stays in the private state folder.
 *
 * After the approved write, skills add keeps the bytes it verified in the machine's skills cache, which the plan
 * names (Hanna, global skill cache). A seed that fails leaves the pin written and is reported, in words and in JSON.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, inspectStore, privateStateRoot, projectRefusal, storeRootOf, verifyProjectPins, verifyStorePins, withProjectLock, withStoreForWrite, STORE_CREATE_LINE } from '../../../packages/project-context/src/index.js';
import type { StoreContext } from '../../../packages/project-context/src/index.js';
import type { PlannedChange, ProjectContext } from '../../../packages/project-context/src/types.js';
import { parseSkillSpec } from '../../../packages/skill-manifest/src/spec.js';
import type { SkillSpec } from '../../../packages/skill-manifest/src/spec.js';
import { MANIFEST_LIMITS, STORE_MANIFEST_LIMITS, isEntryId, isId, parseManifest } from '../../../packages/skill-manifest/src/schema.js';
import type { Entry, GitSource, NpmSource, PinnedContent, PinnedEntry } from '../../../packages/skill-manifest/src/schema.js';
import { applyManifestChange, planManifestChange, readManifestState, replaceTarget, storeTarget } from '../../../packages/skill-manifest/src/add.js';
import type { ManifestChange, ManifestChangePlan, ManifestChangeReceipt } from '../../../packages/skill-manifest/src/add.js';
import { checkManifest } from '../../../packages/skill-manifest/src/check.js';
import { createPublicTransport } from '../../../packages/skill-manifest/src/public-get.js';
import { resolveNpmVerified } from '../../../packages/skill-manifest/src/resolve-npm.js';
import { resolveGitVerified } from '../../../packages/skill-manifest/src/resolve-git.js';
import type { VerifiedPin } from '../../../packages/skill-manifest/src/content.js';
import { seedPin } from '../../../packages/project-sync/src/seed.js';
import { cacheLayout, storeStateNested } from '../../../packages/project-sync/src/plan.js';
import { syncError } from '../../../packages/project-sync/src/refusal.js';
import { readAuthoringState } from '../../../packages/project-authoring/src/state.js';
import type { SeedResult } from '../../../packages/project-sync/src/seed.js';
import { manifestRefusal } from '../../../packages/skill-manifest/src/refusal.js';
import { configRefusal, readConfig, serializeConfig, writeGuardedFile } from '../../../packages/project-config/src/index.js';
import { createBowerloomFolder } from '../../../packages/project-config/src/folder.js';
import type { HeldProjectLock } from '../../../packages/project-context/src/types.js';
import { createHash } from 'node:crypto';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import type { ApprovalIo } from './confirm.js';
import { newCommandJson, plainText, promptStopped } from './human.js';

const usage = (message: string): never => { throw new DefinitionError('USAGE', message); };
const ADD_USAGE = 'Use bowerloom skills add npm:<package>@<version>:<path> or github:<owner>/<repo>@<40-character-commit>:<path>, with optional --id <id>, --team <team>, --replace, --global, --approve <revision> and --json.';

export interface AddArgs { spec: string; id: string | null; teams: string[]; replace: boolean; global: boolean; approval: string[] }
/** Splits `skills add` words into the source, --id, --team, --replace, --global, and the approval flags for the wrapper. */
export function parseAddArgs(words: readonly string[]): AddArgs {
  let spec: string | null = null, id: string | null = null, replace = false, global = false; const teams: string[] = [], approval: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === '--approve') { approval.push(word); if (i + 1 < words.length) approval.push(words[++i]!); }
    else if (word === '--json') approval.push(word);
    else if (word === '--replace') { if (replace) usage('Use --replace once.'); replace = true; }
    else if (word === '--global') { if (global) usage('Use --global once.'); global = true; }
    else if (word === '--id' || word === '--team') {
      const value = words[++i];
      if (value === undefined || value.startsWith('-') || !isId(value)) usage(`${word} takes a lower-case id, such as first-team.`);
      if (word === '--id') { if (id !== null || !isEntryId(value)) usage('Use --id once, with an id that is not personal-assistant and does not start with prompt- or slice-.'); id = value!; }
      else { if (teams.includes(value!) || teams.length >= 32) usage('Name each team once.'); teams.push(value!); }
    } else if (word.startsWith('-') || spec !== null) usage(ADD_USAGE);
    else spec = word;
  }
  if (spec === null) usage(ADD_USAGE);
  return { spec: spec!, id, teams, replace, global, approval };
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

/** Only a missing folder means "not found". Any other failure is an unreadable folder, not a missing team. */
const isNotFound = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException | null)?.code));
function requireTeams(project: ProjectContext, teams: readonly string[]): void {
  for (const team of teams) {
    let ok = false;
    try { const s = lstatSync(join(project.dir, '.bowerloom', 'teams', team)); ok = s.isDirectory() && !s.isSymbolicLink(); } catch (error) { if (!isNotFound(error)) throw projectRefusal('PROJECT_UNREADABLE'); }
    if (!ok) throw manifestRefusal('TEAM_NOT_FOUND');
  }
}

/** Teams of the store: a team the store's authoring record lists, whose folder `teams/<id>` is a real folder. */
function requireStoreTeams(store: StoreContext | null, teams: readonly string[]): void {
  if (!teams.length) return;
  if (store === null) throw manifestRefusal('TEAM_NOT_FOUND');
  const registered = readAuthoringState(store.dir).receipt?.value.items ?? [];
  for (const team of teams) {
    let ok = false;
    try { const s = lstatSync(join(store.dir, 'teams', team)); ok = s.isDirectory() && !s.isSymbolicLink() && registered.some(i => i.kind === 'team' && i.id === team); } catch (error) { if (!isNotFound(error)) throw projectRefusal('STORE_UNREADABLE'); }
    if (!ok) throw manifestRefusal('TEAM_NOT_FOUND');
  }
}
/**
 * Refuses STORE_STATE_NESTED when the private state folder and the store lie inside one another. It fails closed: a state
 * folder that cannot be checked (a link in its chain, for one) is refused, as STORE_STATE_NESTED when the deepest folder
 * of it that exists is inside the store, and as SKILLS_STATE_UNSAFE otherwise.
 */
function checkStateNesting(store: StoreContext | null, storeDir: string, stateRoot: string): void {
  let pins: ReturnType<typeof cacheLayout>['pins'];
  try { pins = cacheLayout(stateRoot).pins; }
  catch {
    let at = stateRoot;
    for (;;) {
      try { const real = realpathSync(at); if (real === storeDir || real.startsWith(`${storeDir}/`)) throw projectRefusal('STORE_STATE_NESTED'); break; }
      catch (error) { if ((error as { code?: unknown }).code === 'STORE_STATE_NESTED') throw error; if (dirname(at) === at) break; at = dirname(at); }
    }
    throw syncError('SKILLS_STATE_UNSAFE');
  }
  if (storeStateNested(store, storeDir, stateRoot, pins)) throw projectRefusal('STORE_STATE_NESTED');
}

type Pinned = Entry & PinnedContent<NpmSource | GitSource>;
const pinWords = (entry: Pinned): string => {
  const s = entry.source;
  return `${s.kind === 'npm' ? `npm ${s.package} ${s.version}` : `GitHub ${s.repository} at ${s.commit}`}, folder ${entry.skill.sourceRoot}`;
};
/** Shown before approval: this list is pre-approved in Claude Code while the skill is active. */
export const allowedToolsLine = (tools: string): string => `  Allowed tools: ${tools} (pre-approved in Claude Code while this skill is active)`;
/** The entry a `skills add` wrote. `skills add` never plans a removal, so a remove plan here is stale. */
function writtenEntry(change: ManifestChangePlan['change']): PinnedEntry {
  if ('remove' in change) throw manifestRefusal('STALE_APPROVAL');
  return ('replace' in change ? change.replace.to : change.add) as PinnedEntry;
}
/** The plan in plain words. Values are checked ids, paths, hashes and pins; confirm.ts escapes control characters again. */
export function renderAddReview(plan: ManifestChangePlan): string {
  // Spec 08, 12.2: a remove plan (receipt clean) has no pin to show.
  if ('remove' in plan.change) return `Remove skill ${plan.change.remove.id} from ${plan.manifest}`;
  const replace = 'replace' in plan.change ? plan.change.replace : null;
  const entry = (replace ? replace.to : (plan.change as { add: Entry }).add) as Pinned;
  return [
    ...(plan.storeCreate ? [STORE_CREATE_LINE] : []),
    ...((plan as { bowerloomFolder?: string }).bowerloomFolder === 'create' ? ['Create .bowerloom (records of the copies). Its contents are git-ignored.'] : []),
    ...(replace
      ? [`Replace the pin of skill ${entry.id} in ${plan.manifest}`, `  Old pin: ${pinWords(replace.from as Pinned)}`, `  New pin: ${pinWords(entry)}`]
      : [`Add skill ${entry.id} to ${plan.manifest}`, `  Source: ${pinWords(entry)}`]),
    `  Skill name: ${entry.skill.name}`,
    `  License: ${entry.license.spdx} (${entry.license.files.join(', ')})`,
    `  Files: ${entry.files.length}`,
    ...(entry.skill.allowedTools !== undefined ? [allowedToolsLine(entry.skill.allowedTools)] : []),
    `  Teams: ${entry.teams ? entry.teams.join(', ') : 'every team'}`,
    `  skills.json: ${plan.before === null ? 'a new file' : `replaces the file with sha256 ${plan.before.sha256}`}`,
    ...(plan.cache ? [`  Cache: ${plan.cache.root} keeps the bytes checked here, so skills sync need not fetch them again.`] : []),
    ...(plan.scope === 'store' ? ['  Scope: store. A project picks this skill with bowerloom use.'] : []),
    ...((plan as { config?: ConfigStep }).config ? [`bowerloom.json adds: skill ${entry.id} (project)`] : []),
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

async function resolveSpec(spec: SkillSpec, signal: AbortSignal): Promise<VerifiedPin<PinnedContent<NpmSource | GitSource>>> {
  const transport = createPublicTransport();
  try { return spec.kind === 'npm' ? await resolveNpmVerified(spec, transport, signal) : await resolveGitVerified(spec, transport, signal); }
  finally { transport.close(); }
}
/** What a seed did, in plain words, after `Applied plan`. */
export function seedWords(seed: SeedResult, global = false): string {
  if (seed.status === 'failed') return `Cache: the checked bytes were not kept in ${seed.root}${seed.codes.length ? ` (${seed.codes.join(', ')})` : ''}. The pin is recorded; ${global ? 'a project that selects this skill fetches it' : 'skills sync fetches it again'}.\n`;
  return seed.status === 'seeded' ? `Cache: kept the checked bytes in ${seed.root}.\n` : `Cache: ${seed.root} already held this pin.\n`;
}

async function runAdd(words: readonly string[], cwd: string, home: string, io: ApprovalIo, write: (text: string) => void, env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseAddArgs(words);
  const spec = parseSkillSpec(args.spec);
  if (args.global) return runAddGlobal(args, spec, home, io, write, env);
  let project = discoverProject(cwd, home);
  requireTeams(project, args.teams);
  const state = readManifestState(project.dir, { allowAbsent: project.configPresent && project.bowerloomIdentity === null });
  const current = state.file !== null ? parseManifest(state.file.bytes, MANIFEST_LIMITS).skills : [];
  if (args.replace) { if (args.id !== null) checkReplaceBeforeFetch(current, args.id, spec); else if (state.file === null) throw manifestRefusal('SKILLS_ADD_REPLACE_MISSING'); }
  else if (args.id !== null && current.some(s => s.id === args.id)) throw manifestRefusal('SKILLS_ADD_EXISTS');
  verifyProjectPins(project);
  const flags = parseApprovalFlags(args.approval); if (flags.rest.length) usage('This command takes only --approve <revision> and --json.');
  const stateRoot = privateStateRoot(env, home), cacheRoot = join(stateRoot, 'cache');

  const controller = new AbortController();
  let resolved: Promise<VerifiedPin<PinnedContent<NpmSource | GitSource>>> | null = null, seed: SeedResult | null = null;
  // Pins are immutable, so one read serves every plan of this run. A later run reads again; the revision binds the result.
  // A replace without --team keeps the teams of the entry as skills.json holds it now; the revision binds that file.
  const entry = async (): Promise<ManifestChange> => {
    resolved ??= resolveSpec(spec, controller.signal);
    const content = (await resolved).content, id = args.id ?? content.skill.name;
    let teams: readonly string[] = args.teams;
    if (args.replace && !teams.length) { const now = readManifestState(project.dir); teams = (now.file ? parseManifest(now.file.bytes, MANIFEST_LIMITS).skills.find(s => s.id === id)?.teams : undefined) ?? []; }
    const next = { id, ...(teams.length ? { teams: [...teams] } : {}), ...content } as Entry;
    return args.replace ? { replace: next } : { add: next };
  };
  const change: PlannedChange<ManifestChangePlan> = {
    async plan() { const add = await entry(); verifyProjectPins(project); return planProjectAdd(project, add, cacheRoot); },
    revision: plan => plan.revision,
    review: renderAddReview,
    async apply(revision: string): Promise<ManifestChangeReceipt & { cache: SeedResult }> {
      const add = await entry();
      const { receipt, written, project: after } = await withProjectLock(project.dir, controller.signal, async held => writeProjectAdd(project, add, cacheRoot, revision, held));
      project = after;
      // The pin is written. The seed only adds to the cache, outside the project lock, and reports a failure.
      seed = await seedPin({ project, stateRoot }, written, (await resolved!).bytes, controller.signal);
      return { ...receipt, cache: seed };
    },
  };
  const outcome = await runWithApproval(change, { ...(flags.approve !== undefined ? { approve: flags.approve } : {}), json: flags.json }, io);
  write(outcome.output + (outcome.exitCode === 0 && !flags.json && seed !== null ? plainText(seedWords(seed), true) : ''));
  return outcome.exitCode;
}

/** `skills add --global`: the same steps as `runAdd`, on the store. Nothing here reads a project. */
async function runAddGlobal(args: AddArgs, spec: SkillSpec, home: string, io: ApprovalIo, write: (text: string) => void, env: NodeJS.ProcessEnv): Promise<number> {
  const storeDir = storeRootOf(home), target = storeTarget(storeDir);
  const found = inspectStore(home);
  if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
  const context = found.state === 'store' ? found.context : null, storeCreate = found.state === 'absent';
  const stateRoot = privateStateRoot(env, home), cacheRoot = join(stateRoot, 'cache');
  checkStateNesting(context, storeDir, stateRoot);
  requireStoreTeams(context, args.teams);
  const state = readManifestState(target, { allowAbsent: true });
  const current = state.file !== null ? parseManifest(state.file.bytes, STORE_MANIFEST_LIMITS).skills : [];
  if (args.replace) { if (args.id !== null) checkReplaceBeforeFetch(current, args.id, spec); else if (state.file === null) throw manifestRefusal('SKILLS_ADD_REPLACE_MISSING'); }
  else if (args.id !== null && current.some(s => s.id === args.id)) throw manifestRefusal('SKILLS_ADD_EXISTS');
  if (context !== null) verifyStorePins(context);
  const flags = parseApprovalFlags(args.approval); if (flags.rest.length) usage('This command takes only --approve <revision> and --json.');

  const controller = new AbortController();
  let resolved: Promise<VerifiedPin<PinnedContent<NpmSource | GitSource>>> | null = null, seed: SeedResult | null = null;
  const entry = async (): Promise<ManifestChange> => {
    resolved ??= resolveSpec(spec, controller.signal);
    const content = (await resolved).content, id = args.id ?? content.skill.name;
    let teams: readonly string[] = args.teams;
    if (args.replace && !teams.length) { const now = readManifestState(target, { allowAbsent: true }); teams = (now.file ? parseManifest(now.file.bytes, STORE_MANIFEST_LIMITS).skills.find(s => s.id === id)?.teams : undefined) ?? []; }
    const next = { id, ...(teams.length ? { teams: [...teams] } : {}), ...content } as Entry;
    return args.replace ? { replace: next } : { add: next };
  };
  const change: PlannedChange<ManifestChangePlan> = {
    async plan() {
      const add = await entry();
      if (context !== null) verifyStorePins(context);
      const plan = planManifestChange(target, add, { cacheRoot, storeCreate });
      if (context !== null) verifyStorePins(context);
      return plan;
    },
    revision: plan => plan.revision,
    review: renderAddReview,
    async apply(revision: string): Promise<ManifestChangeReceipt & { cache: SeedResult }> {
      const add = await entry();
      let kept: StoreContext | null = null;
      const { receipt, written } = await withStoreForWrite(home, controller.signal, async (store, held, created) => {
        kept = store;
        verifyStorePins(store);
        checkStateNesting(store, store.dir, stateRoot);
        const again = planManifestChange(storeTarget(store.dir), add, { cacheRoot, storeCreate: created });
        if (again.revision !== revision) throw manifestRefusal('STALE_APPROVAL');
        return { receipt: applyManifestChange(again, revision, held), written: writtenEntry(again.change) };
      });
      // The pin is written. The seed only adds to the cache, outside the store lock, and reports a failure.
      seed = await seedPin({ project: null, stateRoot, store: kept }, written, (await resolved!).bytes, controller.signal);
      return { ...receipt, cache: seed };
    },
  };
  const outcome = await runWithApproval(change, { ...(flags.approve !== undefined ? { approve: flags.approve } : {}), json: flags.json }, io);
  write(outcome.output + (outcome.exitCode === 0 && !flags.json && seed !== null ? plainText(seedWords(seed, true), true) : ''));
  return outcome.exitCode;
}

function runCheck(words: readonly string[], cwd: string, home: string, write: (text: string) => void): number {
  const USAGE = 'Use bowerloom skills check [--global] [--json].';
  if (words.filter(w => w === '--global').length > 1) usage('Use --global once.');
  const global = words.includes('--global'), rest = words.filter(w => w !== '--global');
  if (rest.length > 1 || rest.some(w => w !== '--json')) usage(USAGE);
  const json = rest[0] === '--json';
  let check: ReturnType<typeof checkManifest>;
  if (global) {
    const found = inspectStore(home);
    if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
    if (found.state === 'absent') throw manifestRefusal('MANIFEST_NOT_FOUND');
    verifyStorePins(found.context);
    check = checkManifest(storeTarget(found.context.dir));
    verifyStorePins(found.context);
  } else {
    const project = discoverProject(cwd, home);
    if (project.configPresent) return checkConfigMode(project, home, json, write);
    check = checkManifest(project.dir);
    verifyProjectPins(project);
  }
  if (json) { write(newCommandJson(check)); return 0; }
  // Review freeze finding 10: the harness names every other command uses, and one column for the ids.
  const count = check.skills.length, width = Math.max(0, ...check.skills.map(s => s.id.length));
  const harness: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' };
  write([
    `skills.json${global ? ' (store)' : ''} is valid: ${count} ${count === 1 ? 'skill' : 'skills'}, for ${check.harnesses.map(h => harness[h] ?? h).join(' and ')}.`,
    ...check.skills.map(s => `  ${s.id.padEnd(width)}  ${s.kind} ${s.pin}${s.teams ? `  (teams: ${s.teams.join(', ')})` : ''}`),
    '',
  ].join('\n'));
  return 0;
}

/**
 * `skills check` in a project with bowerloom.json (spec 06, 3.20): the project skills.json, if any, and the pinned store
 * entries the config selects, offline. Each row ends with its source tag. No skills.json and no store pin is 0 skills.
 */
function checkConfigMode(project: ProjectContext, home: string, json: boolean, write: (text: string) => void): number {
  const read = readConfig(project);
  if (read.state !== 'valid') throw configRefusal(read.state === 'invalid' ? read.code : 'CONFIG_INVALID');
  const state = readManifestState(project.dir, { allowAbsent: true });
  const own = state.file ? checkManifest(project.dir) : null;
  const rows = (own?.skills ?? []).map(s => ({ ...s, source: 'project' }));
  const storeIds = read.config.skills.filter(e => e.source === 'store').map(e => e.id);
  if (storeIds.length) {
    const found = inspectStore(home);
    if (found.state === 'foreign') throw projectRefusal('STORE_INVALID');
    if (found.state === 'store') {
      verifyStorePins(found.context);
      const store = checkManifest(storeTarget(found.context.dir));
      verifyStorePins(found.context);
      rows.push(...store.skills.filter(s => storeIds.includes(s.id) && s.kind !== 'local').map(s => ({ ...s, source: 'store' })));
    }
  }
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  const harnesses = [...read.config.harnesses];
  const check = { format: own?.format ?? 'bowerloom/skills-manifest-check/v1beta2', valid: true, harnesses, skills: rows };
  if (json) { write(newCommandJson(check)); return 0; }
  const width = Math.max(0, ...rows.map(s => s.id.length)), harness: Readonly<Record<string, string>> = { claude: 'Claude Code', codex: 'Codex' };
  write([
    rows.length ? `skills.json is valid: ${rows.length} ${rows.length === 1 ? 'skill' : 'skills'}, for ${harnesses.map(h => harness[h] ?? h).join(' and ')}.` : 'skills.json is valid: 0 skills',
    ...rows.map(s => `  ${s.id.padEnd(width)}  ${s.kind} ${s.pin}${s.teams ? `  (teams: ${s.teams.join(', ')})` : ''}  [${s.source}]`), '',
  ].join('\n'));
  return 0;
}

interface ConfigStep { before: { sha256: string; bytes: number }; after: { sha256: string; bytes: number }; text: string }
const sha256Hex = (v: string): string => createHash('sha256').update(v).digest('hex');
/** The config step of `skills add` (3.8 item 9): `{ id, source: "project" }`, with the duplicate and limit refusals. Null when already listed. */
function configAddStep(project: ProjectContext, id: string): ConfigStep | null {
  const read = readConfig(project);
  if (read.state !== 'valid') throw configRefusal(read.state === 'invalid' ? read.code : 'CONFIG_INVALID');
  const now = read.config.skills.find(e => e.id === id);
  if (now?.source === 'store') throw configRefusal('CONFIG_DUPLICATE_ID', `bowerloom.json lists skill ${id} twice: once from store and once from project.`);
  if (now) return null;
  const text = serializeConfig({ ...read.config, skills: [...read.config.skills, { id, source: 'project' as const }].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))) });
  return { before: { sha256: read.sha256, bytes: read.bytes }, after: { sha256: sha256Hex(text), bytes: Buffer.byteLength(text) }, text };
}

/** A project `skills add` plan: the skills.json change and, in a project with bowerloom.json, the config entry and a missing `.bowerloom` (3.8 rule 9). */
export type ProjectAddPlan = ManifestChangePlan & { config?: ConfigStep; bowerloomFolder: 'present' | 'create' };
export function planProjectAdd(project: ProjectContext, change: ManifestChange, cacheRoot: string): ProjectAddPlan {
  const create = project.configPresent && project.bowerloomIdentity === null;
  const inner = planManifestChange(project.dir, change, { cacheRoot, ...(create ? { allowAbsentFolder: true } : {}) });
  const folder = { bowerloomFolder: create ? 'create' as const : 'present' as const };
  if (!project.configPresent || !('add' in inner.change)) return { ...inner, ...folder };
  const config = configAddStep(project, inner.change.add.id);
  return config === null ? { ...inner, ...folder } : { ...inner, ...folder, config, revision: sha256Hex(`${inner.revision}\n${config.after.sha256}\n${folder.bowerloomFolder}`) };
}
/**
 * Writes an approved project `skills add` under the held project lock: `.bowerloom` first when the plan creates it (its
 * creation adopts the folder as the project marker), then skills.json, then bowerloom.json. Returns the context to use after.
 */
export function writeProjectAdd(project: ProjectContext, change: ManifestChange, cacheRoot: string, revision: string, held: HeldProjectLock): { receipt: ManifestChangeReceipt; written: PinnedEntry; project: ProjectContext } {
  verifyProjectPins(project);
  const again = planProjectAdd(project, change, cacheRoot);
  if (again.revision !== revision) throw manifestRefusal('STALE_APPROVAL');
  let context = project;
  if (again.bowerloomFolder === 'create') context = createBowerloomFolder(project, held);
  const inner = planManifestChange(project.dir, change, { cacheRoot });
  if (inner.after.sha256 !== again.after.sha256 || (inner.before?.sha256 ?? null) !== (again.before?.sha256 ?? null)) throw manifestRefusal('STALE_APPROVAL');
  const receipt = applyManifestChange(inner, inner.revision, held);
  if (again.config) writeGuardedFile(project.dir, 'bowerloom.json', again.config.text, again.config.before.sha256, held, '.bowerloom.json');
  return { receipt, written: writtenEntry(inner.change), project: context };
}

/** Runs `skills add` or `skills check` and returns the exit code: 0 done, 3 approval required. A refusal throws. */
export async function runManifestCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [, command, ...words] = args;
  if (command === 'check') return runCheck(words, cwd, home, write);
  if (command === 'add') return runAdd(words, cwd, home, io, write, env);
  return usage(ADD_USAGE);
}
