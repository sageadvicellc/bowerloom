import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { AdapterError, strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { inspectStore, projectRefusal, storeRootOf, verifyStorePins, STORE_CREATE_LINE } from '../../../packages/project-context/src/index.js';
import type { StoreContext } from '../../../packages/project-context/src/index.js';
import { newCommandJson, plainText } from './human.js';
import { readStoreRepo, storeFoldersCheck } from '../../../packages/project-config/src/git.js';
import type { FoldersCheck } from '../../../packages/project-config/src/git.js';
import { storeGitignoreStatus } from '../../../packages/project-context/src/store-gitignore.js';
import type { StoreGitignoreStatus } from '../../../packages/project-context/src/store-gitignore.js';
import type { StoreRepo } from '../../../packages/project-config/src/git.js';
import { NOT_SHAREABLE } from '../../../packages/project-config/src/refusal.js';
import { GithubToken } from '../../../packages/skill-manifest/src/github-token.js';
import type { ApprovalIo } from './confirm.js';
import { parseApprovalFlags, runWithApproval } from './confirm.js';
import { terminalIo } from './manifest.js';
import { discoverProject } from '../../../packages/project-context/src/index.js';
import type { PlannedChange } from '../../../packages/project-context/src/types.js';
import { applyStoreMigrate, checkMigrateSelectors, migrateIsNoop, planStoreMigrate } from '../../../packages/project-sync/src/index.js';
import type { StoreMigratePlan, StoreMigrateResult } from '../../../packages/project-sync/src/index.js';
import { STALE_NOTE } from '../../../packages/project-sync/src/resolve.js';
import { githubTokenReader } from './sync.js';
import { proofStaleNote, tokenNotes } from './use.js';
import { itemLabel } from './receipt.js';

const STORE_STATUS_FORMAT = 'bowerloom/store-status/v1beta1';
const USAGE = 'Use bowerloom store status [--json] or bowerloom store migrate. See bowerloom help store.';
const MIGRATE_USAGE = 'Use bowerloom store migrate [--skill <id>]... [--prompt <id>]... [--team <id>]... [--all], with optional --commit <sha>, --approve <revision> and --json.';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEFTOVER_TEMP = /^\.store\.json\.[a-f0-9]{16}\.tmp$/;
const NAME_LIMIT = 256;
const SKILLS_JSON_LIMIT = 4 * 1024 * 1024;

type State = 'absent' | 'store' | 'foreign' | 'refused';
type Problem = 'unsafe' | 'too-large' | 'invalid' | 'unreadable';
/** A count of names. `capped` is true when there were more than 256. `ignored` counts what the count skipped. */
interface Count { n: number; capped: boolean; ignored: number }
interface Pinned { count: number | null; problem: Problem | null }
interface Counts { skillFolders: Count; pinnedSkills: Pinned; prompts: Count; teams: Count }
interface Report { state: State; path: string; code: string | null; message: string | null; counts: Counts | null; leftovers: string[]; git: StoreRepo | null; folders?: FoldersCheck; gitignore?: StoreGitignoreStatus }

const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;
const storeCode = (error: unknown): string | null => { const code = errno(error); return typeof code === 'string' && code.startsWith('STORE_') ? code : null; };

/**
 * Counts the names in `<store>/<folder>` that are plain ids: folders for skills and teams, `<id>.md` files for prompts. An
 * entry for the folder that is a link or not a folder refuses STORE_UNSAFE. Inside it, a link, a stray file, and a name that
 * does not match are not counted; they are counted as ignored, and the status says so.
 */
function countNames(store: StoreContext, folder: 'skills' | 'prompts' | 'teams'): Count {
  const path = join(store.dir, folder);
  try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) throw projectRefusal('STORE_UNSAFE'); }
  catch (error) { if (storeCode(error) !== null) throw error; if (errno(error) === 'ENOENT') return { n: 0, capped: false, ignored: 0 }; throw projectRefusal('STORE_UNREADABLE'); }
  let entries: Dirent[];
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { throw projectRefusal('STORE_UNREADABLE'); }
  let n = 0, ignored = 0;
  for (const entry of entries) {
    const plain = !entry.isSymbolicLink() && (folder === 'prompts' ? entry.isFile() && entry.name.endsWith('.md') && ID.test(entry.name.slice(0, -3)) : entry.isDirectory() && ID.test(entry.name));
    if (plain) n++; else ignored++;
  }
  return n > NAME_LIMIT ? { n: NAME_LIMIT, capped: true, ignored } : { n, capped: false, ignored };
}

