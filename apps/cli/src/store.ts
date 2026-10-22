import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { AdapterError, strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { inspectStore, projectRefusal, storeRootOf, verifyStorePins } from '../../../packages/project-context/src/index.js';
import type { StoreContext } from '../../../packages/project-context/src/index.js';
import { newCommandJson, plainText } from './human.js';
import { readStoreRepo } from '../../../packages/project-config/src/git.js';
import type { StoreRepo } from '../../../packages/project-config/src/git.js';
import { NOT_SHAREABLE } from '../../../packages/project-config/src/refusal.js';
import { GithubToken } from '../../../packages/skill-manifest/src/github-token.js';

const STORE_STATUS_FORMAT = 'bowerloom/store-status/v1beta1';
const USAGE = 'Use bowerloom store status [--json].';
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
interface Report { state: State; path: string; code: string | null; message: string | null; counts: Counts | null; leftovers: string[]; git: StoreRepo | null }

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
    verifyStorePins(store);
    return { state: 'store', path, code: null, message: null, counts, leftovers, git };
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
    `  Pinned skills: ${pinned}`, `  Prompts: ${show(c.prompts)}`, `  Teams: ${show(c.teams)}`, ...gitLines(r.git!, token), ...leftover, '',
  ].join('\n');
}
/** The commands that fix a git problem of the store (3.21). The person runs them; Bowerloom never runs git. */
const FIX: Readonly<Record<string, (branch: string) => string[]>> = {
  none: b => ['cd ~/.bowerloom', 'git init', 'git add -A', 'git commit -m "Store"', 'git remote add origin https://github.com/<owner>/<repo>.git', `git push -u origin ${b}`],
  'no-origin': b => ['cd ~/.bowerloom', 'git remote add origin https://github.com/<owner>/<repo>.git', `git push -u origin ${b}`],
  'unsupported-remote': () => ['cd ~/.bowerloom', 'git remote set-url origin https://github.com/<owner>/<repo>.git'],
  unpushed: b => ['cd ~/.bowerloom', `git push -u origin ${b}`],
  unreadable: () => [],
};
function gitLines(git: StoreRepo, token: TokenState): string[] {
  const out: string[] = [];
  // Spec 07, 3.6: the token line follows the Git: line of a store with a git remote.
  const tokenLine = git.remote !== null ? [TOKEN_LINE[token]] : [];
  if (git.problem === null) out.push(`  Git: origin ${git.remote!.slice('https://'.length)}, branch ${git.branch ?? '<branch>'}, HEAD ${git.head?.slice(0, 8) ?? 'unknown'}, pushed ${git.pushed!.slice(0, 8)}`, ...tokenLine);
  else {
    out.push(git.problem === 'none' ? '  Git: none' : `  Git: ${NOT_SHAREABLE[git.problem]}`, ...tokenLine);
    const commands = FIX[git.problem]!(git.branch ?? '<branch>');
    if (commands.length) out.push('  To fix this, run these commands yourself:', ...commands.map(c => `    ${c}`));
  }
  out.push('  A private repository needs BOWERLOOM_GITHUB_TOKEN on each machine that fetches.');
  return out;
}

/**
 * `bowerloom store status [--json]`. Reads only. Every STORE_* refusal is reported as state `refused` and exits 0; USAGE
 * passes through. `home` is the HOME folder, and the store is always `<home>/.bowerloom`.
 */
export async function runStoreCommand(args: readonly string[], home: string, write: (text: string) => unknown, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const words = args.slice(1);
  if (words[0] !== 'status' || words.length > 2 || (words.length === 2 && words[1] !== '--json')) throw new DefinitionError('USAGE', USAGE);
  const r = report(home), token = GithubToken.status(env);
  if (words[1] === '--json') {
    const c = r.counts;
    const counts = c === null ? null : {
      skillFolders: c.skillFolders.n, pinnedSkills: c.pinnedSkills.count, pinnedSkillsProblem: c.pinnedSkills.problem, prompts: c.prompts.n, teams: c.teams.n,
      ignored: { skillFolders: c.skillFolders.ignored, prompts: c.prompts.ignored, teams: c.teams.ignored },
      capped: { skillFolders: c.skillFolders.capped, prompts: c.prompts.capped, teams: c.teams.capped },
    };
    const g = r.git, git = r.state !== 'store' || g === null ? null : { present: g.problem !== 'none', problem: g.problem, remote: g.remote, branch: g.branch, head: g.head, pushed: g.pushed, ahead: g.head !== null && g.pushed !== null ? (g.head === g.pushed ? 'no' : 'yes') : 'unknown', token };
    write(newCommandJson({ format: STORE_STATUS_FORMAT, state: r.state, path: r.path, code: r.code, counts, leftoverTemps: r.leftovers.length, git }));
  } else write(render(r, token));
  return 0;
}