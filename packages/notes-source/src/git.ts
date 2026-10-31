/**
 * The one module that runs git. It is the first code in Bowerloom that starts git, so every call is narrowed:
 *
 * - Git is found by fixed path only, never through PATH. On macOS, `/usr/bin/git` is a shim that can open an installer
 *   dialog, so only the Command Line Tools and Xcode gits count. The binary must be a plain executable file, owned by
 *   root or by you, that nobody else can write.
 * - Every argv is one of five fixed forms, behind fixed hardening options, and is checked against that allowlist just
 *   before the start. The log form may end with `-- <prefix>`, the notes folder's place in a larger repository. Two more
 *   forms, the key names of the repository's own config and of its worktree config, run only inside runGit. Nothing else
 *   ever runs. The hardening forbids every transport (`protocol.allow=never`), sets no ssh command, and the environment
 *   turns lazy fetches off, so git never reaches a remote.
 * - A repository whose own config sets a key that can start a program (an ssh command or proxy, a partial clone or other
 *   extension, a protocol rule, an include, or a remote's helper program) is refused before any command but init. A
 *   remote's address and fetch rule, `extensions.worktreeConfig`, and `extensions.objectFormat` are allowed: a clone of a
 *   hosted repository has them, and with every transport off they reach nothing.
 * - The process starts with `shell: false`, the verified folder as cwd, and a minimal environment that holds no
 *   variable of the caller: no HOME, so no global or XDG config, plus `GIT_CONFIG_GLOBAL=/dev/null` and
 *   `GIT_CONFIG_NOSYSTEM=1`. Pathspecs are literal. Every form except init pins `GIT_DIR` and `GIT_WORK_TREE` to the
 *   repository folder it is given, so git's own discovery never runs. A notes folder inside a larger repository is read
 *   through that repository's root, which repo.ts finds by a walk of plain folders, with the notes folder as the pathspec.
 * - A timeout and an output cap stop a call. The child runs in its own process group, and the whole group is killed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { plainRelative, uid, verifiedFolder } from './folder.js';
import { NotesRefusal, refuse } from './refusal.js';
import type { NotesCode } from './refusal.js';

// ---- finding git -------------------------------------------------------------------------------------------------------

/** A git binary that findGit checked. Only one that findGit returned runs. */
export interface GitBinary { readonly path: string }
const FOUND = new WeakSet<GitBinary>();

const CLT_GIT = '/Library/Developer/CommandLineTools/usr/bin/git';
const XCODE_GIT = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
const MAC_SHIM = '/usr/bin/git';

/**
 * The fixed paths where Bowerloom looks for git, in order. macOS: the developer folder that `xcode-select` chose (read
 * from its link, without running anything) when it is the Command Line Tools or an Xcode app, then the Command Line
 * Tools, then Xcode. Never `/usr/bin/git` there. Linux: `/usr/bin/git`, then `/bin/git`. Any other system: none.
 */
export function gitCandidates(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === 'linux') return ['/usr/bin/git', '/bin/git'];
  if (platform !== 'darwin') return [];
  const list: string[] = [];
  try {
    const selected = fs.readlinkSync('/var/db/xcode_select_link');
    if (isAbsolute(selected) && (selected === '/Library/Developer/CommandLineTools' || /^\/Applications\/[^/]+\.app\/Contents\/Developer$/.test(selected))) {
      list.push(join(selected, 'usr/bin/git'));
    }
  } catch { /* no selection: the fixed paths follow */ }
  list.push(CLT_GIT, XCODE_GIT);
  return [...new Set(list)].filter(c => c !== MAC_SHIM);
}

/** The real path of a trusted git, or null: a plain executable file, owned by root or you, that no one else can write. */
function trusted(candidate: unknown): string | null {
  if (typeof candidate !== 'string' || !isAbsolute(candidate) || candidate.includes('\0')) return null;
  try {
    const real = fs.realpathSync(candidate);
    if (process.platform === 'darwin' && real === MAC_SHIM) return null;
    const st = fs.statSync(real);
    if (!st.isFile() || (st.uid !== 0 && st.uid !== uid()) || (st.mode & 0o022) !== 0 || (st.mode & 0o111) === 0) return null;
    fs.accessSync(real, fs.constants.X_OK);
    return real;
  } catch { return null; }
}

export interface FindGitOptions {
  /** The paths to try instead of gitCandidates(). Tests pass a stand-in; the app passes nothing. */
  readonly candidates?: readonly string[];
}

