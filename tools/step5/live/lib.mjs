// Shared helpers for the step 5 live checks (blueprint section G). Nothing here runs an engine by itself: a live test
// calls runEngine, and a live test runs only when BOWERLOOM_LIVE_ENGINES=1.
//
// Rules this file keeps:
// - An engine command comes from an environment variable, never from a guess or from a lookup on the machine.
// - An engine version comes from BOWERLOOM_LIVE_<ENGINE>_VERSION. Nothing here runs a binary to learn it.
// - A stub command logs argv, the NAMES of environment variables, and standard input. It never logs a value.
// - A result line holds no home path and no scratch path.
// - A Codex check can run in one fixed root (BOWERLOOM_LIVE_CODEX_ROOT), so a trusted project path and a reviewed hook hash stay
//   the same on every run. The root is checked, locked for one run, and cleared between runs. It is never deleted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

/** The engines a live command can name, with the id used in result lines. */
export const LIVE_ENGINES = Object.freeze(['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness']);
/** A harmless, made-up value. Stubs compare against it and never print a value. */
export const PROBE = 'probe-live-3c1d';

/** The checks of blueprint section G, in order. `engines` are the engines a check runs on. */
export const CHECKS = Object.freeze([
  { id: 'g1', title: 'AGENTS.md alone loads', engines: ['claude-code', 'codex', 'opencode'], turns: 3, kind: 'test' },
  { id: 'g2', title: 'OpenCode lists a skill that sits in both skill roots', engines: ['opencode'], turns: 1, kind: 'test' },
  { id: 'g3', title: 'Pi trust detection for a project skill', engines: ['pi'], turns: 1, kind: 'test' },
  { id: 'g4', title: 'Codex expands ${NAME} in an MCP server', engines: ['codex'], turns: 1, kind: 'test', codexTrust: true },
  { id: 'g5', title: 'OpenCode approval order', engines: ['opencode'], turns: 3, kind: 'manual' },
  { id: 'g6', title: 'OpenCode plugin inputs', engines: ['opencode'], turns: 1, kind: 'test' },
  { id: 'g7', title: 'Hook blocking', engines: ['claude-code', 'codex', 'opencode'], turns: 3, kind: 'test', codexTrust: true },
  { id: 'g8', title: 'Codex permission profile', engines: ['codex'], turns: 2, kind: 'test', codexTrust: true },
  { id: 'g9', title: '--ignore-rules keeps or drops a project rule', engines: ['codex'], turns: 1, kind: 'test', codexTrust: true },
  { id: 'g10', title: 'Claude Code --setting-sources', engines: ['claude-code'], turns: 2, kind: 'test' },
  { id: 'g11', title: 'Claude Code defaults', engines: ['claude-code'], turns: 1, kind: 'test' },
  { id: 'g12', title: 'Claude Code sandbox keys', engines: ['claude-code'], turns: 1, kind: 'manual' },
]);

const upper = engine => engine.toUpperCase().replace(/-/g, '_');
export const commandVariable = engine => `BOWERLOOM_LIVE_${upper(engine)}`;
export const versionVariable = engine => `BOWERLOOM_LIVE_${upper(engine)}_VERSION`;

/** The command words of an engine, or null when the variable is unset. A bad value fails loudly. */
export function commandOf(engine, env = process.env) {
  const raw = env[commandVariable(engine)];
  if (!raw) return null;
  let words;
  try { words = JSON.parse(raw); } catch { assert.fail(`${commandVariable(engine)} is not JSON`); }
  assert.ok(Array.isArray(words) && words.length > 0 && words.every(w => typeof w === 'string'), `${commandVariable(engine)} is a JSON list of words`);
  return words;
}
/** The version a person passes in, or `unknown`. No binary is run to learn it. */
export const versionOf = (engine, env = process.env) => env[versionVariable(engine)] || 'unknown';
/** The skip reason of a live test, or false when it may run. */
export function liveSkip(engine, env = process.env) {
  if (env.BOWERLOOM_LIVE_ENGINES !== '1') return 'set BOWERLOOM_LIVE_ENGINES=1 to run live engine checks';
  return commandOf(engine, env) === null ? `no command for ${engine}` : false;
}
export const CODEX_ROOT_VARIABLE = 'BOWERLOOM_LIVE_CODEX_ROOT';
/** The file that marks a folder as a Codex root that Bowerloom made. A non-empty folder without it is never used. */
export const CODEX_ROOT_MARKER = '.bowerloom-live-codex-root';
/** The lock file of one run. It sits in the root and holds the process id. */
export const CODEX_ROOT_LOCK = '.bowerloom-live-codex-lock';
const MARKER_TEXT = 'Bowerloom live check root for Codex.\nThe live checks clear project, home, state, and stubs in this folder. Keep this file.\n';
const SETUP_SCRIPT = 'tools/step5/live/codex-trust-setup.mjs';

