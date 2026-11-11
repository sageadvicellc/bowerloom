// The frozen test and skip inventory (docs/v0.9/test-inventory.json) and the tool that checks a run against it.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { MACHINE_DEPENDENT, MUST_RUN, NEEDS_DECISION, NEVER_RUNS, buildSuite, checkRun, readRun, skipKind, validateRun, unusedKinds } from '../test-inventory.mjs';

const tool = fileURLToPath(new URL('../test-inventory.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8' });
const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const scratch = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-test-')); made.push(dir); return dir; };

const inventoryPath = fileURLToPath(new URL('../../docs/v0.9/test-inventory.json', import.meta.url));
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
const run = (...rows) => rows.map(([file, name, status]) => ({ file, name, status }));

test('a skip with no kinds entry is must-run, a fixme is never-runs, and the kinds file wins', () => {
  assert.equal(skipKind({ file: 'a', name: 'x', status: 'skip' }, {}).kind, MUST_RUN);
  assert.equal(skipKind({ file: 'a', name: 'x', status: 'fixme' }, {}).kind, NEVER_RUNS);
  assert.equal(skipKind({ file: 'a', name: 'x', status: 'skip' }, { a: { kind: NEVER_RUNS, reason: 'FLAG' } }).kind, NEVER_RUNS);
  assert.equal(skipKind({ file: 'a', name: 'x', status: 'todo' }, { 'a::x': { kind: NEEDS_DECISION, reason: 'todo' }, a: { kind: NEVER_RUNS, reason: 'FLAG' } }).kind, NEEDS_DECISION);
});

test('buildSuite lists the names by file, counts each status, and keeps a must-run skip out of the frozen skips', () => {
  const suite = buildSuite({ runner: 'node --test', command: '', cwd: '', kinds: { 'b.js': { kind: NEVER_RUNS, reason: 'FLAG' } },
    run: run(['a.js', 'one', 'pass'], ['a.js', 'two', 'skip'], ['b.js', 'three', 'skip'], ['b.js', 'four', 'todo']) });
  assert.deepEqual(suite.counts, { files: 2, tests: 4, pass: 1, fail: 0, skip: 2, todo: 1, fixme: 0 });
  assert.deepEqual(suite.files, { 'a.js': ['one', 'two'], 'b.js': ['four', 'three'] });
  assert.deepEqual(suite.skips.map(s => s.name), ['four', 'three']);
  assert.deepEqual(suite.observedMustRun.map(s => s.name), ['two']);
});

test('checkRun passes for the same run, and passes for an added test', () => {
  const rows = run(['a.js', 'one', 'pass'], ['a.js', 'two', 'pass']);
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', run: rows });
  assert.deepEqual(checkRun({ frozen, run: rows }), { ok: true, problems: [], needsDecision: [] });
  assert.equal(checkRun({ frozen, run: [...rows, ...run(['a.js', 'three', 'pass'])] }).ok, true);
});

test('checkRun names a frozen test that is missing, a frozen test that failed, and a test that skips without being frozen', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', run: run(['a.js', 'one', 'pass'], ['a.js', 'two', 'pass']) });
  const result = checkRun({ frozen, run: run(['a.js', 'one', 'fail'], ['a.js', 'extra', 'skip']) });
  assert.equal(result.ok, false);
  assert.deepEqual(result.problems.sort(), ['failed: a.js: one', 'missing: a.js: two', 'skipped, not frozen: a.js: extra'].sort());
});

test('checkRun compares skipped names and not only the count: a different test skipping fails even at the same count', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', kinds: { 'a.js': { kind: NEVER_RUNS, reason: 'FLAG' } }, run: run(['a.js', 'shot', 'skip'], ['a.js', 'other', 'pass']) });
  assert.equal(frozen.skips.length, 1);
  const result = checkRun({ frozen, run: run(['a.js', 'shot', 'pass'], ['a.js', 'other', 'skip']) });
  assert.deepEqual(result.problems.sort(), ['frozen never-runs skip ran: a.js: shot', 'skipped, not frozen: a.js: other'].sort());
});

test('a must-run test that skips fails the gate, and one that runs passes', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', run: run(['a.js', 'needs a build', 'skip']) });
  assert.deepEqual(checkRun({ frozen, run: run(['a.js', 'needs a build', 'skip']) }).problems, ['must-run test skipped: a.js: needs a build']);
  assert.equal(checkRun({ frozen, run: run(['a.js', 'needs a build', 'pass']) }).ok, true);
});

test('a mapped test may be missing from the run', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', run: run(['a.js', 'old', 'pass']) });
  assert.equal(checkRun({ frozen, run: [], mapped: [{ file: 'a.js', name: 'old' }] }).ok, true);
  assert.equal(checkRun({ frozen, run: [] }).ok, false);
});