/** The number of npm and git entries in the store's skills.json, read as a plain file of at most 4 MiB. A missing file counts 0. Otherwise the problem says why it could not be counted. */
function pinnedSkills(store: StoreContext): Pinned {
  const file = join(store.dir, 'skills.json'), no = (problem: Problem): Pinned => ({ count: null, problem });
  let before;
  try { before = lstatSync(file, { bigint: true }); } catch (error) { return errno(error) === 'ENOENT' ? { count: 0, problem: null } : no('unreadable'); }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || Number(before.uid) !== process.getuid!() || (Number(before.mode) & 0o022) !== 0) return no('unsafe');
  if (before.size > BigInt(SKILLS_JSON_LIMIT)) return no('too-large');
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); } catch (error) { return no(errno(error) === 'ELOOP' ? 'unsafe' : 'unreadable'); }
  let bytes: Buffer;
  try {
    const open = fstatSync(fd, { bigint: true });
    if (open.dev !== before.dev || open.ino !== before.ino) return no('unsafe');
    const buffer = Buffer.alloc(SKILLS_JSON_LIMIT + 1);
    let length = 0;
    for (;;) { const got = readSync(fd, buffer, length, buffer.length - length, null); if (got === 0 || (length += got) === buffer.length) break; }
    if (length > SKILLS_JSON_LIMIT) return no('too-large');
    bytes = buffer.subarray(0, length);
  } catch { return no('unreadable'); } finally { closeSync(fd); }
  let value: unknown;
  try { value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), SKILLS_JSON_LIMIT); } catch (error) { if (error instanceof TypeError || error instanceof AdapterError) return no('invalid'); throw error; }
  const skills = (value as { skills?: unknown } | null)?.skills;
  if (value === null || typeof value !== 'object' || !Array.isArray(skills)) return no('invalid');
  return { count: skills.filter(entry => { const kind = (entry as { source?: { kind?: unknown } } | null)?.source?.kind; return kind === 'npm' || kind === 'git'; }).length, problem: null };
}

function report(home: string): Report {
  let path: string;
  try { path = storeRootOf(home); } catch (error) {
    const code = storeCode(error);
    if (code === null) throw error;
    return { state: 'refused', path: join(resolve(home), '.bowerloom'), code, message: (error as Error).message, counts: null, leftovers: [], git: null };
  }
  const leftoversIn = (dir: string): string[] => {
    try { return readdirSync(dir).filter(name => LEFTOVER_TEMP.test(name)).sort(); } catch { throw projectRefusal('STORE_UNREADABLE'); }
  };
  try {
    const found = inspectStore(home);
    if (found.state === 'absent') return { state: 'absent', path, code: null, message: null, counts: null, leftovers: found.leftover ? leftoversIn(path) : [], git: null };
    if (found.state === 'foreign') return { state: 'foreign', path, code: null, message: null, counts: null, leftovers: [], git: null };
    const store = found.context;
    const counts: Counts = { skillFolders: countNames(store, 'skills'), pinnedSkills: pinnedSkills(store), prompts: countNames(store, 'prompts'), teams: countNames(store, 'teams') };
    const leftovers = leftoversIn(store.dir);
    // Spec 06, 3.21: the git repository of the store, read from files only.
    const git = readStoreRepo(store.dir, null);
    // Fix 3 of the beta.3 docs review: folder records that git already tracks are published by the next push, and an older
    // store's .gitignore may not leave them out yet (round 2 of PR 100, H1 and L1).
    const folders = storeFoldersCheck(store.dir), gitignore = storeGitignoreStatus(store.dir);
    verifyStorePins(store);
    return { state: 'store', path, code: null, message: null, counts, leftovers, git, folders, gitignore };
  } catch (error) {
    const code = storeCode(error);
    if (code !== null) return { state: 'refused', path, code, message: (error as Error).message, counts: null, leftovers: [], git: null };
    throw error;
  }
}