/** Finds git by fixed path. Refuses NOTES_GIT_MISSING when no candidate is a trusted git. */
export function findGit(options: FindGitOptions = {}): GitBinary {
  const candidates = options.candidates ?? gitCandidates();
  if (!Array.isArray(candidates)) return refuse('NOTES_USAGE');
  for (const c of candidates) {
    const real = trusted(c);
    if (real === null) continue;
    const git: GitBinary = Object.freeze({ path: real });
    FOUND.add(git);
    return git;
  }
  return refuse('NOTES_GIT_MISSING');
}

// ---- the argv allowlist ------------------------------------------------------------------------------------------------

/** The only commit messages Bowerloom writes. */
export const COMMIT_MESSAGES = Object.freeze({
  starter: 'Create the starter wiki',
  history: 'Start version history for the wiki',
} as const);
export type CommitMessage = typeof COMMIT_MESSAGES[keyof typeof COMMIT_MESSAGES];
const MESSAGE_SET: ReadonlySet<string> = new Set(Object.values(COMMIT_MESSAGES));

/**
 * The options in front of every git call. They switch off hooks, fsmonitor, signing, and signature checks, and fix the
 * author and the first branch name, whatever a repository's own config says.
 */
export const GIT_HARDENING: readonly string[] = Object.freeze([
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.autocrlf=false',
  '-c', 'commit.gpgsign=false',
  '-c', 'log.showSignature=false',
  '-c', 'user.name=Bowerloom',
  '-c', 'user.email=bowerloom@localhost',
  '-c', 'init.defaultBranch=main',
  '-c', 'protocol.allow=never',
  '-c', 'core.sshCommand=false',
]);

export const GIT_LIMITS = Object.freeze({
  /** Paths in one add call. A longer list is split into several adds. */
  addPaths: 1000,
  /** Bytes of paths in one add call, well under any system's argv limit. */
  addBytes: 128 * 1024,
  timeoutMs: 30_000,
  maxTimeoutMs: 120_000,
  outputBytes: 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
});

/**
 * One of the five commands Bowerloom runs. `log-time` with a `prefix` reads the last commit that touched that folder only: the notes folder's place in a
 * larger repository, relative to its root.
 */
export type GitCommand =
  | { readonly op: 'init' }
  | { readonly op: 'add'; readonly paths: readonly string[] }
  | { readonly op: 'commit'; readonly message: CommitMessage }
  | { readonly op: 'log-time'; readonly prefix?: string }
  | { readonly op: 'status' };

const FIXED: Readonly<Record<'init' | 'log-time' | 'status', readonly string[]>> = Object.freeze({
  init: ['init', '-q'],
  'log-time': ['log', '-1', '--format=%ct'],
  status: ['status', '--porcelain'],
});
/**
 * The forms only runGit itself starts, before every command but init: the key names of the repository's own config file, and, when that file turns
 * `extensions.worktreeConfig` on, of its worktree config file too, each with no include followed. Neither is ever a GitCommand, so no caller can ask for it.
 */
const CONFIG_KEYS: readonly string[] = Object.freeze(['config', '--local', '--no-includes', '--name-only', '--list', '-z']);
const WORKTREE_CONFIG_KEYS: readonly string[] = Object.freeze(['config', '--worktree', '--no-includes', '--name-only', '--list', '-z']);

const keysAre = (value: object, keys: readonly string[]): boolean => {
  const own = Object.keys(value).sort();
  return own.length === keys.length && own.every((k, i) => k === [...keys].sort()[i]);
};

/** Builds the argv of one command. Refuses NOTES_GIT_ARGV for anything that is not one of the five commands. */
export function gitArgv(command: unknown): string[] {
  if (command === null || typeof command !== 'object') return refuse('NOTES_GIT_ARGV');
  const c = command as Record<string, unknown>;
  let tail: string[];
  if ((c.op === 'init' || c.op === 'log-time' || c.op === 'status') && keysAre(c, ['op'])) tail = [...FIXED[c.op]];
  else if (c.op === 'log-time' && keysAre(c, ['op', 'prefix']) && plainRelative(c.prefix)) tail = [...FIXED['log-time'], '--', c.prefix];
  else if (c.op === 'add' && keysAre(c, ['op', 'paths']) && Array.isArray(c.paths)) tail = ['add', '--', ...(c.paths as unknown[]).map(p => typeof p === 'string' ? p : refuse('NOTES_GIT_ARGV'))];
  else if (c.op === 'commit' && keysAre(c, ['op', 'message']) && typeof c.message === 'string') tail = ['commit', '-q', '-m', c.message];
  else return refuse('NOTES_GIT_ARGV');
  const argv = [...GIT_HARDENING, ...tail];
  checkGitArgv(argv);
  return argv;
}