test('readRun reads the JSON lines of the reporter and the JSON of Playwright, naming a fixme and a skip', () => {
  assert.deepEqual(readRun('{"file":"a","name":"n","status":"pass"}\n\n', 'jsonl'), [{ file: 'a', name: 'n', status: 'pass' }]);
  const report = { suites: [{ title: 'f.spec.ts', file: 'f.spec.ts', specs: [
    { title: 'plain', file: 'f.spec.ts', tests: [{ status: 'expected', annotations: [] }] },
    { title: 'flagged', file: 'f.spec.ts', tests: [{ status: 'skipped', annotations: [{ type: 'skip', description: 'why' }] }] },
    { title: 'later', file: 'f.spec.ts', tests: [{ status: 'skipped', annotations: [{ type: 'fixme' }] }] },
    { title: 'broken', file: 'f.spec.ts', tests: [{ status: 'unexpected', annotations: [] }] }] }] };
  assert.deepEqual(readRun(JSON.stringify(report), 'playwright').map(t => [t.name, t.status]), [['plain', 'pass'], ['flagged', 'skip'], ['later', 'fixme'], ['broken', 'fail']]);
});

test('the frozen inventory holds the three suites, with counts that match the lists', () => {
  assert.deepEqual(Object.keys(inventory.suites).sort(), ['desktop', 'e2e', 'root']);
  for (const [name, suite] of Object.entries(inventory.suites)) {
    const tests = Object.values(suite.files).reduce((sum, names) => sum + names.length, 0);
    assert.equal(suite.counts.tests, tests, `${name}: counts.tests is the number of names`);
    assert.equal(suite.counts.files, Object.keys(suite.files).length, `${name}: counts.files`);
    assert.equal(suite.counts.pass + suite.counts.fail + suite.counts.skip + suite.counts.todo + suite.counts.fixme, tests, `${name}: statuses add up`);
    assert.equal(suite.counts.fail, 0, `${name}: the base recorded no failing test`);
    assert.equal(suite.skips.length + suite.observedMustRun.length, suite.counts.skip + suite.counts.todo + suite.counts.fixme, `${name}: every skip is listed once`);
  }
});

test('every frozen skip names a test that is in the files list, and the kinds follow the rule', () => {
  for (const [name, suite] of Object.entries(inventory.suites)) {
    for (const skip of [...suite.skips, ...suite.observedMustRun]) {
      assert.ok((suite.files[skip.file] ?? []).includes(skip.name), `${name}: ${skip.file}: ${skip.name}`);
      assert.equal(typeof skip.reason, 'string');
    }
    for (const skip of suite.skips) assert.ok([NEVER_RUNS, NEEDS_DECISION, MACHINE_DEPENDENT].includes(skip.kind), `${name}: ${skip.name}`);
    for (const skip of suite.observedMustRun) assert.equal(skip.kind, MUST_RUN);
    for (const skip of suite.skips.filter(s => s.status === 'fixme')) assert.equal(skip.kind, NEVER_RUNS, 'every fixme is never-runs');
  }
});

test('the desktop and end-to-end inventories freeze the skips the base showed, by name', () => {
  const e2e = inventory.suites.e2e;
  assert.equal(e2e.skips.filter(s => s.kind === NEVER_RUNS && s.status === 'fixme').length, 2);
  assert.equal(e2e.skips.filter(s => /(?:docs|landing|screen-tour)-shots\.spec\.ts$/.test(s.file)).length, e2e.skips.filter(s => s.status === 'skip' && s.kind !== MACHINE_DEPENDENT).length);
  assert.ok(e2e.observedMustRun.some(s => /packaged-app\.spec\.ts$/.test(s.file)), 'the packaged-app skip is must-run');
  assert.equal(inventory.suites.desktop.skips.filter(s => s.kind !== MACHINE_DEPENDENT).length, 0, 'no desktop unit test skips on an environment flag');
});

test('a must-run test that turns fixme or todo fails the gate like a skip', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', run: run(['a.js', 't', 'skip']) });
  for (const status of ['fixme', 'todo']) assert.deepEqual(checkRun({ frozen, run: run(['a.js', 't', status]) }).problems, ['must-run test skipped: a.js: t']);
});

test('checkRun reports needs-decision skips by name and keeps ok true', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', kinds: { a: { kind: NEEDS_DECISION, reason: 'x' } }, run: run(['a', 'one', 'todo'], ['a', 'two', 'pass']) });
  const result = checkRun({ frozen, run: run(['a', 'one', 'todo'], ['a', 'two', 'pass']) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.needsDecision, ['a: one']);
});