/** Spec 07, 3.6: whether BOWERLOOM_GITHUB_TOKEN is set, as store status says it. Never the value or its length. */
type TokenState = 'set' | 'not-set' | 'invalid';
const TOKEN_LINE: Readonly<Record<TokenState, string>> = {
  set: '  GitHub token: BOWERLOOM_GITHUB_TOKEN is set',
  'not-set': '  GitHub token: BOWERLOOM_GITHUB_TOKEN is not set',
  invalid: '  GitHub token: BOWERLOOM_GITHUB_TOKEN is set but is not a valid token',
};
function render(r: Report, token: TokenState): string {
  const leftover = r.leftovers.map(name => `  Leftover: ${name} (the next --global write removes it)`);
  if (r.state === 'absent') return ['Store: none yet', '  Create one with bowerloom skill create <name> --global.', ...leftover, ''].join('\n');
  if (r.state === 'foreign') return `Store: not a store\n  ${plainText(r.path)} exists, but it has no store.json. Bowerloom will not use it.\n  Move it somewhere else first. Then run bowerloom skill create <name> --global.\n`;
  if (r.state === 'refused') return `Store: refused (${plainText(r.code ?? '')})\n  ${plainText(r.message ?? '')}\n`;
  const c = r.counts!;
  const show = (count: Count): string => `${count.capped ? `${count.n} or more` : String(count.n)}${count.ignored > 0 ? ` (${count.ignored} ${count.ignored === 1 ? 'entry' : 'entries'} ignored)` : ''}`;
  const pinned = c.pinnedSkills.count === null ? `unreadable (${c.pinnedSkills.problem})` : String(c.pinnedSkills.count);
  return [
    'Store: ready', `  Path: ${plainText(r.path)}`, `  Skill folders: ${show(c.skillFolders)}`,
    `  Pinned skills: ${pinned}`, `  Prompts: ${show(c.prompts)}`, `  Teams: ${show(c.teams)}`, ...gitLines(r.git!, token, r.gitignore!), ...folderLines(r.folders!), ...leftover, '',
  ].join('\n');
}
/** Fix 3 of the beta.3 docs review, and round 2 of PR 100 (M4, L1, L3): what the check of folders/ found, in words. */
function folderLines(folders: FoldersCheck): string[] {
  if (folders.tracked === true) return ['  Warning: folders/ is tracked by git. In ~/.bowerloom, run git rm -r --cached folders and commit. Records already pushed stay in git history.'];
  if (folders.check === 'unreadable') return ["  Warning: Bowerloom could not read the store's git index, so it cannot tell whether folders/ is tracked. Run git -C ~/.bowerloom ls-files folders."];
  if (folders.check === 'outer-repository') return ['  Warning: ~/.bowerloom is inside another git repository, so Bowerloom cannot tell whether folders/ is tracked. Run git -C ~/.bowerloom ls-files folders.'];
  return [];
}
const shellQuote = (line: string): string => `'${line.replaceAll("'", "'\\''")}'`;
/** The command that adds the missing .gitignore lines, run in ~/.bowerloom. An empty first word ends a last line that has no line break. */
const gitignoreStep = (g: StoreGitignoreStatus): string => `printf '%s\\n' ${[...(g.endsWithNewline ? [] : ['']), ...g.missing].map(shellQuote).join(' ')} >> .gitignore`;
/**
 * Round 3 of the reviews of PR 100, L1: the printed steps leave folders/ out by themselves, so a .gitignore that is missing,
 * a link, or shared never lets the records into a commit. `git add -A` is followed by `git rm --cached` of folders, which
 * exits 0 whether or not folders/ was added. An exclude pathspec does not serve: git 2.39 exits 1 when the path it
 * excludes is also ignored, and that stops a pasted chain of commands.
 */
