// Step 5 live checks: the fixed Codex root, its safety rules, and the trust setup script.
// Everything here is offline. No engine starts, no live variable is set, and no real Codex folder is read or written.
// Each test makes its folders below one temp folder per test, and a hook removes them, also after a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CHECKS, CODEX_ROOT_LOCK, CODEX_ROOT_MARKER, CODEX_ROOT_VARIABLE, codexGate, codexTrustRefusal, makeScratch, prepareCodexRoot, resultLine,
} from '../step5/live/lib.mjs';
import { g7Project } from '../step5/live/projects.mjs';
import { setup } from '../step5/live/codex-trust-setup.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const SETUP = path.join(repo, 'tools/step5/live/codex-trust-setup.mjs');
const TRUST_IDS = ['g4', 'g7', 'g8', 'g9'];

const made = [];
test.after(() => { for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
/** A new temp folder that holds the roots of one test. */
function area() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-codex-root-test-')));
  made.push(dir);
  return dir;
}
const lockOf = root => path.join(root, CODEX_ROOT_LOCK);
const names = dir => fs.readdirSync(dir).sort();

// ---- the fixed base is reused ---------------------------------------------------------------------------------------

test('a fixed base gives the same project, stub, log, and g7 Codex hook command on two runs', () => {
  const root = path.join(area(), 'root');
  const hooks = [];
  const paths = [];
  for (let run = 0; run < 2; run += 1) {
    const sc = makeScratch('bowerloom-live-g7', { fixedBase: root });
    try {
      const p = g7Project(sc, 'codex');
      sc.write(p.files);
      hooks.push(fs.readFileSync(path.join(sc.project, '.codex/hooks.json'), 'utf8'));
      paths.push({ base: sc.base, project: sc.project, stub: sc.stub, log: sc.log, command: sc.stubCommand('g7-codex', { exit: 2 }) });
    } finally { sc.cleanup(); }
  }
  assert.equal(paths[0].project, path.join(fs.realpathSync(root), 'project'));
  assert.deepEqual(paths[0], paths[1]);
  assert.equal(hooks[0], hooks[1], 'hooks.json is byte-identical across runs');
  const command = JSON.parse(hooks[0]).hooks.PreToolUse[0].hooks[0].command;
  assert.equal(command, paths[0].command);
  assert.ok(command.includes(paths[0].stub), 'the hook names the fixed stub path');
  assert.ok(command.includes(paths[0].log), 'the hook names the fixed log path');
});

test('random scratch folders stay random when no fixed base is given', () => {
  const a = makeScratch('bowerloom-live-x'), b = makeScratch('bowerloom-live-x');
  try {
    assert.notEqual(a.base, b.base);
    assert.equal(fs.existsSync(path.join(a.base, CODEX_ROOT_MARKER)), false);
  } finally { a.cleanup(); b.cleanup(); }
  assert.equal(fs.existsSync(a.base), false);
});

test('a fixed base keeps the layout of a random one and has mode 0700', () => {
  const root = path.join(area(), 'root');
  const sc = makeScratch('bowerloom-live-g4', { fixedBase: root });
  try {
    assert.equal(fs.statSync(sc.base).mode & 0o777, 0o700);
    for (const dir of [sc.project, sc.home, sc.state, sc.stubs]) assert.ok(fs.statSync(dir).isDirectory(), dir);
    assert.equal(sc.env().XDG_STATE_HOME, sc.state);
    assert.ok(fs.existsSync(sc.stub));
    assert.equal(sc.log, path.join(sc.base, 'evidence.jsonl'));
  } finally { sc.cleanup(); }
});

// ---- clearing between runs ------------------------------------------------------------------------------------------

test('cleanup clears project, home, state, stubs, and the log, and keeps the root, marker, and folders', () => {
  const root = path.join(area(), 'root');
  const sc = makeScratch('bowerloom-live-g8', { fixedBase: root });
  sc.write({ 'a/b.txt': 'x', '.codex/config.toml': 'y' }).gitInit();
  fs.writeFileSync(path.join(sc.home, 'h.txt'), 'h');
  fs.mkdirSync(path.join(sc.state, 'deep/er'), { recursive: true });
  fs.writeFileSync(path.join(sc.state, 'deep/er/s.txt'), 's');
  fs.writeFileSync(sc.log, '{"label":"x"}\n');
  assert.ok(fs.existsSync(path.join(sc.project, '.git')));
  sc.cleanup();
  assert.ok(fs.statSync(sc.base).isDirectory(), 'the root stays');
  assert.ok(fs.statSync(path.join(sc.base, CODEX_ROOT_MARKER)).isFile(), 'the marker stays');
  for (const dir of [sc.project, sc.home, sc.state, sc.stubs]) assert.deepEqual(fs.readdirSync(dir), [], `${path.basename(dir)} is empty`);
  assert.equal(fs.existsSync(sc.log), false);
  assert.equal(fs.existsSync(lockOf(sc.base)), false);
  assert.deepEqual(names(sc.base), [CODEX_ROOT_MARKER, 'home', 'project', 'state', 'stubs'].sort());
});

test('a new run clears what an earlier run left when it never cleaned up', () => {
  const root = path.join(area(), 'root');
  const first = makeScratch('bowerloom-live-g9', { fixedBase: root });
  first.write({ 'left-over.txt': 'x' });
  fs.writeFileSync(first.log, 'old\n');
  first.release(); // keeps the files, drops the lock, as a crashed run's exit handler would
  const second = makeScratch('bowerloom-live-g9', { fixedBase: root });
  try {
    assert.deepEqual(fs.readdirSync(second.project), []);
    assert.equal(fs.existsSync(second.log), false);
    assert.equal(second.entries().length, 0);
  } finally { second.cleanup(); }
});

test('the root itself is never deleted, also when cleanup runs twice', () => {
  const root = path.join(area(), 'root');
  const sc = makeScratch('bowerloom-live-g4', { fixedBase: root });
  sc.cleanup();
  sc.cleanup();
  assert.ok(fs.existsSync(root));
});

// ---- the lock -------------------------------------------------------------------------------------------------------

test('a held lock makes a second run refuse with a message that names the lock file', () => {
  const root = path.join(area(), 'root');
  const first = makeScratch('bowerloom-live-g4', { fixedBase: root });
  try {
    assert.ok(fs.existsSync(lockOf(first.base)), 'the lock exists during the run');
    assert.throws(() => makeScratch('bowerloom-live-g8', { fixedBase: root }), err => /another live run holds/i.test(err.message) && err.message.includes(CODEX_ROOT_LOCK) && /delete that file/i.test(err.message));
    assert.ok(fs.existsSync(first.project), 'the refused run did not touch the first run');
  } finally { first.cleanup(); }
  assert.equal(fs.existsSync(lockOf(first.base)), false);
});

test('a lock left by a dead run is refused, never cleaned silently', () => {
  const root = path.join(area(), 'root');
  const sc = makeScratch('bowerloom-live-g4', { fixedBase: root });
  sc.release();
  fs.writeFileSync(lockOf(sc.base), JSON.stringify({ pid: 2 ** 22 + 12345, at: '2026-01-01T00:00:00.000Z' }));
  assert.throws(() => makeScratch('bowerloom-live-g4', { fixedBase: root }), /not running/);
  assert.ok(fs.existsSync(lockOf(sc.base)), 'the stale lock stays until a person deletes it');
  fs.rmSync(lockOf(sc.base));
  makeScratch('bowerloom-live-g4', { fixedBase: root }).cleanup();
});

test('the lock is removed after a body that throws', () => {
  const root = path.join(area(), 'root');
  assert.throws(() => {
    const sc = makeScratch('bowerloom-live-g7', { fixedBase: root });
    try { sc.write({ 'x.txt': 'x' }); throw new Error('the body failed'); } finally { sc.cleanup(); }
  }, /the body failed/);
  assert.equal(fs.existsSync(lockOf(fs.realpathSync(root))), false);
  assert.deepEqual(fs.readdirSync(path.join(fs.realpathSync(root), 'project')), []);
  makeScratch('bowerloom-live-g7', { fixedBase: root }).cleanup(); // a later run gets the lock
});

test('a failed setup of the base does not leave the lock behind', () => {
  const root = path.join(area(), 'root');
  makeScratch('bowerloom-live-g4', { fixedBase: root }).cleanup();
  const real = fs.realpathSync(root);
  fs.rmSync(path.join(real, 'state'), { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(real, 'state')); // a planted link where a folder belongs
  assert.throws(() => makeScratch('bowerloom-live-g4', { fixedBase: root }), /not a plain folder/);
  assert.equal(fs.existsSync(lockOf(real)), false);
});

// ---- refusals -------------------------------------------------------------------------------------------------------

test('a relative path is refused', () => {
  assert.throws(() => makeScratch('bowerloom-live-g4', { fixedBase: 'relative/root' }), /absolute path/);
  assert.throws(() => prepareCodexRoot(''), /absolute path/);
});

test('a symlink is refused, also when it points at a good root', () => {
  const dir = area();
  const real = path.join(dir, 'real');
  makeScratch('bowerloom-live-g4', { fixedBase: real }).cleanup();
  const link = path.join(dir, 'link');
  fs.symlinkSync(real, link);
  assert.throws(() => makeScratch('bowerloom-live-g4', { fixedBase: link }), /symlink/);
});

test('a path that is a file is refused', () => {
  const file = path.join(area(), 'file');
  fs.writeFileSync(file, 'x');
  assert.throws(() => prepareCodexRoot(file), /not a folder/);
});

test('a non-empty folder without the marker is refused and left untouched', () => {
  const root = path.join(area(), 'foreign');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'precious.txt'), 'keep');
  assert.throws(() => makeScratch('bowerloom-live-g4', { fixedBase: root }), /marker/);
  assert.deepEqual(fs.readdirSync(root), ['precious.txt']);
  assert.equal(fs.readFileSync(path.join(root, 'precious.txt'), 'utf8'), 'keep');
});