test('validateRun refuses an empty run and a run with a failing test', () => {
  assert.match(validateRun([]), /0 tests/);
  assert.match(validateRun(run(['a', 'x', 'fail'])), /fail/);
  assert.equal(validateRun(run(['a', 'x', 'pass'])), null);
});

test('unusedKinds names a kinds key that matches no skip', () => {
  const rows = run(['a', 'x', 'skip']);
  assert.deepEqual(unusedKinds(rows, { a: { kind: NEVER_RUNS, reason: 'r' }, b: { kind: NEVER_RUNS, reason: 'r' }, 'a::nope': { kind: NEVER_RUNS, reason: 'r' } }).sort(), ['a::nope', 'b']);
});

test('the command refuses an empty file, a failing run, an empty frozen suite and a misspelled flag', () => {
  const dir = scratch();
  const empty = path.join(dir, 'empty.jsonl'); fs.writeFileSync(empty, '');
  const failing = path.join(dir, 'fail.jsonl'); fs.writeFileSync(failing, '{"file":"a","name":"x","status":"fail"}\n');
  const good = path.join(dir, 'good.jsonl'); fs.writeFileSync(good, '{"file":"a","name":"x","status":"pass"}\n');
  const kinds = path.join(dir, 'kinds.json'); fs.writeFileSync(kinds, '{}');
  const inv = path.join(dir, 'inv.json');
  assert.notEqual(cli('record', 'root', empty, kinds, '--merge', inv).status, 0);
  assert.notEqual(cli('record', 'root', failing, kinds, '--merge', inv).status, 0);
  assert.equal(fs.existsSync(inv), false, 'nothing is written for a refused run');
  assert.notEqual(cli('record', 'root', good, kinds, '--mrege', inv).status, 0);
  assert.equal(cli('record', 'root', good, kinds, '--merge', inv).status, 0);
  fs.writeFileSync(inv, JSON.stringify({ suites: { root: { counts: { tests: 0 }, files: {}, skips: [] } } }));
  assert.notEqual(cli('check', 'root', good, inv).status, 0);
  assert.notEqual(cli('check', 'root', empty, inv).status, 0);
});

test('check prints the needs-decision line and exits 0 for the frozen inventory', () => {
  const dir = scratch();
  const rows = path.join(dir, 'r.jsonl');
  const suite = inventory.suites.desktop;
  fs.writeFileSync(rows, Object.entries(suite.files).flatMap(([file, names]) => names.map(name => JSON.stringify({ file, name, status: 'pass' }))).join('\n') + '\n');
  const r = cli('check', 'desktop', rows);
  assert.equal(r.status, 0, r.stderr);
  const root = inventory.suites.root;
  const rootRows = path.join(dir, 'root.jsonl');
  const status = (file, name) => { const s = root.skips.find(x => x.file === file && x.name === name); return s === undefined ? 'pass' : s.status; };
  fs.writeFileSync(rootRows, Object.entries(root.files).flatMap(([file, names]) => names.map(name => JSON.stringify({ file, name, status: status(file, name) }))).join('\n') + '\n');
  const rr = cli('check', 'root', rootRows);
  assert.equal(rr.status, 0, rr.stderr);
  assert.match(rr.stdout, /needs-decision: 7 skips unsorted/);
});

const machineDependent = [
  ['dist/tests/support/lock-slot-retry.js', '20. a path of more than 1024 bytes below home refuses FOLDER_UNSAFE', /1024/],
  ['dist/tests/support/lock-slot-retry.js', 'P6: two definition files that differ only in case are refused (case-sensitive file systems only)', /folds case|case-insensitive/],
  ['packages/project-context/test/discovery.test.mjs', 'L5: an alias of .bowerloom beside the pinned folder is refused when the pins are checked', /case-insensitive/],
  ['packages/skill-sources/test/remove-cache.test.mjs', '3 (real owner). an entry that another user owns refuses CACHE_PRUNE_FAILED', /root/],
];

test('the four machine-dependent root skips are frozen by name as machine-dependent, each reason names its real condition', () => {
  const root = inventory.suites.root;
  for (const [file, name, keyword] of machineDependent) {
    const entry = root.skips.find(s => s.file === file && s.name === name);
    assert.ok(entry, `${name} is a frozen skip`);
    assert.equal(entry.kind, MACHINE_DEPENDENT);
    assert.match(entry.reason, keyword, `${name}: the reason names the real condition`);
    assert.doesNotMatch(entry.reason, /System\/Volumes/, 'no reason names the alias test condition');
    assert.equal(root.observedMustRun.some(s => s.file === file && s.name === name), false);
  }
});