const ADD_ALL = ['git add -A', 'git rm -r -q --cached --ignore-unmatch folders'];
const UNSAFE_GITIGNORE = '~/.bowerloom/.gitignore is a link, or not a plain file that you own, so Bowerloom cannot check its lines.';
/** The commands that fix a git problem of the store (3.21). The person runs them; Bowerloom never runs git. */
const FIX: Readonly<Record<string, (branch: string) => string[]>> = {
  none: b => ['cd ~/.bowerloom', 'git init', ...ADD_ALL, 'git commit -m "Store"', 'git remote add origin https://github.com/<owner>/<repo>.git', `git push -u origin ${b}`],
  'no-origin': b => ['cd ~/.bowerloom', 'git remote add origin https://github.com/<owner>/<repo>.git', `git push -u origin ${b}`],
  'unsupported-remote': () => ['cd ~/.bowerloom', 'git remote set-url origin https://github.com/<owner>/<repo>.git'],
  unpushed: b => ['cd ~/.bowerloom', `git push -u origin ${b}`],
  unreadable: () => [],
};
function gitLines(git: StoreRepo, token: TokenState, gitignore: StoreGitignoreStatus): string[] {
  const out: string[] = [], missing = gitignore.state === 'create' || gitignore.state === 'update';
  // Spec 07, 3.6: the token line follows the Git: line of a store with a git remote.
  const tokenLine = git.remote !== null ? [TOKEN_LINE[token]] : [];
  if (git.problem === null) out.push(`  Git: origin ${git.remote!.slice('https://'.length)}, branch ${git.branch ?? '<branch>'}, HEAD ${git.head?.slice(0, 8) ?? 'unknown'}, pushed ${git.pushed!.slice(0, 8)}`, ...tokenLine);
  else {
    out.push(git.problem === 'none' ? '  Git: none' : `  Git: ${NOT_SHAREABLE[git.problem]}`, ...tokenLine);
    const commands = FIX[git.problem]!(git.branch ?? '<branch>');
    // Round 2 of PR 100, H1: the .gitignore lines go in first, so the git add -A below never takes folders/.
    if (commands.length && missing) commands.splice(1, 0, gitignoreStep(gitignore));
    // Round 3, L1: a .gitignore Bowerloom cannot use is named first, so the person fixes it before the commands.
    if (commands.length && gitignore.state === 'unsafe') out.push(`  Fix ${UNSAFE_GITIGNORE.replace(' is a link', ' first: it is a link')}`);
    if (commands.length) out.push('  To fix this, run these commands yourself:', ...commands.map(c => `    ${c}`));
  }
  if (missing) {
    out.push("  Warning: ~/.bowerloom/.gitignore misses lines that keep this machine's files, folders/ among them, out of git.");
    if (!out.some(l => l.startsWith('    printf '))) out.push('  To add them, run these commands yourself:', '    cd ~/.bowerloom', `    ${gitignoreStep(gitignore)}`);
  }
  if (gitignore.state === 'unsafe' && !out.some(l => l.startsWith('  Fix ~/.bowerloom/.gitignore first'))) out.push(`  Warning: ${UNSAFE_GITIGNORE}`);
  out.push('  A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.');
  return out;
}

/**
 * `bowerloom store status [--json]`. Reads only. Every STORE_* refusal is reported as state `refused` and exits 0; USAGE
 * passes through. `home` is the HOME folder, and the store is always `<home>/.bowerloom`.
 */
