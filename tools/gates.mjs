#!/usr/bin/env node
// Release and lane tooling, never shipped. Safety class: local-write (writes logs under .trellis/gates, and with --clean or --clean-installers removes build outputs).
// Runs the repository gates in order and reports a short summary, so an agent never reads a long log:
//   node tools/gates.mjs [--only NAME,NAME] [--e2e] [--build] [--clean] [--clean-installers] [--min-free-gib N] [--json]
// Flags: --only NAMES (run just these steps); --e2e (add desktop-e2e, under the machine-wide lock); --build (add desktop-build); --clean (remove the build
// outputs afterwards, root dist included); --clean-installers (also remove apps/desktop/release, the installers, after `release verify` has passed; it refuses unless
// release/desktop-sha256.json exists, names the same version as release/beta.json, and records the real SHA-256 of every installer in the folder); --min-free-gib N (raise the
// free-disk floor); --json (one JSON object on stdout, also for a usage error); --help. Test seams, refused unless BOWERLOOM_TOOLS_TEST_MODE=1: --root,
// --lock-dir, --timeout-seconds. A flag that takes no value rejects one: --clean=false is a usage error.
// Steps: root-typecheck, root-test, desktop-typecheck, desktop-test, then desktop-e2e (only with --e2e) and desktop-build (only with --build).
// It stops at the first failing step. A test or e2e step also fails when it exits 0 but prints no test summary, shows failures, or ran no passing test.
// Each step's full log is written, with secrets redacted, to .trellis/gates/<step>.log (mode 0600; .trellis/ is git-ignored). Steps run with empty npm
// config files, so the user's ~/.npmrc (and any registry token in it) is never read.
// Exit 0: every step passed. Exit 1: a step failed, or the run was refused (low disk, e2e lock held), or a clean-up path was refused (a symlink, or an installer folder
// the hash file does not cover). Exit 2: wrong use, or an internal error
// (with --json, one object {ok:false, exit:2, error}). Exit 130: interrupted; the child process groups are stopped and the lock is released.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIB, freeBytes, runChild } from './lib/run-child.mjs';
import { parseCounts, firstFailure } from './lib/output-parse.mjs';
import { emptyNpmConfigEnv, redact } from './lib/safe-env.mjs';
import { splitFlag, jsonWanted, seamRefusal, boolValueRefusal, flagLikeValueRefusal, reportUsage, guarded, entryState, mismatchMessage } from './lib/cli.mjs';
import { installInterruptHandlers, onInterrupt } from './lib/interrupt.mjs';

export const DEFAULT_FLOOR_GIB = 12;
// The machine-wide e2e lock: a folder that one process makes and removes (see tools/docs-visuals/lock.mjs and apps/desktop/README.md).
export const DEFAULT_LOCK_DIR = '/tmp/bowerloom-test.lock';
const MAX_LOG_BYTES = 32 * 1024 * 1024;
const MINUTE = 60_000;

/** The steps, in run order. `optional` names the flag that switches a step on. `expectCounts` marks a test step, which must print a summary with passing tests. */
export const STEPS = Object.freeze([
  { name: 'root-typecheck', command: ['npm', 'run', 'typecheck'], cwd: '.', timeoutMs: 10 * MINUTE, optional: null, expectCounts: false },
  { name: 'root-test', command: ['npm', 'test'], cwd: '.', timeoutMs: 45 * MINUTE, optional: null, expectCounts: true },
  { name: 'desktop-typecheck', command: ['npm', 'run', 'typecheck'], cwd: 'apps/desktop', timeoutMs: 10 * MINUTE, optional: null, expectCounts: false },
  { name: 'desktop-test', command: ['npm', 'test'], cwd: 'apps/desktop', timeoutMs: 30 * MINUTE, optional: null, expectCounts: true },
  { name: 'desktop-e2e', command: ['npm', 'run', 'e2e'], cwd: 'apps/desktop', timeoutMs: 30 * MINUTE, optional: 'e2e', expectCounts: true },
  { name: 'desktop-build', command: ['npm', 'run', 'build'], cwd: 'apps/desktop', timeoutMs: 30 * MINUTE, optional: 'build', expectCounts: false },
]);

