#!/usr/bin/env node
// Release script for the Bowerloom CLI npm beta. Read docs/releasing.md first.
//
//   node scripts/release.mjs <subcommand> [flags]
//
// Exit codes: 0 = pass, 1 = a check failed, 2 = wrong use of the script (also a human-only subcommand run without a terminal).
// With --json, stdout holds exactly one JSON object. The exact command of every child process goes to stderr before it runs.
//
// Safety rules this file keeps:
//   - The only `npm publish` it ever runs is a dry run. A guard in spawnNpm() refuses every other npm subcommand that could change the registry.
//   - It never reads, stores, or prints a token, a one-time code, or a password. Children start with a scrubbed environment and with
//     empty npm config files, so a user's ~/.npmrc is never read. Output is redacted before it reaches a log or the screen.
//   - Subcommands that publish or retire only print the commands. They print them to a person at a terminal.
//   - The only thing it ever pushes is the one release tag: `tag` runs `git -c core.fsmonitor=false -c core.hooksPath=/dev/null -c push.followTags=false push --no-verify --no-recurse-submodules origin refs/tags/<tag>`.
//     Never --force, never --tags, never a branch. Its fetches, the local tag, and that push run with core.hooksPath=/dev/null and --no-verify, so no repository hook
//     (pre-push, reference-transaction, and the rest) runs; it pushes only when origin has exactly one fetch URL and exactly one push URL and the two are equal.
//   - Every git call, in any subcommand, runs with `-c core.fsmonitor=false`, so a repository config cannot name a fsmonitor command that would run with the ssh agent.
//     Read docs/releasing.md, "Residual risk": the script still trusts .git/config and the user's global git config for everything else.
//   - On SIGINT, SIGTERM or SIGHUP it kills every child process group, removes its temporary folders, and exits 130.
//
// Settings come from release.config.json at the repository root. The version comes from the release record that the config names.
//
// Test seams (environment variables): BOWERLOOM_RELEASE_NPM replaces the npm binary, BOWERLOOM_RELEASE_PACK replaces the pack script,
// and BOWERLOOM_RELEASE_FREE_GIB replaces the measured free disk space. Nothing else changes behavior. A seam, or a --repo that is not
// the repository holding this script, prints a warning and is recorded in every receipt. Such a receipt never counts as real. A receipt counts only in a run whose seams are the same as the seams that wrote it.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonWanted } from '../tools/lib/cli.mjs';
import { firstFailure, parseCounts } from '../tools/lib/output-parse.mjs';
import { emptyNpmConfigEnv, KEEPABLE_ENV, redact, scrubEnv } from '../tools/lib/safe-env.mjs';