export async function runStoreCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => unknown, io: ApprovalIo = terminalIo(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const words = args.slice(1);
  if (words[0] === 'migrate') return runMigrate(words.slice(1), cwd, home, write, io, env);
  if (words[0] !== 'status' || words.length > 2 || (words.length === 2 && words[1] !== '--json')) throw new DefinitionError('USAGE', USAGE);
  const r = report(home), token = GithubToken.status(env);
  if (words[1] === '--json') {
    const c = r.counts;
    const counts = c === null ? null : {
      skillFolders: c.skillFolders.n, pinnedSkills: c.pinnedSkills.count, pinnedSkillsProblem: c.pinnedSkills.problem, prompts: c.prompts.n, teams: c.teams.n,
      ignored: { skillFolders: c.skillFolders.ignored, prompts: c.prompts.ignored, teams: c.teams.ignored },
      capped: { skillFolders: c.skillFolders.capped, prompts: c.prompts.capped, teams: c.teams.capped },
    };
    const g = r.git, git = r.state !== 'store' || g === null ? null : { present: g.problem !== 'none', problem: g.problem, remote: g.remote, branch: g.branch, head: g.head, pushed: g.pushed, ahead: g.head !== null && g.pushed !== null ? (g.head === g.pushed ? 'no' : 'yes') : 'unknown', token, foldersTracked: r.folders?.tracked ?? null, foldersCheck: r.folders?.check ?? null, gitignore: r.gitignore?.state ?? null };
    write(newCommandJson({ format: STORE_STATUS_FORMAT, state: r.state, path: r.path, code: r.code, counts, leftoverTemps: r.leftovers.length, git }));
  } else write(render(r, token));
  return 0;
}
// --- Spec 08: store migrate. ---

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const isAgentFile = (item: StoreMigratePlan['items'][number]): boolean => item.kind === 'team' && item.files.some(f => f.path.startsWith(`teams/${item.id}/agents/`));
/** The block printed after the plan and after the result: the git rm lines. None when no item switched. */
function removeBlock(lines: readonly string[]): string[] {
  if (!lines.length) return [];
  return ['Nothing in this project is deleted. When you have checked the result, you can remove the old copies yourself:', ...lines, 'After you delete the old files, run bowerloom receipt clean.'];
}
/** The line of one item (3.1, plan lines). */
function itemLine(item: StoreMigratePlan['items'][number]): string {
  const head = itemLabel(item.kind, item.id);
  if (item.state === 'present') return `${head}already in the store with the same bytes`;
  // Review C1: an item the store records already, whose skills.json entry is missing, only gets the entry.
  if (item.state === 'register') return item.recorded ? `${head}already in the store. This run adds its skills.json entry.` : `${head}already in the store, not yet recorded. This run records it.`;
  if (item.how === 'pinned') {
    const s = item.entry!.source as { kind: string; package?: string; version?: string; repository?: string; commit?: string };
    return `${head}pin copied to ~/.bowerloom/skills.json (${s.kind === 'npm' ? `npm ${s.package}@${s.version}` : `GitHub ${s.repository}@${s.commit!.slice(0, 8)}`})`;
  }
  if (item.kind === 'prompt') return `${head}copy of .bowerloom/prompts/${item.id}.md`;
  return `${head}copy of .bowerloom/${item.kind}s/${item.id} (${plural(item.files.length, 'file')})`;
}
/** The plan in plain words (3.1). */
export function renderStoreMigrate(plan: StoreMigratePlan): string {
  const moving = plan.items.filter(i => i.state !== 'present' || i.switch);
  const lines = [`Move ${plural(moving.length, 'item')} from this project to the store at ~/.bowerloom`];
  const writes = !migrateIsNoop(plan);
  if (plan.store.create && writes) lines.push(STORE_CREATE_LINE);
  for (const item of plan.items) lines.push(itemLine(item));
  for (const s of plan.skipped) lines.push(`${itemLabel(s.kind, s.id)}${s.line}`);
  for (const item of plan.items) if (item.switch && isAgentFile(item)) lines.push(`${itemLabel('team', item.id)}its agents stop being projected. A store team projects no agents in this beta. Copies in .claude/agents stay.`);
  // Round 3 of the reviews of PR 101: a store repository cause prints its own step; the others still need a push.
  for (const item of plan.items) if (!item.switch && item.notSwitched) lines.push(`Not switched: ${item.kind} ${item.id} cannot be locked yet. ${item.notSwitched.sentence}. ${item.notSwitched.next !== undefined ? `${item.notSwitched.next} Then run this command again.` : 'Push the store, then run this command again.'}`);
  if (plan.config !== null) {
    if (plan.config.created) { const c = JSON.parse(plan.config.text) as { skills: unknown[]; prompts: unknown[]; teams: unknown[] }; lines.push(`bowerloom.json: creates it, and lists ${plural(c.skills.length + c.prompts.length + c.teams.length, 'item')} of this project`); }
    for (const item of plan.items) if (item.switch && !plan.config.adds.includes(`${item.kind} ${item.id}`)) lines.push(`bowerloom.json: ${item.kind} ${item.id} changes from project to store`);
    for (const pair of plan.config.adds) lines.push(`bowerloom.json: adds ${pair} (store)`);
  }
  if (plan.lock !== null) for (const item of plan.items) if (item.switch && item.lock !== null) lines.push(`bowerloom.lock.json: adds ${item.kind} ${item.id} (${item.lock})`);
  lines.push(...tokenNotes(plan.notes, plan.network.credentials));
  if (plan.staleLock.length) lines.push(STALE_NOTE(plan.staleLock));
  lines.push(...removeBlock(plan.removeLines));
  return lines.join('\n');
}
/** The result in plain words: what moved, what was copied only, the remove lines, and the next step. */
export function storeMigrateWords(result: StoreMigrateResult): string {
  // Review M2: moved counts only what switched. The copies, and the items left in the project, are named apart.
  const copied = result.notSwitched.map(n => `${n.kind} ${n.id}`);
  return plainText([
    `Moved ${plural(result.moved.length, 'item')} to the store.`,
    ...(copied.length ? [`Copied but not switched: ${copied.join(', ')}.`, 'Push the store, then run bowerloom store migrate again to switch them.'] : []),
    ...result.skipped.map(s => `${itemLabel(s.kind, s.id)}${s.line}`),
    ...removeBlock(result.removeLines),
    ...(result.removeLines.length ? ['Next: bowerloom receipt clean'] : []), '',
  ].join('\n'), true);
}