/** The only paths --clean may remove, relative to the repository root. Root `dist` is there because a root `npm test` writes it. The installers are not among them. */
export const CLEAN_PATHS = Object.freeze(['apps/desktop/.build', 'apps/desktop/dist', 'apps/desktop/test-results', 'test-results', 'dist']);
/** The installer folder, removed only by --clean-installers, and only when the hash file covers every installer in it. */
export const INSTALLER_PATHS = Object.freeze(['apps/desktop/release']);
/** The hash file that `release hashes` writes: { schema, version, files: { name: sha256 } }. The release record names the version it must match. */
export const HASH_SCHEMA = 'bowerloom/desktop-hashes/v1';
const HASH_FILE = 'release/desktop-sha256.json';
const RELEASE_RECORD = 'release/beta.json';
/** The files in the installer folder that the hash file must cover (the patterns in release.config.json: *.dmg, *.zip). */
const INSTALLER_NAME = /\.(?:dmg|zip)$/;

const USAGE = `Usage: node tools/gates.mjs [--only NAME,NAME] [--e2e] [--build] [--clean] [--clean-installers] [--min-free-gib N] [--json]
  --only NAMES        run only these steps: ${STEPS.map(s => s.name).join(', ')}
                      (with --e2e or --build, --only must name desktop-e2e or desktop-build too)
  --e2e               also run desktop-e2e, under the machine-wide lock ${DEFAULT_LOCK_DIR}; refuses if the lock is held
  --build             also run desktop-build (electron-builder; heavy)
  --clean             after the run, remove the build outputs: ${CLEAN_PATHS.join(', ')}
  --clean-installers  after the run, also remove ${INSTALLER_PATHS.join(', ')} (the installers). Clean them after \`release verify\` has passed:
                      it refuses unless ${HASH_FILE} exists, has the version of ${RELEASE_RECORD}, and records the real SHA-256 of every installer
  --min-free-gib N    raise the free-disk floor above ${DEFAULT_FLOOR_GIB} GiB (it can never be lowered)
  --json              print one JSON object on stdout (also for a usage error: {ok:false, exit:2, error})
  Test seams, refused unless BOWERLOOM_TOOLS_TEST_MODE=1 is set:
  --timeout-seconds N lower every step's time limit to N seconds (it can never be raised)
  --root DIR          run against another repository root (absolute path of an existing folder)
  --lock-dir DIR      use another lock folder (absolute path)
A flag that takes no value rejects one: --clean=false is a usage error.
Exit 0: every step passed. Exit 1: a step failed, the run was refused, or a clean-up path was refused. Exit 2: wrong use. Exit 130: interrupted.`;