/**
 * The refusal of a Codex check, or null when the check may run. A Codex check needs both variables: the trust variable
 * (a person did the trust steps) and the root variable (an absolute path, the folder they trusted).
 * The result holds `message` (for the failed test and the result line) and `observed` (the short result text).
 */
export function codexGate(id, env = process.env) {
  const tail = `Run node ${SETUP_SCRIPT} <root> once, do the three manual steps it prints, then set BOWERLOOM_LIVE_CODEX_TRUSTED=1 and ${CODEX_ROOT_VARIABLE}=<root>. See tools/step5/live/README.md. No turn was spent.`;
  if (env.BOWERLOOM_LIVE_CODEX_TRUSTED !== '1') {
    return { observed: 'refused: Codex trust not confirmed', message: `Check ${id} refuses to run. Codex reads a project .codex folder and runs a project hook only after a person trusts the folder and reviews the hook. That trust is saved for one folder path, so the checks need one fixed root. ${tail}` };
  }
  const root = env[CODEX_ROOT_VARIABLE];
  if (!root) return { observed: `refused: ${CODEX_ROOT_VARIABLE} not set`, message: `Check ${id} refuses to run. BOWERLOOM_LIVE_CODEX_TRUSTED=1 is set, but ${CODEX_ROOT_VARIABLE} is not. A random scratch folder cannot hold a Codex trust. ${tail}` };
  if (!path.isAbsolute(root)) return { observed: `refused: ${CODEX_ROOT_VARIABLE} is not absolute`, message: `Check ${id} refuses to run. ${CODEX_ROOT_VARIABLE} must be an absolute path. ${tail}` };
  return null;
}
/** The message that refuses a Codex check until the person has done the Codex trust steps, or null. */
export const codexTrustRefusal = (id, env = process.env) => codexGate(id, env)?.message ?? null;