test('a folder with a fake marker (a link or other text) is refused', () => {
  const dir = area();
  const root = path.join(dir, 'fake');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'precious.txt'), 'keep');
  fs.writeFileSync(path.join(root, CODEX_ROOT_MARKER), 'not what Bowerloom writes');
  assert.throws(() => prepareCodexRoot(root), /marker/);
  fs.rmSync(path.join(root, CODEX_ROOT_MARKER));
  fs.symlinkSync(path.join(root, 'precious.txt'), path.join(root, CODEX_ROOT_MARKER));
  assert.throws(() => prepareCodexRoot(root), /marker/);
  assert.equal(fs.readFileSync(path.join(root, 'precious.txt'), 'utf8'), 'keep');
});

test('a folder owned by another user is refused', () => {
  const root = path.join(area(), 'root');
  fs.mkdirSync(root);
  const uid = fs.statSync(root).uid;
  assert.throws(() => prepareCodexRoot(root, { uid: uid + 1 }), /owned by/);
  assert.doesNotThrow(() => prepareCodexRoot(root, { uid }));
});

test('an empty folder is accepted, made private, and given the marker', () => {
  const root = path.join(area(), 'empty');
  fs.mkdirSync(root, { mode: 0o755 });
  const real = prepareCodexRoot(root);
  assert.equal(real, fs.realpathSync(root));
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.ok(fs.existsSync(path.join(root, CODEX_ROOT_MARKER)));
});