const same = (a: readonly unknown[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Refuses NOTES_GIT_ARGV unless argv is exactly the hardening options and one of the five forms (or runGit's own config forms). */
export function checkGitArgv(argv: unknown): void {
  if (!Array.isArray(argv) || argv.some(a => typeof a !== 'string')) refuse('NOTES_GIT_ARGV');
  const list = argv as string[];
  if (!same(list.slice(0, GIT_HARDENING.length), GIT_HARDENING)) refuse('NOTES_GIT_ARGV');
  const tail = list.slice(GIT_HARDENING.length);
  if (Object.values(FIXED).some(form => same(tail, form)) || same(tail, CONFIG_KEYS) || same(tail, WORKTREE_CONFIG_KEYS)) return;
  const log = FIXED['log-time'];
  if (tail.length === log.length + 2 && same(tail.slice(0, log.length), log) && tail[log.length] === '--' && plainRelative(tail[log.length + 1])) return;
  if (tail.length === 4 && tail[0] === 'commit' && tail[1] === '-q' && tail[2] === '-m' && MESSAGE_SET.has(tail[3]!)) return;
  if (tail.length >= 3 && tail[0] === 'add' && tail[1] === '--') {
    const paths = tail.slice(2);
    if (paths.length <= GIT_LIMITS.addPaths && new Set(paths).size === paths.length && paths.every(plainRelative)
      && paths.reduce((n, p) => n + Buffer.byteLength(p) + 1, 0) <= GIT_LIMITS.addBytes) return;
  }
  refuse('NOTES_GIT_ARGV');
}

/** Splits a list of paths into add commands that each fit the limits. */
export function addCommands(paths: readonly string[]): GitCommand[] {
  const out: GitCommand[] = [];
  let chunk: string[] = [], bytes = 0;
  for (const p of paths) {
    const size = Buffer.byteLength(p) + 1;
    if (chunk.length && (chunk.length === GIT_LIMITS.addPaths || bytes + size > GIT_LIMITS.addBytes)) { out.push({ op: 'add', paths: chunk }); chunk = []; bytes = 0; }
    chunk.push(p); bytes += size;
  }
  if (chunk.length) out.push({ op: 'add', paths: chunk });
  return out;
}

// ---- running -----------------------------------------------------------------------------------------------------------

export interface GitRunOptions {
  /** Milliseconds before the call is killed: 1 to 120000, default 30000. */
  readonly timeoutMs?: number;
  /** Bytes of stdout and stderr together before the call is killed: 1 to 4 MiB, default 1 MiB. */
  readonly outputBytes?: number;
}

function limit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) return refuse('NOTES_USAGE');
  return value;
}

/** The whole environment of a git call. Nothing of the caller's environment is copied. */
export function gitEnvironment(dir: string, op: GitCommand['op']): Record<string, string> {
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_LITERAL_PATHSPECS: '1', GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_PROTOCOL_FROM_USER: '0',
  };
  if (op !== 'init') { env.GIT_DIR = join(dir, '.git'); env.GIT_WORK_TREE = dir; }
  return env;
}

/** Refuses NOTES_PATH_UNSAFE unless `<dir>/.git` is a real folder of this user. */
export function checkGitDir(dir: string): void {
  let st: fs.Stats;
  try { st = fs.lstatSync(join(dir, '.git')); } catch { return refuse('NOTES_PATH_UNSAFE', ['.git']); }
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid()) refuse('NOTES_PATH_UNSAFE', ['.git']);
}

/** The extensions a notes repository may set: neither makes git start a program or fetch anything. */
const SAFE_EXTENSIONS: ReadonlySet<string> = new Set(['extensions.worktreeconfig', 'extensions.objectformat']);

/**
 * True for a config key a notes repository may not set, by its name as `git config --name-only` prints it (section and key in lowercase). Each one can
 * make git start a program or reach a remote: an extension other than worktreeConfig and objectFormat (a partial clone fetches missing objects lazily), a
 * promisor remote or its filter, an ssh command, proxy, or variant, a remote's helper program (`vcs`, `uploadpack`, `receivepack`) and those sections, a
 * protocol rule (it would override `protocol.allow=never`), or an include (it would bring in keys this check never saw). A remote's address, push address,
 * and fetch rule are allowed: every transport is off, so they reach nothing.
 */