interface MigrateArgs { skills: string[]; prompts: string[]; teams: string[]; all: boolean; commit: string | null; approval: string[] }
function parseMigrateArgs(words: readonly string[]): MigrateArgs {
  const out: MigrateArgs = { skills: [], prompts: [], teams: [], all: false, commit: null, approval: [] };
  const usage = (): never => { throw new DefinitionError('USAGE', MIGRATE_USAGE); };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === '--skill' || w === '--prompt' || w === '--team') { const v = words[++i]; if (v === undefined || v.startsWith('-')) usage(); out[w === '--skill' ? 'skills' : w === '--prompt' ? 'prompts' : 'teams'].push(v!); }
    else if (w === '--all') { if (out.all) usage(); out.all = true; }
    else if (w === '--commit') { const v = words[++i]; if (out.commit !== null || v === undefined) usage(); out.commit = v!; }
    else if (w === '--approve') { out.approval.push(w); if (i + 1 < words.length) out.approval.push(words[++i]!); }
    else if (w === '--json') out.approval.push(w);
    else usage();
  }
  return out;
}

/** `store migrate`. Returns 0 done or nothing to do, 3 approval required. A refusal throws. */
async function runMigrate(words: readonly string[], cwd: string, home: string, write: (text: string) => unknown, io: ApprovalIo, env: NodeJS.ProcessEnv): Promise<number> {
  const args = parseMigrateArgs(words), approval = parseApprovalFlags(args.approval);
  if (approval.rest.length) throw new DefinitionError('USAGE', MIGRATE_USAGE);
  const selection = { selectors: { skills: args.skills, prompts: args.prompts, teams: args.teams }, all: args.all, commit: args.commit };
  // Rule 2 before rule 1: a wrong command line is USAGE wherever it runs.
  checkMigrateSelectors(selection);
  const project = discoverProject(cwd, home), controller = new AbortController();
  // Spec 07: the planner reads the token through this reader only to prove a pushed copy; apply only to compare.
  const githubToken = githubTokenReader(env);
  const plans = new Map<string, StoreMigratePlan>();
  const plan = async (): Promise<StoreMigratePlan> => { const p = await planStoreMigrate({ project, home, ...selection, githubToken, signal: controller.signal }); plans.set(p.revision, p); return p; };
  const first = await plan();
  const json = approval.json;
  if (first.items.length === 0) {
    // Review H2: the old copies of items listed from the store are named, with the lines that remove them.
    write(json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : plainText([...first.skipped.map(s => `${itemLabel(s.kind, s.id)}${s.line}`), ...(first.staleLock.length ? [STALE_NOTE(first.staleLock)] : []), ...removeBlock(first.removeLines), 'Nothing to move.', ''].join('\n'), true));
    return 0;
  }
  if (migrateIsNoop(first)) { write(json ? newCommandJson({ nothingToDo: true, plan: first, revision: first.revision }) : `${plainText(renderStoreMigrate(first), true)}\nNothing to change.\n`); return 0; }
  let pending: StoreMigratePlan | null = first, result: StoreMigrateResult | null = null;
  const change: PlannedChange<StoreMigratePlan> = {
    async plan() { if (pending) { const p = pending; pending = null; return p; } return plan(); },
    revision: p => p.revision, review: renderStoreMigrate, staleNote: proofStaleNote,
    async apply(revision: string) {
      const p = plans.get(revision); if (!p) throw new DefinitionError('STALE_APPROVAL', 'The plan changed after it was approved. Nothing was applied. Run the command again to see the new plan.');
      // The token is compared only when the plan proved a pushed copy (spec 07, 3.5).
      result = await applyStoreMigrate(p, revision, { signal: controller.signal, githubToken: p.network.hosts.length ? githubToken() : null, project, home });
      return result;
    },
  };
  const outcome = await runWithApproval(change, { ...(approval.approve !== undefined ? { approve: approval.approve } : {}), json }, io);
  write(outcome.output + (outcome.exitCode === 0 && result && !json ? storeMigrateWords(result) : ''));
  return outcome.exitCode;
}