test('a new path is created with mode 0700 and the marker', () => {
  const root = path.join(area(), 'deep', 'new');
  prepareCodexRoot(root);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.ok(fs.existsSync(path.join(root, CODEX_ROOT_MARKER)));
});

// ---- the gate for the four Codex checks -----------------------------------------------------------------------------

test('the four Codex checks are g4, g7, g8, and g9', () => {
  assert.deepEqual(CHECKS.filter(c => c.codexTrust).map(c => c.id), TRUST_IDS);
});

test('trusted without a root refuses before any turn, names both variables and the setup script, and records inconclusive', () => {
  for (const id of TRUST_IDS) {
    const env = { BOWERLOOM_LIVE_CODEX_TRUSTED: '1' };
    const gate = codexGate(id, env);
    assert.ok(gate, id);
    for (const word of [`Check ${id} refuses to run`, 'BOWERLOOM_LIVE_CODEX_TRUSTED', CODEX_ROOT_VARIABLE, 'codex-trust-setup.mjs', 'No turn was spent']) assert.ok(gate.message.includes(word), `${id}: ${word}`);
    assert.equal(codexTrustRefusal(id, env), gate.message);
    const line = resultLine({ check: id, engine: 'codex', version: 'v', command: 'refused before any turn', result: 'inconclusive', observed: gate.observed, evidence: gate.message });
    assert.equal(line.result, 'inconclusive');
    assert.match(line.observed, /BOWERLOOM_LIVE_CODEX_ROOT/);
  }
});

test('a relative root refuses the same way', () => {
  const gate = codexGate('g7', { BOWERLOOM_LIVE_CODEX_TRUSTED: '1', [CODEX_ROOT_VARIABLE]: 'relative' });
  assert.match(gate.message, /absolute/);
});