export function riskyConfigKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SAFE_EXTENSIONS.has(k)) return false;
  if (k.startsWith('remote.')) return /\.(?:vcs|uploadpack|receivepack|promisor|partialclonefilter)$/.test(k);
  return k.startsWith('extensions.') || k.startsWith('protocol.') || k.startsWith('include.') || k.startsWith('includeif.')
    || k.startsWith('uploadpack.') || k.startsWith('receivepack.')
    || k === 'core.sshcommand' || k === 'core.gitproxy' || k === 'ssh.variant';
}

/**
 * Refuses NOTES_GIT_CONFIG when the repository's own config file sets a risky key (riskyConfigKey), and NOTES_GIT_FAILED when git cannot list it. When that
 * file turns `extensions.worktreeConfig` on, git reads the worktree config file too, so its keys are checked the same way. Each list is read by git itself,
 * under the same hardening, with includes off, so the keys are the ones git would see; only key names are read, never a value.
 */
async function checkRepoConfig(file: string, dir: string, timeoutMs: number, cap: number): Promise<void> {
  const keys = async (form: readonly string[]): Promise<string[]> => {
    const argv = [...GIT_HARDENING, ...form];
    checkGitArgv(argv);
    // A list git cannot make (a broken repository) refuses NOTES_GIT_FAILED, as the command itself would: nothing else runs.
    return (await spawnGit(file, argv, dir, gitEnvironment(dir, 'status'), timeoutMs, cap)).split('\0').map(k => k.trim().toLowerCase());
  };
  const local = await keys(CONFIG_KEYS);
  if (local.some(riskyConfigKey)) refuse('NOTES_GIT_CONFIG');
  if (!local.includes('extensions.worktreeconfig')) return;
  // Git lists a worktree config file only when it is there; with none, git reads nothing more.
  try { fs.lstatSync(join(dir, '.git', 'config.worktree')); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    refuse('NOTES_GIT_FAILED');
  }
  if ((await keys(WORKTREE_CONFIG_KEYS)).some(riskyConfigKey)) refuse('NOTES_GIT_CONFIG');
}

/**
 * Runs one allowed git command in a verified folder and returns its stdout. `dir` is the repository's own folder: the notes folder, or the root of the
 * larger repository that holds it, with the notes folder as the log's prefix. Every command but init needs `.git` to be
 * a real folder of yours, and its own config file to set no risky key (NOTES_GIT_CONFIG), checked just before. Refuses
 * NOTES_GIT_TIMEOUT, NOTES_GIT_OUTPUT, NOTES_GIT_FAILED (a non-zero exit), or NOTES_GIT_MISSING (the binary is gone).
 * Git's own messages are never passed on: they can hold paths.
 */
export async function runGit(git: GitBinary, dir: string, command: GitCommand, options: GitRunOptions = {}): Promise<string> {
  if (!FOUND.has(git)) refuse('NOTES_USAGE');
  const timeoutMs = limit(options.timeoutMs, GIT_LIMITS.timeoutMs, GIT_LIMITS.maxTimeoutMs);
  const cap = limit(options.outputBytes, GIT_LIMITS.outputBytes, GIT_LIMITS.maxOutputBytes);
  const argv = gitArgv(command);
  verifiedFolder(dir);
  if (command.op !== 'init') { checkGitDir(dir); await checkRepoConfig(git.path, dir, timeoutMs, cap); }
  checkGitArgv(argv);
  return spawnGit(git.path, argv, dir, gitEnvironment(dir, command.op), timeoutMs, cap);
}

function spawnGit(file: string, argv: readonly string[], cwd: string, env: Record<string, string>, timeoutMs: number, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false, stopped: NotesCode | null = null, bytes = 0;
    const out: Buffer[] = [];
    const settle = (error: NotesRefusal | null, value = ''): void => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const child = spawn(file, [...argv], { cwd, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stop = (why: NotesCode): void => {
      if (stopped) return;
      stopped = why;
      if (child.pid === undefined) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    };
    const timer = setTimeout(() => stop('NOTES_GIT_TIMEOUT'), timeoutMs);
    const take = (keep: boolean) => (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > cap) stop('NOTES_GIT_OUTPUT');
      else if (keep) out.push(chunk);
    };
    child.stdout.on('data', take(true));
    child.stderr.on('data', take(false));
    child.once('error', e => {
      const code = (e as NodeJS.ErrnoException).code;
      settle(new NotesRefusal(code === 'ENOENT' || code === 'EACCES' ? 'NOTES_GIT_MISSING' : 'NOTES_GIT_FAILED'));
    });
    child.once('close', exit => {
      if (stopped) settle(new NotesRefusal(stopped));
      else if (exit !== 0) settle(new NotesRefusal('NOTES_GIT_FAILED'));
      else settle(null, Buffer.concat(out).toString('utf8'));
    });
  });
}