const shellQuote = text => `'${String(text).replace(/'/g, `'\\''`)}'`;

/** Removes the home folder and any scratch path from text that goes into a result line. */
export function sanitize(text, scratchBase = null) {
  let out = String(text);
  if (scratchBase) out = out.split(scratchBase).join('<scratch>');
  out = out.split(os.homedir()).join('~');
  return out.replace(/(?:\/private)?\/var\/folders\/[^\s"']+/g, '<tmp>').replace(/\/Users\/[^\s/"']+/g, '~');
}

// The stub command. It is a small node script that a config points at. It writes one JSON line to the log file named by
// its first argument. The line holds the label, argv, the sorted NAMES of the environment, a state word for any
// variable whose value looks like the probe (never the value), and standard input.
const STUB_SOURCE = `import fs from 'node:fs';
const PROBE = ${JSON.stringify(PROBE)};
const [logFile, label, ...rest] = process.argv.slice(2);
let exitCode = 0;
const argv = [];
for (let i = 0; i < rest.length; i += 1) { if (rest[i] === '--exit') { exitCode = Number(rest[i + 1]); i += 1; } else argv.push(rest[i]); }
const state = value => value === PROBE ? 'probe-value' : value.includes('\${') ? 'literal-ref' : value.includes(PROBE) ? 'contains-probe' : null;
const probe = [];
for (const [name, value] of Object.entries(process.env)) { const s = state(String(value)); if (s) probe.push({ name, state: s }); }
let stdin = '';
let done = false;
function finish() {
  if (done) return;
  done = true;
  const entry = { label, at: new Date().toISOString(), argv, envNames: Object.keys(process.env).sort(), probe, stdin: stdin.slice(0, 8000) };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\\n');
  if (exitCode === 2) process.stderr.write('Blocked by a live check hook.\\n');
  process.exit(exitCode);
}
if (process.stdin.isTTY) finish();
else {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { stdin += chunk; });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
  setTimeout(finish, 1500);
}
`;
export const stubSource = () => STUB_SOURCE;

/** Reads the JSON lines a stub or the probe server wrote. A missing file is an empty list. */
export function readLog(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return { label: 'unparsed' }; } });
}

/** The state word of a value, for the probe server. Same rule as the stub. */
export function classify(value) {
  const v = String(value);
  return v === PROBE ? 'probe-value' : v.includes('${') ? 'literal-ref' : v.includes(PROBE) ? 'contains-probe' : null;
}

const SCRATCH_DIRS = ['project', 'home', 'state', 'stubs'];
const refuse = text => { throw new Error(text); };
const lstatOrNull = file => { try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const isMarker = file => { const st = lstatOrNull(file); return !!st && st.isFile() && fs.readFileSync(file, 'utf8') === MARKER_TEXT; };

/**
 * Checks and prepares a fixed Codex root, and returns its real path. It refuses a relative path, a symlink, a file, a folder
 * owned by another user, and a non-empty folder without the marker file. It makes the folder with mode 0700 when it is
 * missing or empty, writes the marker, and makes the four scratch folders. It deletes nothing.
 */
export function prepareCodexRoot(root, { uid = process.getuid?.() } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) refuse(`${CODEX_ROOT_VARIABLE} must be an absolute path.`);
  const given = path.resolve(root);
  const st = lstatOrNull(given);
  let real;
  if (st) {
    if (st.isSymbolicLink()) refuse(`The Codex root is a symlink. Use the real folder, not a link to it.`);
    if (!st.isDirectory()) refuse(`The Codex root path exists and is not a folder.`);
    if (uid !== undefined && st.uid !== uid) refuse(`The Codex root is owned by another user. Use a folder you own.`);
    real = fs.realpathSync(given);
    if (!isMarker(path.join(real, CODEX_ROOT_MARKER)) && fs.readdirSync(real).length > 0) {
      refuse(`The Codex root is not empty and has no ${CODEX_ROOT_MARKER} marker file that Bowerloom wrote. Choose an empty or new folder.`);
    }
  } else {
    fs.mkdirSync(given, { recursive: true, mode: 0o700 });
    real = fs.realpathSync(given);
  }
  fs.chmodSync(real, 0o700);
  if (!isMarker(path.join(real, CODEX_ROOT_MARKER))) fs.writeFileSync(path.join(real, CODEX_ROOT_MARKER), MARKER_TEXT, { mode: 0o600 });
  for (const name of SCRATCH_DIRS) {
    const dir = path.join(real, name);
    const entry = lstatOrNull(dir);
    if (!entry) fs.mkdirSync(dir, { mode: 0o700 });
    else if (!entry.isDirectory()) refuse(`${name} in the Codex root is not a plain folder (a link or a file stands there). Remove it by hand and run again.`);
  }
  return real;
}

/** Empties project, home, state, and stubs, and removes the log. The root, the marker, and the folders stay. */
function clearCodexRoot(base) {
  for (const name of SCRATCH_DIRS) {
    const dir = path.join(base, name);
    if (!lstatOrNull(dir)?.isDirectory()) refuse(`${name} in the Codex root is not a plain folder (a link or a file stands there). Remove it by hand and run again.`);
    for (const entry of fs.readdirSync(dir)) fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
  fs.rmSync(path.join(base, 'evidence.jsonl'), { force: true });
}

const heldLocks = new Set();
let exitHookSet = false;
/**
 * Takes the exclusive lock of one run, or throws. A lock is never cleaned by guess: the message says which process wrote it and
 * tells the person to delete the file by hand when no run is active. The returned function releases the lock once.
 */
function acquireLock(base) {
  const file = path.join(base, CODEX_ROOT_LOCK);
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let who = 'a process that is not named in the lock file';
    try {
      const pid = Number(JSON.parse(fs.readFileSync(file, 'utf8')).pid);
      let alive = true;
      try { process.kill(pid, 0); } catch (killError) { alive = killError.code === 'EPERM'; }
      who = `process ${pid}, which is ${alive ? 'still running' : 'not running'}`;
    } catch { /* an unreadable lock keeps the generic text */ }
    refuse(`Another live run holds the lock file ${file} (${who}). Wait for that run to end. If no run is active, delete that file and run again.`);
  }
  fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n');
  fs.closeSync(fd);
  heldLocks.add(file);
  if (!exitHookSet) {
    exitHookSet = true;
    process.on('exit', () => { for (const held of heldLocks) { try { fs.rmSync(held, { force: true }); } catch { /* best effort */ } } });
  }
  return () => { if (heldLocks.delete(file)) fs.rmSync(file, { force: true }); };
}

/**
 * A fresh scratch folder (mode 0700) with a project, a home, a state folder, and a stub. When an engine allows it, the
 * run points XDG_STATE_HOME inside the scratch folder. HOME stays real unless BOWERLOOM_LIVE_ISOLATE_HOME=1, because an
 * engine that signed in through the home folder would lose its login.
 *
 * With `fixedBase` (an absolute path, for the Codex checks) the scratch folder is that one folder every run: the project is
 * always `<fixedBase>/project`, so the stub path, the log path, and a hook command stay byte-identical. The folder is checked
 * (see prepareCodexRoot), locked for this run, and cleared at the start and at `cleanup()`. `cleanup()` keeps the root, its
 * marker, and its folders, and drops the lock. `release()` drops the lock and clears nothing.
 */
export function makeScratch(prefix = 'bowerloom-live', { fixedBase = null } = {}) {
  let base;
  let releaseLock = () => {};
  if (fixedBase) {
    base = prepareCodexRoot(fixedBase);
    releaseLock = acquireLock(base);
    try { clearCodexRoot(base); } catch (error) { releaseLock(); throw error; }
  } else {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)));
    fs.chmodSync(base, 0o700);
    for (const name of SCRATCH_DIRS) fs.mkdirSync(path.join(base, name), { mode: 0o700 });
  }
  const dirs = Object.fromEntries(SCRATCH_DIRS.map(name => [name, path.join(base, name)]));
  const stub = path.join(dirs.stubs, 'log-stub.mjs');
  try { fs.writeFileSync(stub, STUB_SOURCE, { mode: 0o600 }); } catch (error) { releaseLock(); throw error; }
  const log = path.join(base, 'evidence.jsonl');
  const scratch = {
    base, ...dirs, stub, log,
    /** Writes project files by relative path. */
    write(files) {
      for (const [rel, text] of Object.entries(files)) {
        assert.ok(!path.isAbsolute(rel) && !rel.split('/').includes('..'), `a project file stays inside the project: ${rel}`);
        const file = path.join(dirs.project, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text, { mode: 0o600 });
      }
      return scratch;
    },
    gitInit() { spawnSync('git', ['init', '-q'], { cwd: dirs.project }); return scratch; },
    /** A shell command line for a hook. `exit` makes the stub exit with that code. */
    stubCommand(label, { exit } = {}) { return ['node', shellQuote(stub), shellQuote(log), shellQuote(label), ...(exit === undefined ? [] : ['--exit', String(exit)])].join(' '); },
    /** The argument list for a config that runs the stub itself, such as an MCP server. */
    stubArgs(label, ...rest) { return [stub, log, label, ...rest]; },
    entries() { return readLog(log); },
    env(extra = {}) {
      return { ...process.env, XDG_STATE_HOME: dirs.state, ...(process.env.BOWERLOOM_LIVE_ISOLATE_HOME === '1' ? { HOME: dirs.home } : {}), ...extra };
    },
    /** Drops the lock of a fixed base and clears nothing. A random scratch folder has no lock. */
    release() { releaseLock(); },
    cleanup() {
      if (!fixedBase) { fs.rmSync(base, { recursive: true, force: true }); return; }
      try { clearCodexRoot(base); } finally { releaseLock(); }
    },
  };
  return scratch;
}

/**
 * Runs one engine turn and waits. The prompt is the last argument (`via: 'arg'`) or goes on standard input
 * (`via: 'stdin'`). An engine with an open standard input can hang, so `arg` closes it.
 */
export function runEngine({ words, extra = [], prompt, via = 'arg', cwd, env, timeoutMs = 300_000 }) {
  const [cmd, ...args] = words;
  const argv = via === 'arg' ? [...args, ...extra, prompt] : [...args, ...extra];
  return new Promise(resolve => {
    const child = spawn(cmd, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, spawnError = null;
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', e => { spawnError = e.code ?? String(e); });
    child.stdin.on('error', () => {});
    child.stdin.end(via === 'stdin' ? prompt : undefined);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr, timedOut, spawnError }); });
  });
}

/** The command shape of a result line: the words, the extra flags, and a marker for the prompt. */
export function shapeOf(words, extra = [], via = 'arg') {
  const word = w => path.isAbsolute(w) ? path.basename(w) : w; // an absolute path never reaches a result line
  return sanitize([...words, ...extra].map(word).concat(via === 'arg' ? '<prompt>' : '(prompt on stdin)').join(' '));
}

let defaultResults = null;
/** Where result lines go: BOWERLOOM_LIVE_RESULTS, or a file in a results folder that the run keeps. */
export function resultsPath(env = process.env) {
  if (env.BOWERLOOM_LIVE_RESULTS) return env.BOWERLOOM_LIVE_RESULTS;
  if (!defaultResults) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-live-results-'));
    fs.chmodSync(dir, 0o700);
    defaultResults = path.join(dir, 'results.jsonl');
  }
  return defaultResults;
}

const RESULT_WORDS = ['pass', 'fail', 'inconclusive'];
/** Builds one result line. */
export function resultLine({ check, engine, version, command, result, observed = '', evidence = '', scratchBase = null, now = new Date() }) {
  assert.ok(RESULT_WORDS.includes(result), `a result is one of ${RESULT_WORDS.join(', ')}`);
  const at = now.toISOString();
  return {
    check, engine, version, command: sanitize(command, scratchBase), result,
    observed: sanitize(observed, scratchBase).slice(0, 300),
    evidence: sanitize(evidence, scratchBase).slice(0, 800),
    date: at.slice(0, 10), at,
  };
}
export function appendResult(line, env = process.env) {
  const file = resultsPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(line) + '\n', { mode: 0o600 });
  return file;
}

/**
 * Runs the body of a live check and records one result line. The body returns
 * `{ result, observed, evidence, shape }`. A thrown error records `fail` and is thrown again. A `fail` result fails the
 * test; `inconclusive` passes it and records that the run answered nothing.
 */
export async function recorded({ check, engine, scratch = null, env = process.env }, body) {
  const base = scratch?.base ?? null;
  const meta = { check, engine, version: versionOf(engine, env), scratchBase: base };
  let out;
  try { out = await body(); } catch (error) {
    appendResult(resultLine({ ...meta, command: 'unknown', result: 'fail', evidence: `The check threw: ${error?.message ?? error}` }), env);
    throw error;
  }
  appendResult(resultLine({ ...meta, command: out.shape ?? 'unknown', result: out.result, observed: out.observed, evidence: out.evidence }), env);
  if (out.result === 'fail') assert.fail(`${check} on ${engine}: ${out.observed || out.evidence}`);
  return out;
}

/** A local server that logs each request as one line: label, path, and header names with a state word per header. */
export function probeServer(log, label = 'probe-http') {
  const server = http.createServer((req, res) => {
    const probe = Object.entries(req.headers).map(([name, value]) => ({ name, state: classify(Array.isArray(value) ? value.join(',') : value) })).filter(h => h.state);
    fs.appendFileSync(log, JSON.stringify({ label, at: new Date().toISOString(), method: req.method, url: req.url, headerNames: Object.keys(req.headers).sort(), probe }) + '\n');
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end('{"error":"live check server"}');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise(done => { server.closeAllConnections?.(); server.close(() => done()); }) })));
}