test('without the trust variable the gate still refuses, and it names the root and the setup script too', () => {
  const gate = codexGate('g4', { [CODEX_ROOT_VARIABLE]: '/somewhere' });
  assert.match(gate.message, /BOWERLOOM_LIVE_CODEX_TRUSTED=1/);
  assert.match(gate.message, /codex-trust-setup\.mjs/);
  assert.match(gate.observed, /trust not confirmed/);
});

test('both variables set lets the check run', () => {
  for (const id of TRUST_IDS) assert.equal(codexGate(id, { BOWERLOOM_LIVE_CODEX_TRUSTED: '1', [CODEX_ROOT_VARIABLE]: '/somewhere' }), null);
});

test('a refusal message holds no home path', () => {
  const gate = codexGate('g8', { BOWERLOOM_LIVE_CODEX_TRUSTED: '1' });
  assert.ok(!gate.message.includes(os.homedir()));
});

// ---- the setup script -----------------------------------------------------------------------------------------------

function runSetup(args, extraEnv = {}) {
  return spawnSync(process.execPath, [SETUP, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...extraEnv }, timeout: 60_000 });
}

test('setup makes the root, the marker, a git project, and the exact g7 hook, then prints three steps and the variables', () => {
  const root = path.join(area(), 'root');
  const out = [];
  const real = setup(root, { write: text => out.push(text) });
  const text = out.join('');
  assert.equal(real, fs.realpathSync(root));
  assert.ok(fs.existsSync(path.join(real, CODEX_ROOT_MARKER)));
  assert.ok(fs.statSync(path.join(real, 'project/.git')).isDirectory(), 'git init ran in the project');
  assert.equal(fs.existsSync(lockOf(real)), false, 'setup drops its lock');
  // The hook file equals what a g7 run writes into the same root. Read it first: a new run clears the project.
  const written = fs.readFileSync(path.join(real, 'project/.codex/hooks.json'), 'utf8');
  const sc = makeScratch('bowerloom-live-g7', { fixedBase: root });
  try {
    const p = g7Project(sc, 'codex');
    assert.equal(written, p.files['.codex/hooks.json']);
  } finally { sc.cleanup(); }
  assert.ok(text.includes(`cd "${real}/project" && codex`), 'step 1');
  assert.match(text, /1\. .*codex/);
  assert.match(text, /2\. .*trust/i);
  assert.match(text, /3\. .*\/hooks/);
  assert.ok(text.includes(`BOWERLOOM_LIVE_CODEX_ROOT="${real}"`));
  assert.ok(text.includes('BOWERLOOM_LIVE_CODEX_TRUSTED=1'));
  assert.match(text, /g7/);
});

test('setup run as a program prints the steps, exits 0, and prints no environment value', () => {
  const root = path.join(area(), 'root');
  const canary = 'canary-value-8f3a2c1d-do-not-print';
  const r = runSetup([root], { CANARY_SECRET_NAME: canary });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(fs.realpathSync(root)));
  assert.ok(!r.stdout.includes(canary) && !r.stderr.includes(canary));
  assert.ok(!r.stdout.includes('CANARY_SECRET_NAME'));
  assert.ok(fs.existsSync(path.join(root, 'project/.codex/hooks.json')));
});

test('setup without a root refuses with usage and writes nothing', () => {
  const r = runSetup([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /codex-trust-setup\.mjs <root>/);
  assert.equal(r.stdout, '');
});

test('setup with a relative root or a foreign folder refuses and leaves the folder alone', () => {
  const rel = runSetup(['relative/root']);
  assert.notEqual(rel.status, 0);
  assert.match(rel.stderr, /absolute path/);
  const foreign = path.join(area(), 'foreign');
  fs.mkdirSync(foreign);
  fs.writeFileSync(path.join(foreign, 'precious.txt'), 'keep');
  const r = runSetup([foreign]);
  assert.notEqual(r.status, 0);
  assert.deepEqual(fs.readdirSync(foreign), ['precious.txt']);
});

test('setup twice leaves one hook file, one project, and no lock', () => {
  const root = path.join(area(), 'root');
  setup(root, { write: () => {} });
  setup(root, { write: () => {} });
  const real = fs.realpathSync(root);
  assert.ok(fs.existsSync(path.join(real, 'project/.codex/hooks.json')));
  assert.equal(fs.existsSync(lockOf(real)), false);
});