test('the counts by kind: 3 must-run, 7 needs-decision, 121 machine-dependent (4 of the base, 117 of the sandbox work), 40 flag-gated never-runs in root', () => {
  const must = Object.values(inventory.suites).flatMap(s => s.observedMustRun.map(m => m.file));
  assert.deepEqual(must.map(f => path.basename(f)).sort(), ['launch.test.mjs', 'packaged-app.spec.ts', 'packaging.test.mjs']);
  const root = inventory.suites.root;
  const kind = k => root.skips.filter(s => s.kind === k).length;
  assert.equal(root.observedMustRun.length, 0);
  assert.equal(kind(NEEDS_DECISION), 7);
  assert.equal(kind(MACHINE_DEPENDENT), 121);
  assert.equal(kind(NEVER_RUNS), 40);
});

test('the base root run checks clean, whether the machine-dependent tests skip or pass', () => {
  const root = inventory.suites.root;
  const rows = ran => Object.entries(root.files).flatMap(([file, names]) => names.map(name => {
    const s = root.skips.find(x => x.file === file && x.name === name);
    return { file, name, status: s === undefined ? 'pass' : (ran && s.kind === MACHINE_DEPENDENT ? 'pass' : s.status) };
  }));
  for (const ran of [false, true]) { const result = checkRun({ frozen: root, run: rows(ran) }); assert.deepEqual(result.problems, []); assert.equal(result.needsDecision.length, 7); }
});

test('a machine-dependent test may skip or pass, and fails the check when it fails, turns fixme, or goes missing', () => {
  const frozen = buildSuite({ runner: 'r', command: '', cwd: '', kinds: { 'a.js::m': { kind: MACHINE_DEPENDENT, reason: 'root' } }, run: run(['a.js', 'm', 'skip'], ['a.js', 'o', 'pass']) });
  const other = ['a.js', 'o', 'pass'];
  assert.equal(frozen.skips[0].kind, MACHINE_DEPENDENT);
  assert.equal(checkRun({ frozen, run: run(['a.js', 'm', 'skip'], other) }).ok, true);
  assert.equal(checkRun({ frozen, run: run(['a.js', 'm', 'pass'], other) }).ok, true);
  assert.deepEqual(checkRun({ frozen, run: run(['a.js', 'm', 'fail'], other) }).problems, ['failed: a.js: m']);
  assert.deepEqual(checkRun({ frozen, run: run(['a.js', 'm', 'fixme'], other) }).problems, ['machine-dependent test neither passed nor skipped: a.js: m']);
  assert.deepEqual(checkRun({ frozen, run: run(other) }).problems, ['missing: a.js: m']);
});

test('the skips of the sandbox work are frozen as machine-dependent in every suite, and the two desktop tests PR 173 renamed are listed under their new titles', () => {
  const kinds = name => inventory.suites[name].skips.filter(s => s.kind === MACHINE_DEPENDENT).length;
  assert.equal(kinds('desktop'), 14);
  assert.equal(kinds('e2e'), 6);
  const e2e = inventory.suites.e2e.skips.filter(s => s.file === 'apps/desktop/e2e/harness-close-guard.spec.ts');
  assert.ok(e2e.length >= 2 && e2e.every(s => s.kind === MACHINE_DEPENDENT), 'the close-guard specs skip off macOS');
  const names = file => inventory.suites.desktop.files[file];
  assert.ok(names('.build/tests/sample-preview.test.mjs').includes('the page reads the attribute once, to make its sample world, and only the API client does it'));
  assert.equal(names('.build/tests/sample-preview.test.mjs').includes('the page reads the attribute once, to make its sample world'), false);
  assert.ok(names('.build/tests/harness-boundary.test.mjs').some(n => n.startsWith('only the real screens, the mount file, the root of the preview')));
  assert.equal(names('.build/tests/harness-boundary.test.mjs').some(n => n.startsWith('only the real screens, the mount file and the call lanes')), false);
  for (const suite of Object.values(inventory.suites)) for (const skip of suite.skips) assert.notEqual(skip.reason.trim(), '', skip.name);
});

test('the response-headers test stays a recorded machine-dependent skip on Node 24.21.0, and the guard test is not a skip', () => {
  const skips = inventory.suites.root.skips;
  const header = skips.find(s => s.file === 'packages/skill-sources/test/response-headers.test.mjs');
  assert.equal(header?.name, 'a guarded repeat after 1000 padding headers refuses, including when Node dropped the repeat');
  assert.equal(header.kind, MACHINE_DEPENDENT);
  assert.match(header.reason, /Node 24\.21\.0/);
  assert.equal(skips.some(s => s.file === 'tools/cli-distribution/test/installed-container.test.mjs'), false);
});