/** Reads the command line. Returns an object with `usage` (a message) for wrong use, or `help: true`. `env` decides whether the test seams are allowed. */
export function parseArgs(argv, env = process.env) {
  const out = { help: false, usage: null, only: null, e2e: false, build: false, clean: false, cleanInstallers: false, json: false, floorGiB: DEFAULT_FLOOR_GIB, timeoutSeconds: null, root: null, lockDir: DEFAULT_LOCK_DIR };
  const known = new Set(STEPS.map(s => s.name));
  const bad = message => { out.usage = message; return out; };
  const BOOLEAN = { '--help': 'help', '-h': 'help', '--json': 'json', '--e2e': 'e2e', '--build': 'build', '--clean': 'clean', '--clean-installers': 'cleanInstallers' };
  const SEAMS = new Set(['--timeout-seconds', '--root', '--lock-dir']);
  for (let i = 0; i < argv.length; i++) {
    const { flag, value: inline } = splitFlag(argv[i]);
    if (Object.hasOwn(BOOLEAN, flag)) {
      const refusal = boolValueRefusal(flag, inline);
      if (refusal) return bad(refusal);
      out[BOOLEAN[flag]] = true;
      continue;
    }
    if (!['--only', '--min-free-gib', ...SEAMS].includes(flag)) return bad(`unknown argument: ${argv[i]}`);
    const seam = SEAMS.has(flag) ? seamRefusal(flag, env) : null;
    if (seam) return bad(seam);
    const flagLike = flagLikeValueRefusal(flag, inline);
    if (flagLike) return bad(flagLike);
    const take = () => { if (inline !== null) return inline; const next = argv[i + 1]; if (next === undefined || next.startsWith('--')) return null; i++; return next; };
    switch (flag) {
      case '--only': {
        const names = (take() ?? '').split(',').map(name => name.trim()).filter(Boolean);
        if (names.length === 0) return bad('--only needs step names');
        const unknown = names.filter(name => !known.has(name));
        if (unknown.length) return bad(`unknown step: ${unknown.join(', ')}. Steps: ${[...known].join(', ')}`);
        out.only = names; break;
      }
      case '--min-free-gib': {
        const raw = take();
        const number = raw === null ? NaN : Number(raw);
        if (!Number.isFinite(number) || number <= 0) return bad('--min-free-gib needs a positive number');
        if (number < DEFAULT_FLOOR_GIB) return bad(`--min-free-gib can only raise the floor above ${DEFAULT_FLOOR_GIB} GiB`);
        out.floorGiB = number; break;
      }
      case '--timeout-seconds': {
        const raw = take();
        if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return bad('--timeout-seconds needs a whole number above 0');
        out.timeoutSeconds = Number(raw); break;
      }
      case '--root': case '--lock-dir': {
        const raw = take();
        if (raw === null || !path.isAbsolute(raw)) return bad(`${flag} needs an absolute path`);
        out[flag === '--root' ? 'root' : 'lockDir'] = raw; break;
      }
    }
  }
  if (out.help) return out;
  if (out.only?.includes('desktop-e2e') && !out.e2e) return bad('desktop-e2e runs only with --e2e');
  if (out.only?.includes('desktop-build') && !out.build) return bad('desktop-build runs only with --build');
  if (out.only && out.e2e && !out.only.includes('desktop-e2e')) return bad('--e2e with --only needs desktop-e2e in the --only list');
  if (out.only && out.build && !out.only.includes('desktop-build')) return bad('--build with --only needs desktop-build in the --only list');
  return out;
}

/** The steps this run will execute, in run order. */
export function selectSteps(args) {
  return STEPS.filter(step => (step.optional === null || args[step.optional]) && (args.only === null || args.only.includes(step.name)));
}

function treeBytes(target) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of fs.readdirSync(target)) total += treeBytes(path.join(target, entry));
  return total;
}

/**
 * Removes the build outputs listed in `paths` (default CLEAN_PATHS) under `root`, and nothing else. A path that is a symlink, or whose real path is not
 * exactly its own path under the real root (a linked folder anywhere on the way), is refused and left alone. A failure on one path is recorded in
 * `error` and the other paths are still handled. Returns { removed: [{ path, bytes }], refused: [{ path, reason }], freedBytes, error }.
 */