const SCRIPT = fs.realpathSync(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(path.dirname(SCRIPT), '..');
const CONFIG_FILE = 'release.config.json';
const CONFIG_SCHEMA = 'bowerloom/release-config/v1';
const RESULT_SCHEMA = 'bowerloom/release-result/v1';
const RECEIPT_SCHEMA = 'bowerloom/release-receipt/v2';
const HASH_SCHEMA = 'bowerloom/desktop-hashes/v1';
const STATE_DIR = '.trellis/release';
const FREE_FLOOR_GIB = 12;
const DRY_RUN_EXTRA_GIB = 0.05;
const OUTPUT_CAP_BYTES = 16 * 2 ** 20;
const GIT_TIMEOUT_MS = 120_000;
const VIEW_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 600_000;
const DEFAULT_GATE_TIMEOUT_S = 1800;
const EXIT_GRACE_MS = 2000;
const KILL_GRACE_MS = 2000;
const SIGNAL_GRACE_MS = 3000;
const SEAM_ENV_NAMES = ['BOWERLOOM_RELEASE_NPM', 'BOWERLOOM_RELEASE_PACK', 'BOWERLOOM_RELEASE_FREE_GIB'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FULL_HASH = /^[0-9a-f]{40}$/;
// npm subcommands the script may start. `publish` is handled apart in assertSafeNpmArgs and runs only with --dry-run.
const NPM_SUBCOMMANDS_ALLOWED = new Set(['ci', 'run', 'test', 'view', 'init', 'install']);

/** Subcommand table. Order is the order of --help. `flags` lists the flags beyond --json, --repo and --help (and --force, see FORCE_COMMANDS). */
export const COMMANDS = Object.freeze([
  { name: 'status', class: 'read-only', description: 'Show each release phase as done, todo, or unknown, with a reason.', flags: [] },
  { name: 'preflight', class: 'read-only', description: 'Fetch origin, then check branch, sync with origin, and a clean tree. Print the commit.', flags: ['--branch'] },
  { name: 'gates', class: 'local-write', description: 'Run the gate commands from the config in order. Stop at the first failure.', flags: ['--e2e', '--min-free-gib'] },
  { name: 'dry-run', class: 'local-write', description: 'Pack the tarball and run npm publish --dry-run on it. Report size, count, SHA-256, and integrity.', flags: ['--min-free-gib'] },
  { name: 'publish', class: 'human-only', description: 'Print the publish commands for a person to run. Never runs them.', flags: [] },
  { name: 'hashes', class: 'local-write', description: 'Write the SHA-256 of each desktop artifact to the hash file.', flags: [] },
  { name: 'verify', class: 'read-only', description: 'Check the registry tag and integrity, an install from the registry, and the desktop hashes.', flags: ['--tarball'] },
  { name: 'tag', class: 'remote-write', description: 'Create the annotated git tag on the checked commit and push that one tag to origin.', flags: ['--commit', '--branch'] },
  { name: 'retire', class: 'human-only', description: 'Print the npm deprecate and dist-tag commands from the config. Never runs them.', flags: [] },
  { name: 'claims', class: 'read-only', description: 'Scan the configured files for stale wording. Exit 1 on any hit.', flags: [] },
]);
const FLAG_KINDS = { '--json': 'bool', '--force': 'bool', '--help': 'bool', '--manifest': 'bool', '--e2e': 'bool', '--repo': 'value', '--branch': 'value', '--min-free-gib': 'value', '--tarball': 'value', '--commit': 'value' };
const GLOBAL_FLAGS = ['--json', '--help', '--repo'];
/** The only subcommands that take --force. */
const FORCE_COMMANDS = ['gates', 'dry-run', 'hashes'];

// ---------------------------------------------------------------------------------------------------------------------------------
// Errors and small helpers

/** Wrong use of the script or an invalid config. Exit 2. */
export class UsageError extends Error {}
/** A check failed. Exit 1. `data` is merged into the result. */
export class StepFailure extends Error {
  constructor(message, data = {}) { super(message); this.data = data; }
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256Hex = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sha512Integrity = bytes => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
const short = hash => String(hash).slice(0, 12);
const GIB = 2 ** 30;

function shellQuote(word) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${String(word).replace(/'/g, `'\\''`)}'`;
}
const shellLine = words => words.map(shellQuote).join(' ');

/** The registry of the config and the origin URLs read so far. Their exact text is hidden from every failure line, whatever shape it has. */
const KNOWN_URLS = new Set();
const rememberUrl = url => { if (typeof url === 'string' && url.length >= 4) KNOWN_URLS.add(url); };
/**
 * Hides every URL in a text. A URL can hold a user and a token in front of the host, and an scp-style address (user, at sign, host, colon, path) holds a user.
 * The whole address goes, not only the password: the mark stands where it was.
 */
export function scrubUrls(text) {
  let out = String(text ?? '');
  for (const known of KNOWN_URLS) out = out.split(known).join('[url]');
  return out
    .replace(/[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s'"<>]*/g, '[url]')
    .replace(/(?<![\w.@-])[\w.-]+@[\w.-]+:[^\s'"<>]*/g, '[url]');
}
const failLine = text => {
  const line = firstFailure(scrubUrls(text));
  return line === null ? 'no output' : line;
};

function writeFileAtomic(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, data, { mode });
  fs.renameSync(temp, file);
}

/** Free space in GiB at `dir`, or the test override. */
function freeGiB(env, dir) {
  if (env.BOWERLOOM_RELEASE_FREE_GIB !== undefined) {
    const value = Number(env.BOWERLOOM_RELEASE_FREE_GIB);
    if (!Number.isFinite(value) || value < 0) throw new UsageError('BOWERLOOM_RELEASE_FREE_GIB must be a number of GiB');
    return value;
  }
  const s = fs.statfsSync(dir);
  return (s.bavail * s.bsize) / GIB;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Config

function checkKeys(value, where, required, optional = []) {
  if (!isObject(value)) throw new UsageError(`config: ${where} must be an object`);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) throw new UsageError(`config: unknown key ${where}${key}`);
  for (const key of required) if (!(key in value)) throw new UsageError(`config: missing key ${where}${key}`);
}
function str(value, where, pattern) {
  if (typeof value !== 'string' || value === '' || /[\u0000-\u001f]/.test(value)) throw new UsageError(`config: ${where} must be a non-empty string without control characters`);
  if (pattern && !pattern.test(value)) throw new UsageError(`config: ${where} has an invalid form`);
  return value;
}
function strList(value, where, itemPattern, minItems = 0) {
  if (!Array.isArray(value) || value.length < minItems) throw new UsageError(`config: ${where} must be a list${minItems ? ' with at least one item' : ''}`);
  value.forEach((item, i) => str(item, `${where}[${i}]`, itemPattern));
  return value;
}
function relPath(value, where) {
  str(value, where);
  const parts = value.split('/');
  if (path.isAbsolute(value) || value.includes('\\') || parts.some(p => p === '..' || p === '')) throw new UsageError(`config: ${where} must be a relative path inside the repository`);
  return value;
}
const EVAL_FLAG = /^(?:-e|-p|--eval|--print)(?:=|$)/;
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;
/** A gate is `npm ci`, `npm test`, or `npm run NAME`. Nothing else, and no eval flag anywhere. */
function checkGateCommand(command, at) {
  const [bin, sub, name] = command;
  const shape = bin === 'npm' && ((sub === 'ci' || sub === 'test') ? command.length === 2 : sub === 'run' && command.length === 3 && SCRIPT_NAME.test(name));
  if (!shape || command.some(word => EVAL_FLAG.test(word))) throw new UsageError(`config: ${at}command must be npm ci, npm test, or npm run NAME`);
}
function gateList(value, where, minItems = 0) {
  if (!Array.isArray(value) || value.length < minItems) throw new UsageError(`config: ${where} must be a list${minItems ? ' with at least one item' : ''}`);
  value.forEach((gate, i) => {
    const at = `${where}[${i}].`;
    checkKeys(gate, at, ['name', 'cwd', 'command'], ['timeoutSeconds']);
    str(gate.name, at + 'name');
    if (gate.cwd !== '.') relPath(gate.cwd, at + 'cwd');
    strList(gate.command, at + 'command', null, 1);
    checkGateCommand(gate.command, at);
    if ('timeoutSeconds' in gate && !(Number.isInteger(gate.timeoutSeconds) && gate.timeoutSeconds >= 1 && gate.timeoutSeconds <= 21600)) throw new UsageError(`config: ${at}timeoutSeconds must be a whole number from 1 to 21600`);
  });
  return value;
}

/** Checks the config strictly and returns it. Throws UsageError. */
export function validateConfig(config) {
  checkKeys(config, '', ['schema', 'package', 'binName', 'registry', 'distTag', 'tagPrefix', 'releaseRecord', 'branchPattern', 'packScript', 'gates', 'e2eGates', 'desktop', 'claims', 'retire'], ['expectedFileCount']);
  if (config.schema !== CONFIG_SCHEMA) throw new UsageError(`config: schema must be ${CONFIG_SCHEMA}`);
  str(config.package, 'package', /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/);
  str(config.binName, 'binName', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  rememberUrl(config.registry);
  str(config.registry, 'registry', /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/);
  str(config.distTag, 'distTag', /^[a-z0-9][a-z0-9._-]*$/);
  if (typeof config.tagPrefix !== 'string' || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(config.tagPrefix)) throw new UsageError('config: tagPrefix must be empty or start with a letter or digit, and hold only letters, digits, dot, underscore and hyphen');
  relPath(config.releaseRecord, 'releaseRecord');
  str(config.branchPattern, 'branchPattern');
  try { new RegExp(config.branchPattern); } catch { throw new UsageError('config: branchPattern is not a valid regular expression'); }
  relPath(config.packScript, 'packScript');
  gateList(config.gates, 'gates', 1);
  gateList(config.e2eGates, 'e2eGates');
  checkKeys(config.desktop, 'desktop.', ['packageJson', 'dir', 'patterns', 'hashFile']);
  relPath(config.desktop.packageJson, 'desktop.packageJson');
  relPath(config.desktop.dir, 'desktop.dir');
  strList(config.desktop.patterns, 'desktop.patterns', /^[A-Za-z0-9._*-]+$/, 1);
  relPath(config.desktop.hashFile, 'desktop.hashFile');
  checkKeys(config.claims, 'claims.', ['paths', 'patterns']);
  strList(config.claims.paths, 'claims.paths', null, 1);
  config.claims.paths.forEach((p, i) => relPath(p, `claims.paths[${i}]`));
  strList(config.claims.patterns, 'claims.patterns', null, 1);
  if (!Array.isArray(config.retire)) throw new UsageError('config: retire must be a list');
  config.retire.forEach((item, i) => {
    checkKeys(item, `retire[${i}].`, ['version', 'message']);
    str(item.version, `retire[${i}].version`, SEMVER);
    str(item.message, `retire[${i}].message`);
    if (item.message.length > 500) throw new UsageError(`config: retire[${i}].message is longer than 500 characters`);
  });
  if ('expectedFileCount' in config && !(Number.isInteger(config.expectedFileCount) && config.expectedFileCount > 0)) throw new UsageError('config: expectedFileCount must be a positive whole number');
  return config;
}

function loadConfig(repo) {
  const file = path.join(repo, CONFIG_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { throw new UsageError(`${CONFIG_FILE} not found in ${repo}`); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new UsageError(`${CONFIG_FILE} is not valid JSON`); }
  return validateConfig(parsed);
}

function loadVersion(repo, config) {
  const file = path.join(repo, config.releaseRecord);
  let record;
  try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new UsageError(`release record ${config.releaseRecord} is missing or not valid JSON`); }
  if (!isObject(record) || typeof record.version !== 'string' || !SEMVER.test(record.version)) throw new UsageError(`release record ${config.releaseRecord} has no valid version field`);
  return { version: record.version, record };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Arguments

/** Parses argv. Returns { help, manifest, command, flags } or throws UsageError. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h') { flags['--help'] = true; continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const kind = FLAG_KINDS[name];
    if (!kind) throw new UsageError(`unknown flag ${name}`);
    if (name in flags) throw new UsageError(`flag ${name} given twice`);
    if (kind === 'bool') {
      if (inline !== undefined) throw new UsageError(`flag ${name} takes no value`);
      flags[name] = true;
    } else {
      const value = inline ?? argv[++i];
      if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError(`flag ${name} needs a value`);
      flags[name] = value;
    }
  }
  if (flags['--manifest']) {
    if (positional.length) throw new UsageError('--manifest takes no subcommand');
    return { manifest: true, flags };
  }
  if (flags['--help']) return { help: true, flags };
  if (positional.length === 0) throw new UsageError('missing subcommand; run with --help');
  if (positional.length > 1) throw new UsageError(`unexpected argument ${positional[1]}`);
  const spec = COMMANDS.find(c => c.name === positional[0]);
  if (!spec) throw new UsageError(`unknown subcommand ${positional[0]}`);
  for (const name of Object.keys(flags)) {
    if (name === '--manifest') throw new UsageError('--manifest takes no subcommand');
    if (name === '--force' ? !FORCE_COMMANDS.includes(spec.name) : !GLOBAL_FLAGS.includes(name) && !spec.flags.includes(name)) throw new UsageError(`flag ${name} does not apply to ${spec.name}`);
  }
  return { command: spec, flags };
}

function minFreeGiB(flags) {
  const raw = flags['--min-free-gib'];
  if (raw === undefined) return FREE_FLOOR_GIB;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || !/^\d+(?:\.\d+)?$/.test(raw)) throw new UsageError('--min-free-gib needs a positive number');
  if (value < FREE_FLOOR_GIB) throw new UsageError(`--min-free-gib can only raise the floor of ${FREE_FLOOR_GIB} GiB`);
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Child processes

/** The one shape of `npm install` that verify runs: a package and tag, three fixed flags, and an https registry. */
const INSTALL_SPEC = /^[A-Za-z0-9@][A-Za-z0-9@._~/-]*@[a-z0-9][a-z0-9._-]*$/;
function isFixedInstall(args) {
  return args.length === 7 && INSTALL_SPEC.test(args[1]) && args[2] === '--ignore-scripts' && args[3] === '--no-audit' && args[4] === '--no-fund'
    && args[5] === '--registry' && /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/.test(args[6]);
}

/**
 * The single door to npm. Refuses every subcommand that could change the registry, any publish without exactly one --dry-run as its first
 * argument, a `--` anywhere in a publish, `init` or `install` in any shape but the one the script uses, and eval flags.
 */
export function assertSafeNpmArgs(args) {
  const sub = args[0];
  if (args.some(arg => EVAL_FLAG.test(arg))) throw new Error('release script refuses an npm eval flag');
  if (sub === 'publish') {
    // --dry-run comes first, once, with no flag that names a dry run in another form (--dry-run=false, --no-dry-run), and no `--` that ends the flags.
    const exact = args.filter(arg => arg === '--dry-run').length;
    const lookalike = args.filter(arg => arg !== '--dry-run' && arg.startsWith('-') && /dry-?run/i.test(arg)).length;
    if (args[1] !== '--dry-run' || exact !== 1 || lookalike > 0 || args.includes('--')) throw new Error('release script refuses npm publish without exactly one --dry-run as its first argument');
    return;
  }
  if (!NPM_SUBCOMMANDS_ALLOWED.has(sub)) throw new Error(`release script refuses npm ${sub}`);
  if (sub === 'init' && !(args.length === 2 && args[1] === '-y')) throw new Error('release script refuses npm init in any form but init -y');
  if (sub === 'install' && !isFixedInstall(args)) throw new Error('release script refuses npm install in any form but the one verify uses');
}

const npmBinary = env => env.BOWERLOOM_RELEASE_NPM || 'npm';

// Live child process groups and temporary folders, so that a signal can clean up. State of the whole process.
const liveGroups = new Set();
const tempFolders = new Set();
let shuttingDown = false;

function killGroupPid(pid, signal) {
  try { process.kill(-pid, signal); } catch { /* the group is already gone */ }
}
const groupAlive = pid => { try { process.kill(-pid, 0); return true; } catch { return false; } };

/** Makes a temporary folder in the run's temp root. It goes away with `dropTemp`, at the end of the run, or on a signal. */
function makeTemp(ctx, prefix) {
  const dir = fs.mkdtempSync(path.join(tmpRoot(ctx), prefix));
  tempFolders.add(dir);
  (ctx.temps ??= []).push(dir);
  return dir;
}
function dropTemp(dir, { remove = true } = {}) {
  tempFolders.delete(dir);
  if (remove) fs.rmSync(dir, { recursive: true, force: true });
}
function removeAllTemps() {
  for (const dir of [...tempFolders]) dropTemp(dir);
}
/** The two npm variables that point npm at empty config files, made once per run. */
function npmConfigEnv(ctx) {
  ctx.npmConfig ??= emptyNpmConfigEnv(makeTemp(ctx, 'bowerloom-release-npmcfg-'));
  return ctx.npmConfig;
}

/**
 * Installs the signal handlers of a real run. On SIGINT, SIGTERM or SIGHUP it stops every live child process group (SIGTERM, then SIGKILL
 * after a short wait), removes the temporary folders, and exits 130. Tests that import this file do not call it.
 */
export function installSignalHandlers(proc = process) {
  const stop = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const groups = [...liveGroups];
    for (const pid of groups) killGroupPid(pid, 'SIGTERM');
    const deadline = Date.now() + SIGNAL_GRACE_MS;
    while (Date.now() < deadline && groups.some(groupAlive)) await new Promise(resolve => setTimeout(resolve, 50));
    for (const pid of groups) killGroupPid(pid, 'SIGKILL');
    removeAllTemps();
    proc.exit(130);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) proc.on(signal, stop);
  proc.on('exit', removeAllTemps);
}

/**
 * Runs one child process in its own process group. Prints the exact command to stderr first.
 * Kills the whole group on timeout, when output passes the cap, and when the child has gone but left something holding its pipes.
 * Writes the full output to `logName` under the logs directory when given.
 * `spec.keepEnv` names the ssh agent variables to pass on (SSH_AUTH_SOCK, SSH_AGENT_PID); only the git helper sets it.
 */
async function runChild(ctx, spec) {
  const { cmd, args = [], cwd, timeoutMs = GIT_TIMEOUT_MS, logName, env: extraEnv = {}, keepEnv = [] } = spec;
  const where = cwd && path.resolve(cwd) !== path.resolve(ctx.repo) ? `   # in ${path.relative(ctx.repo, cwd) || '.'}` : '';
  ctx.stderr.write(`$ ${redact(shellLine([cmd, ...args]), ctx.env)}${where}\n`);
  const started = Date.now();
  const env = { ...scrubEnv(ctx.env, { keep: keepEnv }), GIT_TERMINAL_PROMPT: '0', ...extraEnv };
  const result = shuttingDown ? { code: null, spawnError: 'stopped by a signal', stdout: '', all: '' } : await new Promise(resolve => {
    let child;
    try { child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { resolve({ code: null, spawnError: error.message, stdout: '', all: '' }); return; }
    if (child.pid) liveGroups.add(child.pid);
    const outChunks = [], allChunks = [];
    let bytes = 0, timedOut = false, capped = false, settled = false, graceTimer = null;
    const killGroup = signal => { if (child.pid) killGroupPid(child.pid, signal); };
    const timer = setTimeout(() => { timedOut = true; killGroup('SIGTERM'); setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS).unref(); }, timeoutMs);
    const take = isOut => chunk => {
      if (capped || settled) return;
      bytes += chunk.length;
      if (bytes > OUTPUT_CAP_BYTES) { capped = true; killGroup('SIGKILL'); return; }
      allChunks.push(chunk);
      if (isOut) outChunks.push(chunk);
    };
    child.stdout.on('data', take(true));
    child.stderr.on('data', take(false));
    const finish = (code, signal, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      if (child.pid) liveGroups.delete(child.pid);
      killGroup('SIGKILL'); // whatever the child left in its group, such as a daemon that holds the pipes open
      child.stdout.destroy();
      child.stderr.destroy();
      // Decoding happens once, over whole buffers, so a character split across two chunks stays whole.
      resolve({ code, signal, timedOut, capped, stdout: Buffer.concat(outChunks).toString('utf8'), all: Buffer.concat(allChunks).toString('utf8'), spawnError });
    };
    child.on('error', error => finish(null, null, error.message));
    // `close` waits for the pipes to end, and a leftover process can hold them open. So `exit` starts a short grace, and `close` ends it early.
    child.on('exit', (code, signal) => { graceTimer = setTimeout(() => finish(code, signal), EXIT_GRACE_MS); });
    child.on('close', (code, signal) => finish(code, signal));
  });
  result.durationMs = Date.now() - started;
  result.stdout = redact(result.stdout, ctx.env);
  result.all = redact(result.all, ctx.env);
  result.ok = result.code === 0 && !result.timedOut && !result.capped && !result.spawnError;
  if (logName) result.log = writeLog(ctx, logName, [cmd, ...args], result);
  return result;
}

function writeLog(ctx, name, words, result) {
  const dir = path.join(ctx.repo, STATE_DIR, 'logs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-${name.replace(/[^A-Za-z0-9._-]+/g, '_')}.log`);
  const header = `$ ${shellLine(words)}\nexit: ${result.code ?? 'none'}${result.signal ? ` signal: ${result.signal}` : ''}${result.timedOut ? ' (timed out)' : ''}${result.capped ? ' (output cap reached)' : ''}\n\n`;
  fs.writeFileSync(file, redact(header + result.all, ctx.env), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return path.relative(ctx.repo, file);
}

/** The reason line for a failed child. */
function failureLine(result) {
  if (result.spawnError) return `could not start: ${result.spawnError}`;
  if (result.timedOut) return 'timed out; the process group was killed';
  if (result.capped) return 'output passed the cap; the process group was killed';
  return failLine(result.all);
}

// Only git gets the ssh agent variables (for a fetch or ls-remote over ssh). npm, node, the gates, and pack never do.
// Every call starts with `-c core.fsmonitor=false`: a repository config could name a fsmonitor command, and git would run it (with the ssh agent) for status, diff, and tag.
const GIT_BASE_ARGS = ['-c', 'core.fsmonitor=false'];
const git = (ctx, args, extra = {}) => runChild(ctx, { cmd: 'git', args: [...GIT_BASE_ARGS, ...args], cwd: ctx.repo, timeoutMs: GIT_TIMEOUT_MS, keepEnv: KEEPABLE_ENV, ...extra });
/** A git command that runs no repository hook: the fetches, the local tag, and the tag push. The folder /dev/null holds no hook, and `-c` beats every config file. */
const gitNoHooks = (ctx, args, extra = {}) => git(ctx, ['-c', 'core.hooksPath=/dev/null', ...args], extra);
/** Fetches origin and drops the remote-tracking refs of branches that origin no longer has, so a deleted branch is never read as published. */
const fetchOrigin = ctx => gitNoHooks(ctx, ['fetch', '--prune', 'origin']);
function spawnNpm(ctx, args, extra = {}) {
  assertSafeNpmArgs(args);
  return runChild(ctx, { cmd: npmBinary(ctx.env), args, cwd: ctx.repo, ...extra, env: { ...npmConfigEnv(ctx), ...extra.env } });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Git and receipts

async function headCommit(ctx) {
  const r = await git(ctx, ['rev-parse', 'HEAD']);
  const commit = r.stdout.trim();
  if (!r.ok || !FULL_HASH.test(commit)) throw new StepFailure(`cannot read HEAD: ${failureLine(r)}`);
  return commit;
}
async function treeIsClean(ctx) {
  const r = await git(ctx, ['status', '--porcelain']);
  if (!r.ok) throw new StepFailure(`git status failed: ${failureLine(r)}`);
  return { clean: r.stdout.trim() === '', first: r.stdout.split('\n').find(Boolean) ?? '' };
}

const receiptFile = (ctx, step, version, commit) => path.join(ctx.repo, STATE_DIR, 'receipts', `${step}-${version}-${commit}.json`);
const hasSeams = receipt => Array.isArray(receipt?.seams) && receipt.seams.length > 0;
const sameSeams = (a, b) => a.length === b.length && [...a].sort().every((name, i) => name === [...b].sort()[i]);

/** Why a gates receipt is not enough, or null: every test gate of the config must have counts that pass the same rule as the live run. */
function gatesReceiptProblem(ctx, receipt) {
  if (!Array.isArray(receipt.gates)) return 'no gate list';
  if (!ctx.config) return null;
  const list = [...ctx.config.gates, ...(receipt.e2e === true ? ctx.config.e2eGates : [])];
  for (const gate of list) {
    const entry = receipt.gates.find(g => isObject(g) && g.name === gate.name);
    if (!entry) return `gate "${gate.name}" missing`;
    if (isTestGate(gate.command) && countsProblem(isObject(entry.counts) ? entry.counts : null)) return `gate "${gate.name}" has no passing counts`;
  }
  return null;
}

/**
 * The receipt for one step, version and commit, or null. A receipt counts only in a run with the same test seams as the run that wrote it
 * (no seams for a real run), unless `raw` is set (status shows such a receipt, marked as not real). A receipt of an older schema is absent.
 */
function readReceipt(ctx, step, version, commit, { raw = false } = {}) {
  try {
    const receipt = JSON.parse(fs.readFileSync(receiptFile(ctx, step, version, commit), 'utf8'));
    if (!(isObject(receipt) && receipt.schema === RECEIPT_SCHEMA && receipt.commit === commit && receipt.version === version && receipt.step === step)) return null;
    if (!Array.isArray(receipt.seams)) return null;
    if (!raw && !sameSeams(receipt.seams, ctx.seams)) return null;
    if (step === 'gates' && gatesReceiptProblem(ctx, receipt)) return null;
    return receipt;
  } catch { return null; }
}
function writeReceipt(ctx, step, version, commit, data) {
  const receipt = { schema: RECEIPT_SCHEMA, step, version, commit, at: new Date().toISOString(), seams: ctx.seams, ...data };
  writeFileAtomic(receiptFile(ctx, step, version, commit), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
/** True when `ancestor` is `descendant` or an ancestor of it. Any other answer of git, such as a commit this clone does not hold, counts as false. */
async function isAncestor(ctx, ancestor, descendant) {
  const r = await git(ctx, ['merge-base', '--is-ancestor', ancestor, descendant]);
  return r.ok;
}
/**
 * The newest receipt of one step and version that counts in this run (same seams), passes `accept`, and sits on `descendant` or an ancestor of it, or null.
 * A receipt on a commit outside that history is not evidence. With `raw`, a receipt written under other test seams is returned too (status shows it, marked).
 */
async function newestReceipt(ctx, step, version, descendant, accept = () => true, { raw = false } = {}) {
  const prefix = `${step}-${version}-`;
  let names;
  try { names = fs.readdirSync(path.join(ctx.repo, STATE_DIR, 'receipts')); } catch { return null; }
  const found = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.json')) continue;
    const commit = name.slice(prefix.length, -'.json'.length);
    if (!FULL_HASH.test(commit)) continue;
    const receipt = readReceipt(ctx, step, version, commit, { raw });
    if (receipt && accept(receipt)) found.push(receipt);
  }
  found.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  for (const receipt of found) if (await isAncestor(ctx, receipt.commit, descendant)) return receipt;
  return null;
}
/**
 * The newest dry-run receipt for a version that counts in this run (same seams) and whose commit is HEAD or an ancestor of HEAD, or null.
 * The hash commit that follows a publish moves HEAD past the dry run, and a receipt on a commit outside this history is not evidence.
 */
const newestDryRun = (ctx, version, accept = () => true) => newestReceipt(ctx, 'dry-run', version, 'HEAD', accept);
/** A verify receipt counts only when it holds checks and every one of them passed. */
const verifyPassed = receipt => Array.isArray(receipt?.checks) && receipt.checks.length > 0 && receipt.checks.every(c => c.status === 'pass');

/** The folder for temporary work: TMPDIR of the run, else the system folder. */
const tmpRoot = ctx => fs.realpathSync(ctx.env.TMPDIR || os.tmpdir());

/** Names of the test seams in use: the three variables, and a --repo that is not the repository holding this script. */
export function detectSeams(env, repo) {
  const seams = [];
  if (env.BOWERLOOM_RELEASE_NPM) seams.push('BOWERLOOM_RELEASE_NPM');
  if (env.BOWERLOOM_RELEASE_PACK) seams.push('BOWERLOOM_RELEASE_PACK');
  if (env.BOWERLOOM_RELEASE_FREE_GIB !== undefined) seams.push('BOWERLOOM_RELEASE_FREE_GIB');
  if (repo !== DEFAULT_REPO) seams.push('--repo');
  return seams;
}

const done = (message, data = {}) => ({ ok: true, outcome: 'done', message, ...data });
const alreadyDone = (message, data = {}) => ({ ok: true, outcome: 'already done', message: `already done: ${message}`, ...data });

// ---------------------------------------------------------------------------------------------------------------------------------
// Registry

const NOT_FOUND = /\bE404\b|404 Not Found|"code"\s*:\s*"E404"/;
/** Runs `npm view`. Returns { state: 'ok' | 'notfound' | 'unreachable', text, reason }. */
async function npmView(ctx, config, spec, field, { json = false } = {}) {
  const args = ['view', spec, field, ...(json ? ['--json'] : []), '--registry', config.registry];
  const r = await spawnNpm(ctx, args, { timeoutMs: VIEW_TIMEOUT_MS });
  if (r.ok) return { state: 'ok', text: r.stdout.trim() };
  if (!r.timedOut && !r.spawnError && NOT_FOUND.test(r.all)) return { state: 'notfound', reason: 'not found on the registry' };
  return { state: 'unreachable', reason: r.timedOut ? 'registry unreachable (timed out)' : `registry unreachable (${failureLine(r)})` };
}

function parseDistTags(view) {
  try {
    const tags = JSON.parse(view.text);
    return isObject(tags) ? tags : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Desktop artifacts

function globRegex(pattern) {
  return new RegExp('^' + pattern.split('').map(c => (c === '*' ? '[^/]*' : c.replace(/[.+^$()|\\[\]{}?]/g, '\\$&'))).join('') + '$');
}
function desktopArtifacts(ctx, config) {
  const dir = path.join(ctx.repo, config.desktop.dir);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return { dir, found: [], dirMissing: true }; }
  const regexes = config.desktop.patterns.map(globRegex);
  const found = entries.filter(e => e.isFile() && regexes.some(re => re.test(e.name))).map(e => e.name).sort();
  return { dir, found, dirMissing: false };
}
function hashFileOf(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function readHashFile(ctx, config) {
  const file = path.join(ctx.repo, config.desktop.hashFile);
  if (!fs.existsSync(file)) return { missing: true, file };
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { invalid: 'not valid JSON', file }; }
  if (!isObject(data) || data.schema !== HASH_SCHEMA || typeof data.version !== 'string' || !isObject(data.files)
    || !Object.values(data.files).every(v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))) return { invalid: 'wrong shape', file };
  return { data, file };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Subcommands

async function cmdPreflight(ctx, o) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  const fetch = await fetchOrigin(ctx);
  if (fetch.ok) add('fetch', 'pass', 'git fetch --prune origin');
  else add('fetch', 'fail', `git fetch origin failed: ${failureLine(fetch)}`);

  const head = await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = head.ok ? head.stdout.trim() : '';
  const wanted = o.flags['--branch'];
  if (wanted !== undefined && !/^[A-Za-z0-9._/-]+$/.test(wanted)) throw new UsageError('--branch has an invalid form');
  const branchOk = wanted !== undefined ? branch === wanted : new RegExp(o.config.branchPattern).test(branch);
  add('branch', branchOk ? 'pass' : 'fail', branchOk ? `on ${branch}` : `HEAD is ${branch || 'unreadable'}; expected ${wanted ?? `a branch matching ${o.config.branchPattern}`}`);

  let commit = '';
  try { commit = await headCommit(ctx); } catch (error) { add('commit', 'fail', error.message); }

  let ahead = null, behind = null;
  if (branchOk && !fetch.ok) add('sync', 'fail', 'not checked: the fetch failed');
  else if (branchOk) {
    // The tip of the branch on origin is confirmed first (see confirmBranchTip), so an old tracking ref cannot stand in for it.
    let confirmed = null;
    try { await confirmBranchTip(ctx, branch); } catch (error) { if (!(error instanceof StepFailure)) throw error; confirmed = error.message; }
    if (confirmed !== null) add('sync', 'fail', confirmed);
    else {
      const counts = await git(ctx, ['rev-list', '--left-right', '--count', `HEAD...refs/remotes/origin/${branch}`]);
      const parts = counts.stdout.trim().split(/\s+/).map(Number);
      if (counts.ok && parts.length === 2 && parts.every(Number.isInteger)) {
        [ahead, behind] = parts;
        const same = ahead === 0 && behind === 0;
        add('sync', same ? 'pass' : 'fail', same ? `HEAD equals origin/${branch}` : `HEAD is ${ahead} ahead and ${behind} behind origin/${branch}`);
      } else add('sync', 'fail', `origin/${branch} not found; push the branch first`);
    }
  } else add('sync', 'fail', 'not checked: wrong branch');

  const tree = await treeIsClean(ctx);
  add('clean', tree.clean ? 'pass' : 'fail', tree.clean ? 'working tree is clean' : `working tree is not clean: ${tree.first}`);

  const failed = checks.find(c => c.status === 'fail');
  const data = { branch, commit, ahead, behind, checks };
  if (failed) throw new StepFailure(failed.detail, data);
  return done(`preflight passed on ${branch} at ${commit}`, data);
}

async function requireClean(ctx) {
  const tree = await treeIsClean(ctx);
  if (!tree.clean) throw new StepFailure(`working tree is not clean (${tree.first}); run preflight`);
}
function requireFree(ctx, dir, needGiB) {
  const free = freeGiB(ctx.env, dir);
  if (free < needGiB) throw new StepFailure(`free disk is ${free.toFixed(2)} GiB, below the ${needGiB} GiB floor`, { freeGiB: Number(free.toFixed(2)), floorGiB: needGiB });
  return free;
}

/** True for a gate that runs tests: `npm test`, or `npm run` of a script named test or e2e (with an optional suffix such as test:unit). */
const isTestGate = command => command[1] === 'test' || (command[1] === 'run' && /^(?:test|e2e)(?:[:._-].*)?$/.test(command[2]));

/** Why the counts in a passing test step are not acceptable, or null. */
function countsProblem(counts) {
  if (counts === null) return 'no test counts found in the output, so a pass cannot be confirmed';
  if (counts.fail > 0) return `${counts.fail} test${counts.fail === 1 ? '' : 's'} failed although the command exited 0`;
  if (counts.pass === 0) return 'no passing tests were reported';
  return null;
}

async function runGateList(ctx, list, step) {
  if (list.length === 0) throw new StepFailure(`there is no ${step} gate to run`);
  const ran = [];
  for (const [i, gate] of list.entries()) {
    const cwd = path.join(ctx.repo, gate.cwd);
    const [, ...args] = gate.command;
    assertSafeNpmArgs(args);
    const r = await spawnNpm(ctx, args, { cwd, timeoutMs: (gate.timeoutSeconds ?? DEFAULT_GATE_TIMEOUT_S) * 1000, logName: `${step}-${i + 1}-${gate.name}` });
    if (!r.ok) throw new StepFailure(`gate "${gate.name}" failed: ${failureLine(r)}`, { gate: gate.name, log: r.log, gates: ran });
    const entry = { name: gate.name, durationMs: r.durationMs, log: r.log };
    if (isTestGate(gate.command)) {
      const counts = parseCounts(r.all);
      const problem = countsProblem(counts);
      if (problem) throw new StepFailure(`gate "${gate.name}" failed: ${problem}`, { gate: gate.name, log: r.log, gates: ran });
      entry.counts = counts;
    }
    ran.push(entry);
  }
  return ran;
}

async function cmdGates(ctx, o) {
  const floor = minFreeGiB(o.flags);
  const wantE2e = o.flags['--e2e'] === true;
  if (wantE2e && o.config.e2eGates.length === 0) throw new UsageError('--e2e was given but the config has no end-to-end gate (e2eGates is empty)');
  await requireClean(ctx);
  const commit = await headCommit(ctx);
  const existing = o.flags['--force'] ? null : readReceipt(ctx, 'gates', o.version, commit);
  if (existing && (!wantE2e || existing.e2e)) return alreadyDone(`gates passed for ${short(commit)} ${o.version}`, { commit, version: o.version, receipt: existing });
  requireFree(ctx, ctx.repo, floor);
  const list = existing ? o.config.e2eGates : [...o.config.gates, ...(wantE2e ? o.config.e2eGates : [])];
  const ran = await runGateList(ctx, list, 'gates');
  if (await headCommit(ctx) !== commit) throw new StepFailure('HEAD moved while the gates ran; no receipt written');
  const after = await treeIsClean(ctx);
  if (!after.clean) throw new StepFailure(`the gates changed the working tree (${after.first}); no receipt written`);
  const kept = ({ name, durationMs, counts }) => ({ name, durationMs, ...(counts ? { counts } : {}) });
  const receipt = writeReceipt(ctx, 'gates', o.version, commit, { e2e: wantE2e || existing?.e2e === true, gates: [...(existing?.gates ?? []), ...ran].map(kept) });
  return done(`gates passed for ${short(commit)} ${o.version}${existing ? ' (end-to-end added)' : ''}`, { commit, version: o.version, ran: ran.map(g => g.name), receipt });
}

/** Stored in every dry-run receipt. Raise it whenever neverShipReason changes, so a receipt made under the old rules is not "already done". */
const NEVER_SHIP_RULES_VERSION = 1;
/** Environment files that hold no value and may ship inside a bundled package. */
const ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);

/**
 * Why a dry-run receipt no longer agrees with the config, or null: the package, the registry, the dist-tag, the expected file count, and the never-ship rules it was made under.
 * A receipt that disagrees is treated as absent by every step that uses it (dry-run, publish, verify, status). It names the field, never the value (a registry URL can hold a credential).
 */
function dryRunConfigProblem(config, receipt) {
  if (receipt.rulesVersion !== NEVER_SHIP_RULES_VERSION) return 'it was made under other never-ship rules';
  if (receipt.package !== config.package) return 'it is for another package';
  if (receipt.registry !== config.registry) return 'it is for another registry';
  if (receipt.tag !== config.distTag) return 'it is for another dist-tag';
  if (receipt.files !== config.expectedFileCount) return 'its file count is not the expected file count';
  return null;
}

/**
 * Why an entry of the tarball must not ship, or null. The list is the one in tools/cli-distribution/README.md: environment files, a git
 * folder, source maps, type declarations, test folders, and the release state folder. Bundled third-party code under node_modules/ is held
 * to the first three (environment files, .git, .trellis) and not to the rest, because the packages of the closure ship their own
 * declarations, maps, and test folders. A bundled `.env.example`, `.env.sample`, `.env.template`, or `.env.dist` is allowed: it is a template. Pass
 * `bundled` for such an entry.
 */
function neverShipReason(rel, { bundled = false } = {}) {
  const parts = rel.split('/');
  const name = parts[parts.length - 1];
  const folders = parts.slice(0, -1);
  // A bundled package may ship a template that holds no value. Every other .env file is refused, bundled or not.
  const isEnvFile = name === '.env' || name.startsWith('.env.');
  if (isEnvFile && !(bundled && ENV_TEMPLATES.has(name))) return 'an environment file';
  if (parts.includes('.git')) return 'a .git folder';
  if (parts.includes('.trellis')) return 'a .trellis folder';
  if (bundled) return null;
  if (/\.map$/.test(name)) return 'a source map';
  if (/\.d\.[cm]?ts$/.test(name)) return 'a TypeScript declaration';
  if (folders.includes('test') || folders.includes('tests')) return 'a test folder';
  return null;
}

/**
 * Lists the tarball with the `tar` package and checks it. Returns { entries, own, bundled }: the number of file entries, and how many are the
 * package's own and how many are bundled under node_modules/. Throws StepFailure for a link or odd entry, a path that does not belong
 * in a package, or an entry that must never ship.
 */
async function inspectTarball(tarball) {
  let tar;
  try { tar = await import('tar'); } catch { throw new StepFailure('cannot load the tar package, so the tarball cannot be listed; run npm ci in the repository first'); }
  const found = [];
  try { tar.list({ file: tarball, sync: true, strict: true, onReadEntry: entry => { found.push({ path: String(entry.path), type: entry.type }); } }); } catch (error) {
    throw new StepFailure(`the tarball cannot be listed: ${redact(String(error?.message ?? error)).split('\n')[0]}`);
  }
  let own = 0, bundled = 0;
  for (const entry of found) {
    if (entry.type === 'Directory') continue;
    if (entry.type !== 'File') throw new StepFailure(`the tarball holds an entry that is not a plain file: ${entry.path} (${entry.type})`);
    const rel = entry.path.startsWith('package/') ? entry.path.slice('package/'.length) : entry.path;
    if (rel === '' || rel.startsWith('/') || rel.split('/').includes('..')) throw new StepFailure(`the tarball holds an unsafe path: ${entry.path}`);
    const isBundled = rel.startsWith('node_modules/');
    const reason = neverShipReason(rel, { bundled: isBundled });
    if (reason) throw new StepFailure(`the tarball holds ${reason} that must never ship: ${rel}`, { entry: rel });
    if (isBundled) bundled += 1; else own += 1;
  }
  return { entries: own + bundled, own, bundled };
}

async function cmdDryRun(ctx, o) {
  const floor = minFreeGiB(o.flags);
  await requireClean(ctx);
  const commit = await headCommit(ctx);
  if (!readReceipt(ctx, 'gates', o.version, commit)) throw new StepFailure(`no passing gates receipt for ${short(commit)} ${o.version}; run gates first`);
  const existing = o.flags['--force'] ? null : readReceipt(ctx, 'dry-run', o.version, commit);
  // The receipt counts only while it still agrees with the config (the file count, the dist-tag, the package, and the registry it was made for) and with the never-ship rules.
  if (existing && dryRunConfigProblem(o.config, existing) === null && typeof existing.tarball === 'string' && fs.existsSync(existing.tarball) && sha256Hex(fs.readFileSync(existing.tarball)) === existing.sha256) {
    return alreadyDone(`dry run passed for ${short(commit)} ${o.version}`, { commit, version: o.version, ...summary(existing) });
  }
  requireFree(ctx, tmpRoot(ctx), floor + DRY_RUN_EXTRA_GIB);
  const work = makeTemp(ctx, 'bowerloom-release-');
  const stage = path.join(work, 'stage'), output = path.join(work, 'output');
  let keep = false;
  try {
    const packScript = ctx.env.BOWERLOOM_RELEASE_PACK || path.join(ctx.repo, o.config.packScript);
    const pack = await runChild(ctx, { cmd: process.execPath, args: [packScript, '--repo', ctx.repo, '--stage', stage, '--output', output, '--release-candidate'], cwd: ctx.repo, timeoutMs: 1800_000, logName: 'dry-run-pack', env: npmConfigEnv(ctx) });
    if (!pack.ok) throw new StepFailure(`pack failed: ${failureLine(pack)}`, { log: pack.log });
    let info;
    try { info = JSON.parse(pack.stdout); } catch { throw new StepFailure('pack output is not JSON', { log: pack.log }); }
    if (!isObject(info) || typeof info.file !== 'string' || !Number.isInteger(info.files) || !Number.isInteger(info.bytes)) throw new StepFailure('pack output has an unexpected shape', { log: pack.log });
    const tarball = path.resolve(info.file);
    if (path.dirname(tarball) !== output || !fs.existsSync(tarball)) throw new StepFailure('pack reported a tarball outside the output folder, or none');
    const bytes = fs.readFileSync(tarball);
    const sha256 = sha256Hex(bytes);
    if (info.files <= 0) throw new StepFailure('pack reports no files in the tarball');
    if (typeof info.sha256 !== 'string') throw new StepFailure('pack output has no SHA-256 for the tarball');
    if (info.sha256 !== sha256) throw new StepFailure(`tarball SHA-256 differs from the pack report (${sha256} against ${info.sha256})`);
    if (info.bytes !== bytes.length) throw new StepFailure(`pack reports ${info.bytes} bytes; the tarball is ${bytes.length} bytes`);
    const listed = await inspectTarball(tarball);
    const bundleFiles = Number.isInteger(info.bundle?.files) ? info.bundle.files : 0;
    if (listed.own !== info.files || listed.bundled !== bundleFiles) throw new StepFailure(`the tarball holds ${listed.entries} files (${listed.own} of the package, ${listed.bundled} bundled); the pack reported ${info.files + bundleFiles} (${info.files} of the package, ${bundleFiles} bundled)`, { entries: listed.entries });
    if (o.config.expectedFileCount === undefined) throw new StepFailure(`expectedFileCount is not set; run pack once and record the count (pack reported ${info.files} files)`);
    if (info.files !== o.config.expectedFileCount) throw new StepFailure(`tarball holds ${info.files} files; the config expects ${o.config.expectedFileCount}`);
    const publish = await spawnNpm(ctx, ['publish', '--dry-run', tarball, '--tag', o.config.distTag, '--access', 'public'], { cwd: output, timeoutMs: 600_000, logName: 'dry-run-publish' });
    if (!publish.ok) throw new StepFailure(`npm publish --dry-run failed: ${failureLine(publish)}`, { log: publish.log });
    const receipt = writeReceipt(ctx, 'dry-run', o.version, commit, { package: o.config.package, registry: o.config.registry, rulesVersion: NEVER_SHIP_RULES_VERSION, tarball, sha256, integrity: sha512Integrity(bytes), bytes: bytes.length, files: info.files, entries: listed.entries, tag: o.config.distTag });
    keep = true;
    dropTemp(work, { remove: false });
    fs.rmSync(stage, { recursive: true, force: true });
    return done(`dry run passed for ${short(commit)} ${o.version}`, { commit, version: o.version, ...summary(receipt) });
  } finally {
    if (!keep) dropTemp(work);
  }
}
const summary = r => ({ package: r.package, tarball: r.tarball, files: r.files, entries: r.entries, bytes: r.bytes, tag: r.tag, sha256: r.sha256, integrity: r.integrity });

/** A human-only subcommand: prints the commands, refuses without a terminal, never runs them. */
function humanOnly(ctx, name, lines, data = {}) {
  const tty = Boolean(ctx.stdin?.isTTY && ctx.stdout?.isTTY);
  const result = { commands: lines.filter(l => !l.startsWith('#')), notes: lines.filter(l => l.startsWith('#')).map(l => l.replace(/^#\s?/, '')), ...data };
  if (!ctx.json) ctx.stdout.write(lines.join('\n') + '\n');
  if (!tty) return { ok: false, exit: 2, outcome: 'refused', message: `${name} is for a person at a terminal; it printed the commands and ran nothing`, ...result };
  return { ok: true, outcome: 'printed', message: `${name}: commands printed; a person runs them`, ...result };
}

const SHA256_FORM = /^[0-9a-f]{64}$/;
const INTEGRITY_FORM = /^sha512-[A-Za-z0-9+/=]+$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** Checks a dry-run receipt against the tarball on disk. Throws StepFailure on any doubt, so the person never copies a stale hash. */
function checkDryRunTarball(receipt) {
  if (typeof receipt.sha256 !== 'string' || !SHA256_FORM.test(receipt.sha256)) throw new StepFailure('the dry-run receipt SHA-256 is not valid; run dry-run again');
  if (typeof receipt.integrity !== 'string' || !INTEGRITY_FORM.test(receipt.integrity)) throw new StepFailure('the dry-run receipt integrity is not valid; run dry-run again');
  if (typeof receipt.tarball !== 'string' || !path.isAbsolute(receipt.tarball) || CONTROL_CHARS.test(receipt.tarball)) throw new StepFailure('the dry-run receipt tarball path is not an absolute path of plain text; run dry-run again');
  let bytes;
  try { bytes = fs.readFileSync(receipt.tarball); } catch { throw new StepFailure(`tarball ${receipt.tarball} not found; run dry-run again`); }
  if (sha256Hex(bytes) !== receipt.sha256 || sha512Integrity(bytes) !== receipt.integrity) throw new StepFailure('the tarball on disk does not match the dry-run receipt; run dry-run again');
}

async function cmdPublish(ctx, o) {
  const commit = await headCommit(ctx).catch(() => null);
  const receipt = commit ? readReceipt(ctx, 'dry-run', o.version, commit) : null;
  if (!receipt) throw new StepFailure(`no dry-run receipt for ${commit ? short(commit) : 'this commit'} ${o.version}; run dry-run first. No publish command was printed`);
  const stale = dryRunConfigProblem(o.config, receipt);
  if (stale) throw new StepFailure(`the dry-run receipt for ${short(commit)} ${o.version} does not match the config (${stale}); run dry-run again. No publish command was printed`);
  checkDryRunTarball(receipt);
  const tarball = receipt.tarball;
  const expected = typeof o.record.npm?.authenticatedIdentity === 'string' ? o.record.npm.authenticatedIdentity.replace(new RegExp(CONTROL_CHARS.source, 'g'), '') : null;
  const lines = [
    `# Run these yourself. The dry run for ${short(commit)} wrote the tarball below.`,
    `# tarball SHA-256: ${receipt.sha256}`, `# tarball integrity: ${receipt.integrity}`, '# The next line must print the same SHA-256 as the line above. Stop if it does not.', `shasum -a 256 ${shellQuote(tarball)}`,
    `npm whoami --registry ${shellQuote(o.config.registry)}`,
    `# Run npm login only if whoami fails${expected ? ` or does not show ${expected}` : ' or shows the wrong account'}. Enter the password and one-time code at the npm prompt.`,
    `npm login --registry ${shellQuote(o.config.registry)}`,
    `npm publish ${shellQuote(tarball)} --tag ${shellQuote(o.config.distTag)} --access public --registry ${shellQuote(o.config.registry)}`,
  ];
  return humanOnly(ctx, 'publish', lines, { version: o.version, commit });
}

function tagName(o) { return `${o.config.tagPrefix}${o.version}`; }

/**
 * Reads the tag on origin with `git ls-remote`. Returns { ok: true, commit } with commit null when origin has no such tag, or { ok: false, reason }.
 * An annotated tag lists twice: the tag object, and the commit it points at under `^{}`. A lightweight tag lists once.
 */
async function originTagCommit(ctx, tag) {
  const remote = await git(ctx, ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (!remote.ok) return { ok: false, reason: failureLine(remote) };
  const refs = new Map(remote.stdout.split('\n').filter(Boolean).map(line => line.split('\t').reverse()));
  return { ok: true, commit: refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`) ?? null };
}

async function cmdRetire(ctx, o) {
  const { retire, package: pkg, distTag, registry } = o.config;
  if (retire.length === 0) return humanOnly(ctx, 'retire', ['# nothing configured'], { version: o.version });
  const lines = ['# Run these yourself. Log in first with npm login.'];
  for (const item of retire) lines.push(`npm deprecate ${shellQuote(`${pkg}@${item.version}`)} ${shellQuote(item.message)} --registry ${shellQuote(registry)}`);
  lines.push(`# If the ${distTag} tag still points at a retired version, point it at the release again.`, `npm dist-tag add ${shellQuote(`${pkg}@${o.version}`)} ${shellQuote(distTag)} --registry ${shellQuote(registry)}`);
  return humanOnly(ctx, 'retire', lines, { version: o.version });
}

/**
 * True when `name` holds `version` as a whole version: the character before it is not a letter, digit, or dot, and the character after it does
 * not continue the version (no letter or digit, and no dot followed by a digit). A hyphen, underscore, space, a dot before a letter such as the
 * file extension, or the end of the name all end a version. So 0.8.0-beta.21 and 0.8.0-beta.2.1 do not hold 0.8.0-beta.2. When the version has no hyphen
 * (no prerelease part), a hyphen followed by a letter or digit does not end it either, so 0.8.0-beta.2 and 0.8.0-arm64 do not hold 0.8.0.
 */
export function hasVersion(name, version) {
  for (let at = name.indexOf(version); at !== -1; at = name.indexOf(version, at + 1)) {
    const before = name[at - 1] ?? '', after = name.slice(at + version.length, at + version.length + 2);
    if (/[0-9A-Za-z.]/.test(before)) continue;
    if (/^[0-9A-Za-z]/.test(after) || /^\.[0-9]/.test(after)) continue;
    // A version with no prerelease part does not hold a longer one: 0.8.0 is not in 0.8.0-beta.2.
    if (!version.includes('-') && /^-[0-9A-Za-z]/.test(after)) continue;
    return true;
  }
  return false;
}

async function cmdHashes(ctx, o) {
  const { found, dir, dirMissing } = desktopArtifacts(ctx, o.config);
  if (dirMissing) throw new StepFailure(`artifact folder ${o.config.desktop.dir} not found; build the desktop app first`);
  if (found.length === 0) throw new StepFailure(`no files matching ${o.config.desktop.patterns.join(', ')} in ${o.config.desktop.dir}`);
  const stale = found.filter(name => !hasVersion(name, o.version));
  if (stale.length) throw new StepFailure(`every artifact filename must contain the release version ${o.version} (not matching: ${stale.join(', ')}); remove the old installers or build the desktop app for this version first`, { found, stale });
  const files = sorted(Object.fromEntries(found.map(name => [name, hashFileOf(path.join(dir, name))])));
  const existing = readHashFile(ctx, o.config);
  const force = o.flags['--force'] === true;
  if (existing.invalid && !force) throw new StepFailure(`hash file ${o.config.desktop.hashFile} is ${existing.invalid}; fix it or use --force`);
  if (existing.data && !force) {
    if (existing.data.version !== o.version) throw new StepFailure(`hash file is for version ${existing.data.version}, not ${o.version}; use --force to replace it`);
    const different = Object.keys(files).filter(n => existing.data.files[n] !== undefined && existing.data.files[n] !== files[n]);
    if (different.length) throw new StepFailure(`hash differs from the recorded hash for ${different.join(', ')}; use --force to overwrite`, { different });
    if (JSON.stringify(sorted(existing.data.files)) === JSON.stringify(files)) return alreadyDone(`${found.length} desktop hashes are recorded in ${o.config.desktop.hashFile}`, { version: o.version, files });
  }
  // The file is written fresh from the artifacts on disk. Entries of an earlier run are never carried over.
  const out = { schema: HASH_SCHEMA, version: o.version, files };
  writeFileAtomic(existing.file, JSON.stringify(out, null, 2) + '\n', 0o644);
  return done(`wrote ${found.length} desktop hashes to ${o.config.desktop.hashFile}`, { version: o.version, files: out.files });
}
const sorted = obj => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function verifyDesktop(ctx, config, version) {
  const { dir, found, dirMissing } = desktopArtifacts(ctx, config);
  const recorded = readHashFile(ctx, config);
  const detail = { mismatched: [], unrecorded: [], missing: [], matched: [] };
  if (recorded.missing) return { status: 'fail', reason: `hash file ${config.desktop.hashFile} is missing: every artifact is unrecorded`, ...detail, unrecorded: found };
  if (recorded.invalid) return { status: 'fail', reason: `hash file ${config.desktop.hashFile} is ${recorded.invalid}`, ...detail, unrecorded: found };
  if (recorded.data.version !== version) return { status: 'fail', reason: `hash file ${config.desktop.hashFile} is for version ${recorded.data.version}, not ${version}`, ...detail, unrecorded: found };
  if (dirMissing || found.length === 0) return { status: 'fail', reason: `no desktop artifacts found in ${config.desktop.dir}`, ...detail };
  for (const name of found) {
    const want = recorded.data.files[name];
    if (want === undefined) { detail.unrecorded.push(name); continue; }
    if (hashFileOf(path.join(dir, name)) === want) detail.matched.push(name); else detail.mismatched.push(name);
  }
  detail.missing = Object.keys(recorded.data.files).filter(n => !found.includes(n));
  const bad = [];
  if (detail.mismatched.length) bad.push(`hash differs: ${detail.mismatched.join(', ')}`);
  if (detail.unrecorded.length) bad.push(`unrecorded: ${detail.unrecorded.join(', ')}`);
  if (detail.missing.length) bad.push(`recorded but missing on disk: ${detail.missing.join(', ')}`);
  return bad.length ? { status: 'fail', reason: bad.join('; '), ...detail } : { status: 'pass', reason: `${detail.matched.length} artifact hashes match`, ...detail };
}

async function verifyInstall(ctx, config, version) {
  const tmp = makeTemp(ctx, 'bowerloom-verify-');
  try {
    const project = path.join(tmp, 'project'), cache = path.join(tmp, 'cache'), home = path.join(tmp, 'home');
    for (const d of [project, cache, home]) fs.mkdirSync(d);
    const env = { npm_config_cache: cache, npm_config_update_notifier: 'false' };
    const init = await spawnNpm(ctx, ['init', '-y'], { cwd: project, env, timeoutMs: VIEW_TIMEOUT_MS, logName: 'verify-init' });
    if (!init.ok) return { status: 'fail', reason: `npm init failed: ${failureLine(init)}` };
    const install = await spawnNpm(ctx, ['install', `${config.package}@${config.distTag}`, '--ignore-scripts', '--no-audit', '--no-fund', '--registry', config.registry], { cwd: project, env, timeoutMs: INSTALL_TIMEOUT_MS, logName: 'verify-install' });
    if (!install.ok) return { status: 'fail', reason: `npm install ${config.package}@${config.distTag} failed: ${failureLine(install)}` };
    let installed;
    try { installed = JSON.parse(fs.readFileSync(path.join(project, 'node_modules', config.package, 'package.json'), 'utf8')).version; } catch { return { status: 'fail', reason: 'installed package.json not readable' }; }
    if (installed !== version) return { status: 'fail', reason: `installed version is ${installed}, not ${version}` };
    const bin = path.join(project, 'node_modules', '.bin', config.binName);
    for (const flag of ['--version', '--help']) {
      const run = await runChild(ctx, { cmd: bin, args: [flag], cwd: project, env: { HOME: home }, timeoutMs: VIEW_TIMEOUT_MS, logName: `verify-bin${flag}` });
      if (!run.ok) return { status: 'fail', reason: `${config.binName} ${flag} failed: ${failureLine(run)}` };
    }
    return { status: 'pass', reason: `installed ${config.package}@${installed}; ${config.binName} --version and --help exit 0` };
  } finally { dropTemp(tmp); }
}

/**
 * The integrity check. The local side is the --tarball file, else the tarball and integrity in the dry-run receipt. With neither, the check fails:
 * it is never skipped.
 */
async function verifyIntegrity(ctx, o, registryDown) {
  const { config, version } = o;
  let local, source;
  if (o.flags['--tarball'] !== undefined) {
    try { local = sha512Integrity(fs.readFileSync(path.resolve(o.flags['--tarball']))); } catch { return { status: 'fail', reason: `tarball ${o.flags['--tarball']} not readable` }; }
    source = 'the local tarball';
  } else {
    const commit = await headCommit(ctx).catch(() => null);
    // A receipt that no longer agrees with the config counts as absent, on HEAD and on an ancestor alike.
    const agrees = receipt => dryRunConfigProblem(config, receipt) === null;
    const atHead = commit ? readReceipt(ctx, 'dry-run', version, commit) : null;
    const receipt = (atHead && agrees(atHead) && atHead) || await newestReceipt(ctx, 'dry-run', version, 'HEAD', agrees);
    if (!receipt || typeof receipt.integrity !== 'string' || !INTEGRITY_FORM.test(receipt.integrity)) return { status: 'fail', reason: 'no --tarball given and no dry-run receipt found that matches the config; run dry-run, or pass --tarball PATH' };
    local = receipt.integrity;
    source = 'the local tarball';
    if (typeof receipt.tarball === 'string' && fs.existsSync(receipt.tarball)) {
      let onDisk;
      try { onDisk = sha512Integrity(fs.readFileSync(receipt.tarball)); } catch { return { status: 'fail', reason: `dry-run tarball ${receipt.tarball} not readable` }; }
      if (onDisk !== receipt.integrity) return { status: 'fail', reason: `the tarball ${receipt.tarball} differs from the dry-run receipt (${onDisk} against ${receipt.integrity})` };
    } else source = 'the integrity in the dry-run receipt';
  }
  if (registryDown) return { status: 'fail', reason: 'registry unreachable' };
  const view = await npmView(ctx, config, `${config.package}@${version}`, 'dist.integrity');
  if (view.state === 'ok') return view.text === local ? { status: 'pass', reason: `registry integrity equals ${source} (${local})` } : { status: 'fail', reason: `registry integrity ${view.text} differs from the local tarball ${local}` };
  return { status: 'fail', reason: view.state === 'notfound' ? `${config.package}@${version} not found on the registry` : 'registry unreachable' };
}

async function cmdVerify(ctx, o) {
  const { config, version } = o;
  const checks = [];
  const add = (name, c) => checks.push({ name, ...c });
  const tags = await npmView(ctx, config, config.package, 'dist-tags', { json: true });
  let registryDown = false;
  if (tags.state === 'ok') {
    const parsed = parseDistTags(tags);
    if (!parsed) add('dist-tag', { status: 'fail', reason: 'registry answer is not readable' });
    else if (parsed[config.distTag] === version) add('dist-tag', { status: 'pass', reason: `${config.distTag} points at ${version}` });
    else add('dist-tag', { status: 'fail', reason: `${config.distTag} points at ${parsed[config.distTag] ?? 'nothing'}, not ${version}` });
  } else if (tags.state === 'notfound') add('dist-tag', { status: 'fail', reason: `package ${config.package} not found on the registry` });
  else { registryDown = true; add('dist-tag', { status: 'fail', reason: 'registry unreachable' }); }

  add('integrity', await verifyIntegrity(ctx, o, registryDown));

  add('install', registryDown ? { status: 'fail', reason: 'registry unreachable; install not tried' } : await verifyInstall(ctx, config, version));
  add('desktop-sha256', verifyDesktop(ctx, config, version));

  // Every check must pass. A failed or skipped check fails the command, and then no receipt is written.
  const notPassed = checks.filter(c => c.status !== 'pass');
  const data = { version, checks };
  if (notPassed.length) throw new StepFailure(`${notPassed[0].name}: ${notPassed[0].reason}`, data);
  const commit = await headCommit(ctx).catch(() => null);
  if (commit) writeReceipt(ctx, 'verify', version, commit, { checks: checks.map(c => ({ name: c.name, status: c.status })) });
  return done(`verified ${config.package}@${version}`, data);
}

/** True for an absolute path on this computer: `/x/y.git` or `file:///x/y.git`. A URL with a host, such as ssh or https, is not. */
const isLocalPath = url => url.startsWith('/') || url.startsWith('file:///');

/**
 * Before the tag step fetches or pushes anything: the URL that a push uses must be the URL that a fetch uses, so the tag goes to the repository whose branch
 * was checked. Under a test seam, origin must also be a path on this computer, so a test run never reaches a real remote.
 */
async function requireSafeRemote(ctx) {
  // `--all` lists every URL: one fetch URL and one push URL each, and the same one. A second push URL would send the tag to a second place.
  const fetchUrls = await git(ctx, ['remote', 'get-url', '--all', 'origin']);
  if (!fetchUrls.ok) throw new StepFailure(`cannot read the fetch URL of origin: ${failureLine(fetchUrls)}`);
  const pushUrls = await git(ctx, ['remote', 'get-url', '--all', '--push', 'origin']);
  if (!pushUrls.ok) throw new StepFailure(`cannot read the push URL of origin: ${failureLine(pushUrls)}`);
  const lines = result => result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  const fetchList = lines(fetchUrls), pushList = lines(pushUrls);
  for (const url of [...fetchList, ...pushList]) rememberUrl(url);
  // The URLs are never printed: a URL can hold a credential.
  if (fetchList.length !== 1) throw new StepFailure(`origin must have exactly one fetch URL (it has ${fetchList.length}); fix the remote before the tag is pushed`);
  if (pushList.length !== 1) throw new StepFailure(`origin must have exactly one push URL (it has ${pushList.length}); fix the remote before the tag is pushed`);
  if (fetchList[0] !== pushList[0]) throw new StepFailure('push URL differs from fetch URL; set them equal before the tag is pushed');
  if (ctx.seams.length > 0 && !isLocalPath(fetchList[0])) throw new StepFailure(`test seams are active and the origin URL is not a local path (${ctx.seams.join(', ')}); a test run never pushes to a remote`);
}

/** Checks the --branch value of a --commit run. Throws UsageError. */
function checkTagBranch(config, name) {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.includes('..')) throw new UsageError('--branch has an invalid form');
  if (!new RegExp(config.branchPattern).test(name)) throw new UsageError(`--branch ${name} does not match the branchPattern ${config.branchPattern} of the config`);
}

/**
 * Proves that the tracking ref of one branch of origin is the tip of that branch on origin, and returns the ref name. Used by `preflight` (for the checked-out branch) and by
 * `tag --commit` (for the named branch), so a tag never carries history that origin does not hold. A plain `git fetch --prune origin` is not enough: with a narrowed
 * `remote.origin.fetch` it leaves an old tracking ref in place, and it never prunes a ref its refspec does not cover. So this fetches the named branch on its own
 * (`+refs/heads/<branch>:refs/remotes/origin/<branch>`, without hooks), then asks origin for the tip of that branch with `git ls-remote --heads` and needs the tracking ref to equal it.
 * A branch that origin does not have, or a tip that differs, is a failure.
 */
async function confirmBranchTip(ctx, branch) {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new StepFailure('the branch name has an unusual form; no fetch was tried');
  const ref = `refs/remotes/origin/${branch}`;
  const explicit = await gitNoHooks(ctx, ['fetch', '--prune', 'origin', `+refs/heads/${branch}:${ref}`]);
  const heads = await git(ctx, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  if (!heads.ok) throw new StepFailure(`cannot read the branch on origin: ${failureLine(heads)}`);
  const tips = heads.stdout.split('\n').map(line => line.split('\t')).filter(parts => parts[1]?.trim() === `refs/heads/${branch}`).map(parts => parts[0].trim());
  if (tips.length !== 1 || !FULL_HASH.test(tips[0])) throw new StepFailure(`origin has no branch ${branch}; push the branch first`);
  if (!explicit.ok) throw new StepFailure(`git fetch of the branch ${branch} failed: ${failureLine(explicit)}`);
  const known = await git(ctx, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (!known.ok) {
    if (known.code === 1 && !known.timedOut && !known.spawnError) throw new StepFailure(`origin has no branch ${branch}; push the branch first`);
    throw new StepFailure(`git rev-parse failed: ${failureLine(known)}`);
  }
  if (known.stdout.trim() !== tips[0]) throw new StepFailure(`origin/${branch} in this clone (${short(known.stdout.trim())}) is not the tip of the branch on origin (${short(tips[0])}); the fetch did not update it`);
  return ref;
}

/**
 * The --commit path skips preflight, so it must prove the commit is already public before the tag can carry it (and its history) to origin.
 * Fetches with --prune, confirms the tip of the named branch (confirmBranchTip), and needs the commit to be an ancestor of exactly refs/remotes/origin/<branch>.
 * `git merge-base --is-ancestor` answers 0 (yes), 1 (no), or 128 (an error); an error is reported as an error, never as "no".
 */
async function requirePublished(ctx, commit, branch) {
  const fetched = await fetchOrigin(ctx);
  if (!fetched.ok) throw new StepFailure(`git fetch origin failed: ${failureLine(fetched)}`);
  const ref = await confirmBranchTip(ctx, branch);
  const inside = await git(ctx, ['merge-base', '--is-ancestor', commit, ref]);
  if (inside.ok) return;
  if (inside.code === 1 && !inside.timedOut && !inside.capped && !inside.spawnError) throw new StepFailure(`commit ${commit} is not on origin/${branch}; push the branch first`);
  throw new StepFailure(`git merge-base failed: ${failureLine(inside)}`);
}

/**
 * The local tag. Returns { commit } (null when there is no such tag) or { error }. `git show-ref --verify` answers 1 for a tag that is not there and
 * 128 for a ref git cannot read, such as one that names a missing object; only the first is "no tag".
 */
async function localTag(ctx, tag) {
  const ref = `refs/tags/${tag}`;
  const shown = await git(ctx, ['show-ref', '--verify', '--quiet', ref]);
  if (!shown.ok) {
    if (shown.code === 1 && !shown.timedOut && !shown.spawnError) return { commit: null };
    return { error: failureLine(shown) };
  }
  const commit = await git(ctx, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  const hash = commit.stdout.trim();
  if (!commit.ok || !FULL_HASH.test(hash)) return { error: 'the tag does not point at a commit' };
  return { commit: hash };
}

async function cmdTag(ctx, o) {
  let commit = o.flags['--commit'];
  const branch = o.flags['--branch'];
  const tag = tagName(o);
  if (commit !== undefined) {
    if (!FULL_HASH.test(commit)) throw new UsageError('--commit needs a full 40-character lowercase hex hash');
    if (branch === undefined) throw new UsageError('--commit needs --branch NAME: the release branch on origin that holds the commit');
    checkTagBranch(o.config, branch);
  }
  await requireSafeRemote(ctx);
  if (commit !== undefined) {
    const exists = await git(ctx, ['cat-file', '-e', `${commit}^{commit}`]);
    if (!exists.ok) throw new StepFailure(`commit ${commit} not found in this repository`);
    await requirePublished(ctx, commit, branch);
  } else {
    commit = (await cmdPreflight(ctx, o)).commit;
  }
  if (!readReceipt(ctx, 'gates', o.version, commit)) throw new StepFailure(`no passing gates receipt for ${short(commit)} ${o.version}; run gates on that commit first`);
  // The package must be on the registry, and verify must have said so, before the tag can name the release.
  if (!await newestReceipt(ctx, 'verify', o.version, commit, verifyPassed)) throw new StepFailure(`no passing verify receipt for ${short(commit)} ${o.version}; run verify first (the package must be published and verified before the tag)`);
  const local = await localTag(ctx, tag);
  if (local.error) throw new StepFailure(`cannot read the local tag ${tag}: ${local.error}`, { tag, commit });
  const localCommit = local.commit;
  if (localCommit && localCommit !== commit) throw new StepFailure(`tag ${tag} exists at ${short(localCommit)}, not ${short(commit)}`, { tag, commit, existing: localCommit });
  // Look at origin before any write, so a tag that origin already holds elsewhere is never overwritten and no local tag is made beside it.
  const remote = await originTagCommit(ctx, tag);
  if (!remote.ok) throw new StepFailure(`cannot read the tag on origin: ${remote.reason}`, { tag, commit });
  if (remote.commit && remote.commit !== commit) throw new StepFailure(`origin has ${tag} at ${short(remote.commit)}, not ${short(commit)}; it was not overwritten`, { tag, commit, existing: remote.commit });
  if (remote.commit && !localCommit) throw new StepFailure(`origin has ${tag} at ${short(commit)} but this clone has no such tag; run git fetch origin tag ${tag}`, { tag, commit });
  if (localCommit && remote.commit) return alreadyDone(`tag ${tag} exists at ${short(commit)} and is on origin`, { tag, commit, version: o.version });
  if (!localCommit) {
    const made = await gitNoHooks(ctx, ['tag', '-a', '-m', `${o.config.package} ${o.version}`, '--', tag, commit]);
    if (!made.ok) throw new StepFailure(`git tag failed: ${failureLine(made)}`);
  }
  // One tag, by its full ref name. No --force, no --tags, no branch. Git refuses to move a tag that origin already has.
  // `-c push.followTags=false` keeps a user's config from carrying other annotated tags along. No repository hook runs (core.hooksPath=/dev/null for the push and the local tag, --no-verify for the push), and no submodule is pushed.
  const pushed = await gitNoHooks(ctx, ['-c', 'push.followTags=false', 'push', '--no-verify', '--no-recurse-submodules', 'origin', `refs/tags/${tag}`]);
  if (!pushed.ok) throw new StepFailure(`git push failed: ${failureLine(pushed)}`, { tag, commit });
  return done(`${localCommit ? 'pushed' : 'created and pushed'} tag ${tag} at ${short(commit)} to origin`, { tag, commit, version: o.version });
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const MAX_CLAIM_FILE_BYTES = 2 * 2 ** 20;
/** Yields the relative path of each file under `rel`. A symlink is not followed: it goes on `skipped`. */
function* walkFiles(root, rel, skipped) {
  const full = path.join(root, rel);
  const info = fs.lstatSync(full);
  if (info.isSymbolicLink()) { skipped.push({ file: rel, reason: 'symlink' }); return; }
  if (info.isFile()) { yield rel; return; }
  if (!info.isDirectory()) return;
  for (const name of fs.readdirSync(full).sort()) if (!SKIP_DIRS.has(name)) yield* walkFiles(root, rel === '' ? name : `${rel}/${name}`, skipped);
}

/**
 * Lower-cases `text` and folds every run of whitespace to one space. Returns the folded text and, for each character of it, the offset of the
 * character it came from in `text`, so that a match can be reported at the line where it starts.
 */
function foldText(text) {
  let folded = '';
  const origin = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace) { folded += ' '; origin.push(i); }
      inSpace = true;
      continue;
    }
    inSpace = false;
    for (const lower of ch.toLowerCase()) { folded += lower; origin.push(i); }
  }
  return { folded, origin };
}
const foldPattern = pattern => foldText(pattern).folded.trim();

/** The 1-based lines on which a match of any folded pattern starts. A match may wrap across lines; the line is where it starts. */
function claimLines(text, patterns) {
  const { folded, origin } = foldText(text);
  const lines = new Set();
  for (const pattern of patterns) {
    if (pattern === '') continue;
    for (let at = folded.indexOf(pattern); at !== -1; at = folded.indexOf(pattern, at + 1)) {
      let line = 1;
      for (let i = 0; i < origin[at]; i++) if (text.charCodeAt(i) === 10) line += 1;
      lines.add(line);
    }
  }
  return [...lines].sort((x, y) => x - y);
}

async function cmdClaims(ctx, o) {
  const { paths, patterns } = o.config.claims;
  if (paths.length === 0 || patterns.length === 0) throw new UsageError('config: claims needs at least one path and one pattern');
  const folded = patterns.map(foldPattern);
  const hits = [];
  const missing = [];
  const skipped = [];
  let scanned = 0;
  for (const rel of paths) {
    try { fs.lstatSync(path.join(ctx.repo, rel)); } catch { missing.push(rel); continue; }
    for (const file of walkFiles(ctx.repo, rel, skipped)) {
      const full = path.join(ctx.repo, file);
      if (fs.statSync(full).size > MAX_CLAIM_FILE_BYTES) { skipped.push({ file, reason: 'over 2 MiB' }); continue; }
      const buffer = fs.readFileSync(full);
      if (buffer.subarray(0, 8192).includes(0)) { skipped.push({ file, reason: 'binary' }); continue; }
      scanned += 1;
      for (const line of claimLines(buffer.toString('utf8'), folded)) hits.push(`${file}:${line}`);
    }
  }
  const data = { hits, scanned, skipped };
  // A file that was not read is a file that was not checked, so any skipped file is a failure, not a pass.
  const problems = [];
  if (missing.length) problems.push(`claims path not found: ${missing.join(', ')}`);
  if (hits.length) problems.push(`${hits.length} stale claim${hits.length === 1 ? '' : 's'} found in ${scanned} file${scanned === 1 ? '' : 's'} scanned`);
  if (skipped.length) problems.push(`${skipped.length} file${skipped.length === 1 ? '' : 's'} not scanned (${skipped.slice(0, 5).map(x => `${x.file}: ${x.reason}`).join('; ')}${skipped.length > 5 ? `; and ${skipped.length - 5} more` : ''})`);
  if (scanned === 0 && !missing.length) problems.push('claims scanned 0 files; nothing was checked');
  if (problems.length) throw new StepFailure(problems.join('; '), missing.length ? { ...data, missing } : data);
  return done(`no stale claims: ${scanned} file${scanned === 1 ? '' : 's'} scanned`, data);
}

/** The state word of a phase that rests on a receipt. A receipt written under test seams is never `done`. */
const receiptState = receipt => (hasSeams(receipt) ? 'done (with test seams)' : 'done');

async function cmdStatus(ctx, o) {
  const { config, version, record } = o;
  const phases = [];
  const add = (phase, state, reason) => phases.push({ phase, state, reason });
  const commit = await headCommit(ctx).catch(() => null);
  const tag = tagName(o);
  const claimedPublished = record.npm?.published === true;
  const notOnRegistry = what => (claimedPublished
    ? ['unknown', `the registry says ${what} is not there, but ${config.releaseRecord} says npm.published is true`]
    : ['todo', `${what} is not on the registry`]);

  const recordDone = record.state === 'published' && claimedPublished;
  add('record', recordDone ? 'done' : 'todo', `${config.releaseRecord} says state ${JSON.stringify(record.state)}, npm.published ${JSON.stringify(record.npm?.published)}`);

  const tree = commit ? await treeIsClean(ctx).catch(() => null) : null;
  for (const [step, label] of [['gates', 'gates'], ['dry-run', 'dry run']]) {
    if (!commit) { add(step, 'unknown', 'cannot read HEAD'); continue; }
    const receipt = readReceipt(ctx, step, version, commit, { raw: true });
    if (!receipt) { add(step, 'todo', `no ${label} receipt for ${short(commit)} ${version}`); continue; }
    if (!tree) { add(step, 'unknown', 'cannot read the working tree'); continue; }
    if (!tree.clean) { add(step, 'todo', `${label} receipt exists, but the working tree is not clean (${tree.first})`); continue; }
    if (step === 'dry-run') {
      const stale = dryRunConfigProblem(config, receipt);
      if (stale) { add(step, 'todo', `${label} receipt exists, but it does not match the config (${stale}); run dry-run again`); continue; }
      let intact = false;
      try { intact = typeof receipt.tarball === 'string' && sha256Hex(fs.readFileSync(receipt.tarball)) === receipt.sha256; } catch { /* the tarball is gone */ }
      if (!intact) { add(step, 'todo', `${label} receipt exists, but its tarball is gone or changed`); continue; }
    }
    add(step, receiptState(receipt), `receipt for ${short(commit)} written ${receipt.at}`);
  }

  const tags = await npmView(ctx, config, config.package, 'dist-tags', { json: true });
  if (tags.state === 'unreachable') {
    add('publish', 'unknown', tags.reason);
    add('dist-tag', 'unknown', tags.reason);
  } else if (tags.state === 'notfound') {
    const [state, reason] = notOnRegistry(config.package);
    add('publish', state, reason);
    add('dist-tag', state, reason);
  } else {
    const view = await npmView(ctx, config, `${config.package}@${version}`, 'version');
    if (view.state === 'ok') add('publish', view.text === version ? 'done' : 'unknown', view.text === version ? `${config.package}@${version} is on the registry` : `registry answered ${view.text}`);
    else if (view.state === 'notfound') add('publish', ...notOnRegistry(`${config.package}@${version}`));
    else add('publish', 'unknown', view.reason);
    const parsed = parseDistTags(tags);
    if (!parsed) add('dist-tag', 'unknown', 'registry answer is not readable');
    else add('dist-tag', parsed[config.distTag] === version ? 'done' : 'todo', `${config.distTag} points at ${parsed[config.distTag] ?? 'nothing'}`);
  }

  try {
    const desktop = JSON.parse(fs.readFileSync(path.join(ctx.repo, config.desktop.packageJson), 'utf8'));
    add('desktop-version', desktop.version === version ? 'done' : 'todo', `${config.desktop.packageJson} is ${desktop.version}, release is ${version}`);
  } catch { add('desktop-version', 'unknown', `${config.desktop.packageJson} not readable`); }

  const artifacts = desktopArtifacts(ctx, config);
  const recorded = readHashFile(ctx, config);
  if (recorded.invalid) add('hashes', 'todo', `${config.desktop.hashFile} is ${recorded.invalid}`);
  else if (recorded.missing) add('hashes', 'todo', `${config.desktop.hashFile} does not exist`);
  else if (recorded.data.version !== version) add('hashes', 'todo', `${config.desktop.hashFile} is for ${recorded.data.version}`);
  else if (artifacts.found.length === 0) add('hashes', 'unknown', 'no desktop artifacts on disk to compare');
  else {
    // Done only when the recorded hashes equal the files on disk, in both directions.
    const check = verifyDesktop(ctx, config, version);
    add('hashes', check.status === 'pass' ? 'done' : 'todo', check.reason);
  }

  // The same receipt lookup as `tag` (the newest passing verify receipt on HEAD or on an ancestor of HEAD). Status is a report: `tag` checks everything again, and `tag --commit` also needs the commit on a named branch of origin.
  const passingVerify = commit ? await newestReceipt(ctx, 'verify', version, 'HEAD', verifyPassed, { raw: true }) : null;
  const verifyAtHead = commit ? readReceipt(ctx, 'verify', version, commit, { raw: true }) : null;
  if (passingVerify) add('verify', receiptState(passingVerify), `passed ${passingVerify.at}${passingVerify.commit === commit ? '' : ` on ${short(passingVerify.commit)}, an ancestor of HEAD`}`);
  else add('verify', 'todo', verifyAtHead ? 'the verify receipt for this commit holds a check that did not pass' : 'no passing verify receipt for this commit or an ancestor of it');

  // A dry-run receipt that no longer agrees with the config does not name a release commit.
  const agreesWithConfig = receipt => dryRunConfigProblem(config, receipt) === null;
  const local = await localTag(ctx, tag);
  const localCommit = local.commit ?? null;
  const remote = await originTagCommit(ctx, tag);
  // The tag phase is done only when origin has the tag at the release commit. A tag that only this clone holds is todo, and the reason says so.
  if (local.error) add('tag', 'unknown', `cannot read the local tag ${tag}: ${local.error}`);
  else if (!localCommit) add('tag', 'todo', `${tag} does not exist locally`);
  else {
    // The release commit is HEAD, or the commit of the dry run that made the published tarball.
    const dry = await newestDryRun(ctx, version, agreesWithConfig);
    const releaseCommits = [commit, dry?.commit].filter(Boolean);
    const atRelease = releaseCommits.includes(localCommit);
    if (!atRelease) add('tag', 'todo', `${tag} is at ${short(localCommit)}, not at the release commit ${commit ? short(commit) : 'unknown'}${remote.ok && !remote.commit ? ' (local only)' : ''}`);
    else if (!remote.ok) add('tag', 'unknown', `${tag} at ${short(localCommit)}; cannot reach origin to see whether it is there: ${remote.reason}`);
    else if (!remote.commit) add('tag', 'todo', `${tag} at ${short(localCommit)} (local only); origin does not have it`);
    else if (remote.commit !== localCommit) add('tag', 'todo', `${tag} at ${short(localCommit)}; origin has it at ${short(remote.commit)}`);
    else add('tag', 'done', `${tag} at ${short(localCommit)}, also on origin`);
  }
  {
    if (!remote.ok) add('tag-on-origin', 'unknown', `cannot reach origin: ${remote.reason}`);
    else if (!remote.commit) add('tag-on-origin', 'todo', localCommit ? `${tag} is not on origin` : `${tag} is not on origin and there is no local tag`);
    else if (localCommit) {
      if (remote.commit === localCommit) add('tag-on-origin', 'done', `${tag} is on origin at ${short(localCommit)}`);
      else add('tag-on-origin', 'todo', `origin has ${tag} at ${short(remote.commit)}, not at ${short(localCommit)}`);
    } else {
      // No local tag: compare origin with the release commit instead.
      const dry = await newestDryRun(ctx, version, agreesWithConfig);
      const releaseCommits = [commit, dry?.commit].filter(Boolean);
      if (releaseCommits.includes(remote.commit)) add('tag-on-origin', 'done', `${tag} exists on origin at ${short(remote.commit)}; this clone has no local tag, run git fetch origin tag ${tag}`);
      else add('tag-on-origin', 'todo', `origin has ${tag} at ${short(remote.commit)}, not at the release commit ${commit ? short(commit) : 'unknown'}; this clone has no local tag`);
    }
  }
  return done(`${phases.filter(p => p.state === 'done').length} of ${phases.length} phases done`, { version, commit, phases });
}

const HANDLERS = { status: cmdStatus, preflight: cmdPreflight, gates: cmdGates, 'dry-run': cmdDryRun, publish: cmdPublish, hashes: cmdHashes, verify: cmdVerify, tag: cmdTag, retire: cmdRetire, claims: cmdClaims };

// ---------------------------------------------------------------------------------------------------------------------------------
// Output

export function helpText() {
  const width = Math.max(...COMMANDS.map(c => c.name.length));
  const rows = COMMANDS.map(c => `  ${c.name.padEnd(width)}  [${c.class}]  ${c.description}`);
  return [
    'Usage: node scripts/release.mjs <subcommand> [flags]',
    '',
    'Subcommands:',
    ...rows,
    '',
    'Flags: --json  --repo DIR  --branch NAME  --min-free-gib N  --e2e  --tarball PATH  --commit HASH  --help  --manifest',
    '       --force works only with gates, dry-run, and hashes.',
    'Exit codes: 0 pass, 1 a check failed, 2 wrong use. A human-only subcommand only prints commands: exit 0 at a terminal, exit 2 without one.',
    'See docs/releasing.md.',
    '',
  ].join('\n');
}
export const manifest = () => ({ schema: 'bowerloom/release-manifest/v1', commands: COMMANDS.map(({ name, class: cls, description }) => ({ name, class: cls, description })) });

function renderHuman(result) {
  if (result.outcome === 'printed' || result.outcome === 'refused' && result.commands) {
    return [`${result.ok ? 'ok' : 'refused'}: ${result.message}`];
  }
  const lines = [`${result.ok ? 'ok' : result.outcome === 'usage' ? 'usage error' : 'FAIL'}: ${result.command ? result.command + ': ' : ''}${result.message}`];
  for (const p of result.phases ?? []) lines.push(`  ${p.state.padEnd(7)} ${p.phase.padEnd(16)} ${p.reason}`);
  for (const c of result.checks ?? []) lines.push(`  ${c.status.padEnd(7)} ${c.name.padEnd(16)} ${c.reason ?? c.detail ?? ''}`);
  for (const h of result.hits ?? []) lines.push(`  ${h}`);
  for (const k of result.skipped ?? []) if (k.file) lines.push(`  skipped ${k.file} (${k.reason})`);
  if (result.log) lines.push(`  log: ${result.log}`);
  if (result.commit && !result.phases) lines.push(`  commit: ${result.commit}`);
  if (result.sha256) lines.push(`  package ${result.package}@${result.version}, ${result.files} files, ${result.bytes} bytes, tag ${result.tag}`, `  sha256:    ${result.sha256}`, `  integrity: ${result.integrity}`, `  tarball:   ${result.tarball}`);
  return lines;
}

/**
 * Runs the CLI. `ctx` = { env, stdin, stdout, stderr }. Returns the exit code and never throws.
 */
export async function runCli(argv, ctx) {
  const wantsJson = jsonWanted(argv);
  // The test seams of this run, once they are known. Every JSON result then lists them, so a reader of one result can tell a test run from a real one.
  let activeSeams = [];
  const emit = result => {
    const out = { schema: RESULT_SCHEMA, ...result, ...(activeSeams.length ? { seams: activeSeams } : {}) };
    if (wantsJson) ctx.stdout.write(JSON.stringify(out) + '\n');
    else for (const line of renderHuman(out)) (out.ok || out.outcome === 'printed' ? ctx.stdout : ctx.stderr).write(line + '\n');
    return out.exit;
  };
  let parsed;
  try { parsed = parseArgs(argv); } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return emit({ command: null, ok: false, outcome: 'usage', exit: 2, message: error.message });
  }
  if (parsed.help) {
    if (wantsJson) ctx.stdout.write(JSON.stringify({ schema: RESULT_SCHEMA, command: null, ok: true, outcome: 'help', exit: 0, message: 'usage and subcommand table', usage: helpText(), commands: manifest().commands }) + '\n');
    else ctx.stdout.write(helpText());
    return 0;
  }
  if (parsed.manifest) { ctx.stdout.write(JSON.stringify(manifest(), null, 2) + '\n'); return 0; }

  const name = parsed.command.name;
  let run = null;
  try {
    const repoFlag = parsed.flags['--repo'];
    const repo = repoFlag ? fs.realpathSync(path.resolve(repoFlag)) : DEFAULT_REPO;
    const config = loadConfig(repo);
    const { version, record } = loadVersion(repo, config);
    const seams = detectSeams(ctx.env, repo);
    activeSeams = seams;
    run = { ...ctx, repo, config, json: wantsJson, seams, temps: [] };
    if (seams.length) ctx.stderr.write(`WARNING: test seams active (${seams.join(', ')}); this is not a real release run, and its receipts do not count as real\n`);
    const result = await HANDLERS[name](run, { flags: parsed.flags, config, version, record });
    const exit = result.exit ?? (result.ok ? 0 : 1);
    return emit({ command: name, ...result, exit, version: result.version ?? version });
  } catch (error) {
    if (error instanceof UsageError) return emit({ command: name, ok: false, outcome: 'usage', exit: 2, message: error.message });
    if (error instanceof StepFailure) return emit({ command: name, ok: false, outcome: 'failed', exit: 1, message: error.message, ...error.data });
    if (error?.code === 'ENOENT' && parsed.flags['--repo'] && run === null) return emit({ command: name, ok: false, outcome: 'usage', exit: 2, message: `--repo ${parsed.flags['--repo']} not found` });
    return emit({ command: name, ok: false, outcome: 'failed', exit: 1, message: `unexpected error: ${redact(error?.message ?? String(error), ctx.env)}` });
  } finally {
    for (const dir of run?.temps ?? []) if (tempFolders.has(dir)) { try { dropTemp(dir); } catch { /* a folder that will not go must not change the exit code */ } }
  }
}

/** Says whether this file is the program that node started: 'main', 'imported', or 'mismatch' (a different file that carries this file's name). */
export function entryState(argv1, script) {
  if (!argv1) return 'imported';
  let real = null;
  try { real = fs.realpathSync(argv1); } catch { /* the path does not exist */ }
  if (real === script) return 'main';
  return path.basename(argv1) === path.basename(script) ? 'mismatch' : 'imported';
}

const entry = entryState(process.argv[1], SCRIPT);
if (entry === 'main') {
  installSignalHandlers();
  process.exitCode = await runCli(process.argv.slice(2), { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr });
} else if (entry === 'mismatch') {
  process.stderr.write(`${path.basename(SCRIPT)}: the program started as ${process.argv[1]} is not this script (${SCRIPT}); it did nothing\n`);
  process.exitCode = 2;
}
