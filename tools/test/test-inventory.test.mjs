// The frozen test and skip inventory (docs/v0.9/test-inventory.json) and the tool that checks a run against it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MUST_RUN, NEEDS_DECISION, NEVER_RUNS, buildSuite, checkRun, readRun, skipKind } from '../test-inventory.mjs';

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
  assert.deepEqual(checkRun({ frozen, run: rows }), { ok: true, problems: [] });
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
    for (const skip of suite.skips) assert.ok([NEVER_RUNS, NEEDS_DECISION].includes(skip.kind), `${name}: ${skip.name}`);
    for (const skip of suite.observedMustRun) assert.equal(skip.kind, MUST_RUN);
    for (const skip of suite.skips.filter(s => s.status === 'fixme')) assert.equal(skip.kind, NEVER_RUNS, 'every fixme is never-runs');
  }
});

test('the desktop and end-to-end inventories freeze the skips the base showed, by name', () => {
  const e2e = inventory.suites.e2e;
  assert.equal(e2e.skips.filter(s => s.kind === NEVER_RUNS && s.status === 'fixme').length, 2);
  assert.equal(e2e.skips.filter(s => /(?:docs|landing|screen-tour)-shots\.spec\.ts$/.test(s.file)).length, e2e.skips.filter(s => s.status === 'skip').length);
  assert.ok(e2e.observedMustRun.some(s => /packaged-app\.spec\.ts$/.test(s.file)), 'the packaged-app skip is must-run');
  assert.equal(inventory.suites.desktop.skips.length, 0, 'no desktop unit test skips on an environment flag');
});