export function cleanOutputs(root, paths = CLEAN_PATHS) {
  const removed = [], refused = [];
  let freedBytes = 0, error = null;
  const note = (rel, cause) => { error = (error ? error + '; ' : '') + `${rel}: ${cause.code ?? cause.message}`; };
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch (cause) { return { removed, refused, freedBytes, error: `root: ${cause.code ?? cause.message}` }; }
  for (const rel of paths) {
    try {
      const target = path.join(realRoot, ...rel.split('/'));
      let stat;
      try { stat = fs.lstatSync(target); } catch (cause) { if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') continue; throw cause; }
      if (stat.isSymbolicLink()) { refused.push({ path: rel, reason: 'is a symlink' }); continue; }
      const real = fs.realpathSync(target);
      if (real !== target) { refused.push({ path: rel, reason: 'resolves outside its own path under the repository root (a linked folder)' }); continue; }
      const bytes = treeBytes(real);
      fs.rmSync(real, { recursive: true, force: true });
      removed.push({ path: rel, bytes });
      freedBytes += bytes;
    } catch (cause) { note(rel, cause); }
  }
  return { removed, refused, freedBytes, error };
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

const readJson = file => { try { return { data: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (error) { return error.code === 'ENOENT' ? { missing: true } : { invalid: true }; } };

/**
 * Says whether the installer folder may be removed: the hash file (release/desktop-sha256.json) must exist with the schema and shape that `release hashes` writes,
 * name the same version as release/beta.json, and record the real SHA-256 of every installer (*.dmg, *.zip) in apps/desktop/release. An installer that is not a
 * regular file (a symlink) is refused. A root with no installer folder has nothing to protect and passes. Returns { ok, reason, installers }.
 */
export function checkInstallersRecorded(root) {
  const refuse = reason => ({ ok: false, reason, installers: [] });
  const dir = path.join(root, ...INSTALLER_PATHS[0].split('/'));
  let entries;
  try {
    if (!fs.lstatSync(dir).isDirectory()) return { ok: true, reason: null, installers: [] }; // A symlink or a file: cleanOutputs reports it.
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { ok: true, reason: null, installers: [] };
    return refuse(`could not read ${INSTALLER_PATHS[0]}: ${error.code ?? error.message}`);
  }
  const named = entries.filter(entry => INSTALLER_NAME.test(entry.name)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const notFiles = named.filter(entry => !entry.isFile());
  if (notFiles.length) return refuse(`${notFiles.map(entry => entry.name).join(', ')} in ${INSTALLER_PATHS[0]} is a symlink or not a regular file, so its hash cannot be checked`);
  const record = readJson(path.join(root, ...RELEASE_RECORD.split('/')));
  if (record.missing || record.invalid || typeof record.data?.version !== 'string' || record.data.version === '') {
    return refuse(`${RELEASE_RECORD} is missing, not valid JSON, or has no version, so the version of the installers cannot be checked`);
  }
  const hashes = readJson(path.join(root, ...HASH_FILE.split('/')));
  if (hashes.missing) return refuse(`${HASH_FILE} does not exist; run \`release hashes\` and \`release verify\` before cleaning the installers`);
  if (hashes.invalid) return refuse(`${HASH_FILE} is not valid JSON`);
  const data = hashes.data;
  const shapeOk = data !== null && typeof data === 'object' && !Array.isArray(data) && data.schema === HASH_SCHEMA && typeof data.version === 'string'
    && data.files !== null && typeof data.files === 'object' && !Array.isArray(data.files) && Object.values(data.files).every(value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));
  if (!shapeOk) return refuse(`${HASH_FILE} has the wrong shape (expected schema ${HASH_SCHEMA}, a version, and a SHA-256 for each file)`);
  if (data.version !== record.data.version) return refuse(`${HASH_FILE} is for version ${data.version}, but ${RELEASE_RECORD} says ${record.data.version}`);
  const unrecorded = [], different = [];
  for (const entry of named) {
    if (!Object.hasOwn(data.files, entry.name)) unrecorded.push(entry.name);
    else if (sha256File(path.join(dir, entry.name)) !== data.files[entry.name]) different.push(entry.name);
  }
  const problems = [];
  if (unrecorded.length) problems.push(`not recorded in ${HASH_FILE}: ${unrecorded.join(', ')}`);
  if (different.length) problems.push(`hash differs from the record: ${different.join(', ')}`);
  if (problems.length) return refuse(problems.join('; '));
  return { ok: true, reason: null, installers: named.map(entry => entry.name) };
}

/** Runs the clean-up this run asked for. Returns { removed, refused, freedBytes, error }. The installer folder is removed only when checkInstallersRecorded passes. */
function cleanUp(root, args) {
  const merged = args.clean ? cleanOutputs(root, CLEAN_PATHS) : { removed: [], refused: [], freedBytes: 0, error: null };
  if (args.cleanInstallers) {
    const guard = checkInstallersRecorded(root);
    if (!guard.ok) merged.refused.push({ path: INSTALLER_PATHS[0], reason: guard.reason });
    else {
      const installers = cleanOutputs(root, INSTALLER_PATHS);
      merged.removed.push(...installers.removed);
      merged.refused.push(...installers.refused);
      merged.freedBytes += installers.freedBytes;
      if (installers.error) merged.error = merged.error ? `${merged.error}; ${installers.error}` : installers.error;
    }
  }
  return merged;
}

function writeLog(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** Judges a finished step. A test step must also print a summary, show no failures, and show at least one pass. Returns { passed, reason, problem }. */
function judge(step, result, counts) {
  const exited = result.code === 0 && result.reason === null;
  if (!exited) return { passed: false, reason: result.reason, problem: null };
  if (!step.expectCounts) return { passed: true, reason: null, problem: null };
  if (counts === null) return { passed: false, reason: 'NO_SUMMARY', problem: `${step.name} exited 0 but printed no test summary; it cannot be counted as passed` };
  if (counts.fail > 0) return { passed: false, reason: 'TEST_FAILURES', problem: `${step.name} exited 0 but its summary shows ${counts.fail} failed` };
  if (counts.pass === 0) return { passed: false, reason: 'NO_TESTS_RAN', problem: `${step.name} exited 0 but no test passed (pass 0)` };
  return { passed: true, reason: null, problem: null };
}

/** Runs one step and returns its record. The full log goes to `logFile`, with secrets redacted. */
async function runStep(step, root, logFile, timeoutMs, npmConfig) {
  const result = await runChild(step.command[0], step.command.slice(1), {
    cwd: path.join(root, ...step.cwd.split('/')), timeoutMs, maxBytes: MAX_LOG_BYTES,
    env: { NO_COLOR: '1', FORCE_COLOR: undefined, ...npmConfig },
  });
  const text = redact(result.output, process.env);
  writeLog(logFile, text);
  const counts = parseCounts(text);
  const { passed, reason, problem } = judge(step, result, counts);
  return {
    name: step.name, command: step.command.join(' '), cwd: step.cwd, exitCode: result.code, passed, reason, ms: result.ms,
    rawBytes: result.rawBytes, counts,
    firstFailure: passed ? null : redact(problem ?? result.message ?? firstFailure(text) ?? `${step.command.join(' ')} exited with ${result.code ?? result.signal}`, process.env).slice(0, 200),
    log: `.trellis/gates/${step.name}.log`,
  };
}

/** Takes the machine-wide lock by making the folder. Returns true when this run made it. */
function takeLock(lockDir) {
  try { fs.mkdirSync(lockDir); return true; } catch (error) { if (error.code === 'EEXIST') return false; throw error; }
}

const heldMessage = lockDir => `the machine-wide e2e lock ${lockDir} is held by another run. Wait for it to finish; never remove it while a run is active.`;

/** Runs the gates. Returns { exitCode, summary }. */
export async function runGates(args, root) {
  const steps = selectSteps(args);
  const free = freeBytes(root);
  const summary = {
    ok: false, freeGiB: Math.round(free / GIB * 10) / 10, floorGiB: args.floorGiB, steps: [], failedStep: null, notRun: steps.map(s => s.name),
    refused: null, clean: null, lockWarning: null, logDir: '.trellis/gates',
  };
  if (free < args.floorGiB * GIB) {
    summary.refused = `free disk is ${summary.freeGiB} GiB, under the floor of ${args.floorGiB} GiB; nothing was run`;
    return { exitCode: 1, summary };
  }
  const wantsE2e = steps.some(s => s.name === 'desktop-e2e');
  if (wantsE2e && fs.existsSync(args.lockDir)) {
    summary.refused = heldMessage(args.lockDir);
    return { exitCode: 1, summary };
  }
  fs.mkdirSync(path.join(root, '.trellis', 'gates'), { recursive: true, mode: 0o700 });
  // Empty npm config files, so a user's npmrc (and any token in it) is never read by a step. Removed at the end and on an interrupt.
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-gates-npm-'));
  const forgetConfig = onInterrupt(() => fs.rmSync(configDir, { recursive: true, force: true }));
  try {
    const npmConfig = emptyNpmConfigEnv(configDir);
    for (const step of steps) {
      let tookLock = false, forgetLock = () => {};
      if (step.name === 'desktop-e2e') {
        tookLock = takeLock(args.lockDir);
        if (!tookLock) { summary.refused = heldMessage(args.lockDir); break; }
        forgetLock = onInterrupt(() => { try { fs.rmdirSync(args.lockDir); } catch { /* Already gone. */ } });
      }
      const limit = args.timeoutSeconds === null ? step.timeoutMs : Math.min(step.timeoutMs, args.timeoutSeconds * 1000);
      let record;
      try { record = await runStep(step, root, path.join(root, '.trellis', 'gates', `${step.name}.log`), limit, npmConfig); } finally {
        if (tookLock) {
          forgetLock();
          // A lock that cannot be removed is reported; it never hides the result of the step.
          try { fs.rmdirSync(args.lockDir); } catch (error) { if (error.code !== 'ENOENT') summary.lockWarning = `could not remove the e2e lock ${args.lockDir}: ${error.code ?? error.message}`; }
        }
      }
      summary.steps.push(record);
      summary.notRun = summary.notRun.filter(name => name !== step.name);
      if (!record.passed) { summary.failedStep = step.name; break; }
    }
  } finally {
    forgetConfig();
    fs.rmSync(configDir, { recursive: true, force: true });
    if (args.clean || args.cleanInstallers) {
      try { summary.clean = cleanUp(root, args); } catch (error) { summary.clean = { removed: [], refused: [], freedBytes: 0, error: String(error?.message ?? error).slice(0, 200) }; }
    }
  }
  summary.ok = summary.refused === null && summary.failedStep === null && (summary.clean?.error ?? null) === null && (summary.clean?.refused.length ?? 0) === 0 && summary.lockWarning === null;
  return { exitCode: summary.ok ? 0 : 1, summary };
}

/** The short text a person reads. */
export function formatSummary(summary) {
  const lines = [];
  if (summary.refused) lines.push(`gates: REFUSED. ${summary.refused}`);
  for (const step of summary.steps) {
    const counts = step.counts ? ` pass ${step.counts.pass}, fail ${step.counts.fail}, skipped ${step.counts.skipped};` : '';
    lines.push(`gates: ${step.name} ${step.passed ? 'passed' : 'FAILED'} (${step.ms} ms,${counts} ${step.rawBytes} bytes; log ${step.log})`);
    if (!step.passed) lines.push(`gates: first failure: ${step.firstFailure}`);
  }
  if (summary.notRun.length && summary.failedStep) lines.push(`gates: not run: ${summary.notRun.join(', ')}`);
  if (summary.lockWarning) lines.push(`gates: WARNING: ${summary.lockWarning}`);
  if (summary.clean) {
    for (const item of summary.clean.removed) lines.push(`gates: removed ${item.path} (${item.bytes} bytes)`);
    for (const item of summary.clean.refused) lines.push(`gates: refused to remove ${item.path}: ${item.reason}`);
    if (summary.clean.error) lines.push(`gates: cleanup error: ${summary.clean.error}`);
    lines.push(`gates: freed ${summary.clean.freedBytes} bytes`);
  }
  if (summary.ok) lines.push('gates: all steps passed');
  return lines.join('\n') + '\n';
}

/** Entry point. Returns the exit code. */
export async function main(argv, out = process.stdout, err = process.stderr, env = process.env) {
  const json = jsonWanted(argv);
  return guarded('gates', { json, out, err }, async () => {
    const args = parseArgs(argv, env);
    if (args.help) { out.write(USAGE + '\n'); return 0; }
    if (args.usage) return reportUsage('gates', args.usage, USAGE, { json, out, err });
    const root = args.root ?? fileURLToPath(new URL('..', import.meta.url));
    let rootStat = null;
    try { rootStat = fs.statSync(root); } catch { /* reported below */ }
    if (!rootStat?.isDirectory()) return reportUsage('gates', `--root ${root} is not an existing folder`, USAGE, { json, out, err });
    const { exitCode, summary } = await runGates(args, root);
    out.write(args.json ? JSON.stringify(summary) + '\n' : formatSummary(summary));
    return exitCode;
  });
}

const entry = entryState(process.argv[1], import.meta.url);
if (entry === 'main') {
  installInterruptHandlers();
  process.exitCode = await main(process.argv.slice(2));
} else if (entry === 'mismatch') {
  process.stderr.write(mismatchMessage('gates', process.argv[1], import.meta.url));
  process.exitCode = 2;
}
