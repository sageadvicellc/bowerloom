import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseCounts, firstFailure } from '../lib/output-parse.mjs';

const made = [];
test.after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });
const tmp = () => { const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'output-parse-test-'))); made.push(dir); return dir; };

// Sample output written by hand in the shapes the real tools print.
const SPEC = ['▶ suite', '  ✔ a (1.2ms)', '▶ suite (3ms)', 'ℹ tests 5', 'ℹ suites 1', 'ℹ pass 3', 'ℹ fail 1', 'ℹ cancelled 0', 'ℹ skipped 1', 'ℹ todo 0', 'ℹ duration_ms 55.1'].join('\n');
const TAP = ['TAP version 13', 'ok 1 - a', 'not ok 2 - b', '1..2', '# tests 2', '# suites 0', '# pass 1', '# fail 1', '# cancelled 0', '# skipped 0', '# todo 0'].join('\n');
const PLAYWRIGHT = ['Running 12 tests using 1 worker', '  1) [electron] › e2e/a.spec.ts:4:1 › opens ──────', '', '  1 failed', '    [electron] › e2e/a.spec.ts:4:1 › opens', '  2 skipped', '  9 passed (14.5s)'].join('\n');

test('parseCounts reads the spec form, the tap form, and Playwright totals', () => {
  assert.deepEqual(parseCounts(SPEC), { pass: 3, fail: 1, skipped: 1 });
  assert.deepEqual(parseCounts(TAP), { pass: 1, fail: 1, skipped: 0 });
  assert.deepEqual(parseCounts(PLAYWRIGHT), { pass: 9, fail: 1, skipped: 2 });
});

test('parseCounts and firstFailure read the real output of node --test, in both reporters', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'a.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok', () => {}); test('later', { skip: true }, () => {}); test('bad case', () => assert.equal(1, 2));");
  for (const reporter of ['spec', 'tap']) {
    const run = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, 'a.test.mjs'], { cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.equal(run.status, 1);
    assert.deepEqual(parseCounts(run.stdout + run.stderr), { pass: 1, fail: 1, skipped: 1 }, reporter);
    assert.match(firstFailure(run.stdout + run.stderr), /bad case/, reporter);
  }
});

test('parseCounts sees through colour codes and returns null when no summary is present', () => {
  assert.deepEqual(parseCounts('\u001b[34mℹ pass 7\u001b[39m\n\u001b[34mℹ fail 0\u001b[39m'), { pass: 7, fail: 0, skipped: 0 });
  assert.equal(parseCounts('tsc finished\n'), null);
  assert.equal(parseCounts(''), null);
  assert.equal(parseCounts(undefined), null);
});

test('parseCounts does not take a stray "pass" line from the middle of a log', () => {
  assert.equal(parseCounts('this will pass 4 times\nnothing else'), null);
});

test('parseCounts sums pass, skipped, and fail over every summary block, node and Playwright together', () => {
  const nested = ['ℹ tests 9', 'ℹ pass 9', 'ℹ fail 0', 'ℹ skipped 0', 'some other output', SPEC].join('\n');
  assert.deepEqual(parseCounts(nested), { pass: 12, fail: 1, skipped: 1 });
  // A node runner and a Playwright runner in one step add up, whichever comes first; a failing block of either kind fails the step.
  assert.deepEqual(parseCounts(['  3 passed (1s)', 'ℹ pass 8', 'ℹ fail 0', 'ℹ skipped 0'].join('\n')), { pass: 11, fail: 0, skipped: 0 });
  assert.deepEqual(parseCounts(['ℹ pass 8', 'ℹ fail 0', 'ℹ skipped 0', 'then e2e', '  1 failed', '  3 passed (1s)'].join('\n')), { pass: 11, fail: 1, skipped: 0 });
  assert.deepEqual(parseCounts(['ℹ pass 0', 'ℹ fail 1', 'x', '  3 passed (1s)'].join('\n')), { pass: 3, fail: 1, skipped: 0 });
  // Two Playwright blocks add up.
  assert.deepEqual(parseCounts(['  3 passed (1s)', 'later output', '  9 passed (4s)'].join('\n')), { pass: 12, fail: 0, skipped: 0 });
  // A bare "3 passed" with no duration is not a Playwright summary.
  assert.equal(parseCounts('3 passed\n'), null);
});

test('parseCounts reads every summary block: a failing block makes the result a failure even when a later block passes', () => {
  // (a) one failing block, then a passing one (two runners in one command).
  const failFirst = ['ℹ tests 3', 'ℹ pass 1', 'ℹ fail 2', 'ℹ cancelled 0', 'ℹ skipped 0', 'second runner starts', 'ℹ tests 5', 'ℹ pass 5', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 0'].join('\n');
  const mixed = parseCounts(failFirst);
  assert.equal(mixed.pass, 6);
  assert.equal(mixed.fail, 2);
  // (b) a cancelled test in the first block counts as a failure too.
  assert.equal(parseCounts('ℹ pass 4\nℹ fail 0\nℹ cancelled 1\nℹ skipped 0\nnext\nℹ pass 9\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0').fail, 1);
  // (c) two passing blocks stay a pass, with the totals added.
  assert.deepEqual(parseCounts('ℹ pass 4\nℹ fail 0\nmore\nℹ pass 9\nℹ fail 0\nℹ skipped 2'), { pass: 13, fail: 0, skipped: 2 });
  // (d) the same holds for Playwright blocks.
  assert.equal(parseCounts(['  1 failed', '  2 passed (3s)', 'later', '  9 passed (4s)'].join('\n')).fail, 1);
});

test('parseCounts judges a step by the combined totals: a first runner that ran no tests does not hide a second that ran some', () => {
  const none = ['ℹ tests 0', 'ℹ pass 0', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 0'];
  const five = ['ℹ tests 5', 'ℹ pass 5', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 1'];
  assert.deepEqual(parseCounts([...none, 'second runner', ...five].join('\n')), { pass: 5, fail: 0, skipped: 1 });
  assert.deepEqual(parseCounts([...five, 'second runner', ...none].join('\n')), { pass: 5, fail: 0, skipped: 1 });
  // A failure in any block fails the step, wherever it sits.
  const failing = ['ℹ tests 2', 'ℹ pass 1', 'ℹ fail 1', 'ℹ cancelled 0', 'ℹ skipped 0'];
  assert.equal(parseCounts([...failing, 'x', ...five].join('\n')).fail, 1);
  assert.equal(parseCounts([...five, 'x', ...failing].join('\n')).fail, 1);
  assert.deepEqual(parseCounts([...none, 'x', ...five].join('\n').replace(/ℹ/g, '#')), { pass: 5, fail: 0, skipped: 1 });
  // The same holds for Playwright.
  assert.deepEqual(parseCounts(['  1 skipped', 'x', '  5 passed (2s)'].join('\n')), { pass: 5, fail: 0, skipped: 1 });
});

test('parseCounts counts cancelled node tests as failures', () => {
  assert.deepEqual(parseCounts('ℹ pass 2\nℹ fail 0\nℹ cancelled 1\nℹ skipped 0'), { pass: 2, fail: 1, skipped: 0 });
});

test('firstFailure picks the strongest failure-looking line and trims it', () => {
  assert.equal(firstFailure('x\nsrc/a.ts(3,4): error TS2322: Type string is not assignable\nmore'), 'src/a.ts(3,4): error TS2322: Type string is not assignable');
  assert.equal(firstFailure(SPEC.replace('  ✔ a (1.2ms)', '  ✖ broken thing (2ms)')), '✖ broken thing (2ms)');
  assert.equal(firstFailure(TAP), 'not ok 2 - b');
  assert.equal(firstFailure(PLAYWRIGHT), '1) [electron] › e2e/a.spec.ts:4:1 › opens ──────');
  assert.equal(firstFailure('line\nnpm error Missing script: "x"\nnpm error more'), 'npm error Missing script: "x"');
  assert.equal(firstFailure('a\nAssertionError [ERR_ASSERTION]: boom'), 'AssertionError [ERR_ASSERTION]: boom');
});

test('firstFailure prefers a strong line (check mark, not ok, error TS, npm error) over an earlier Error: line from a passing test', () => {
  assert.equal(firstFailure('Error: logged by a passing test\n  ✖ the real failure (2ms)'), '✖ the real failure (2ms)');
  assert.equal(firstFailure('AssertionError: printed by a passing test\nnot ok 3 - real'), 'not ok 3 - real');
  assert.equal(firstFailure('TypeError: noise\nnpm error code ELIFECYCLE'), 'npm error code ELIFECYCLE');
});

test('firstFailure anchors the Error patterns: prose that mentions an error is not a failure', () => {
  const clean = ['  ✔ handles an AssertionError thrown by the helper (1ms)', '  ✔ ensures the folder exists', '  ✔ Expected value is returned', 'ok 1 - Expected value', 'ℹ fail 0', '# fail 0', 'last line'].join('\n');
  assert.equal(firstFailure(clean), 'last line');
  for (const line of ['ensures', 'Expected', 'ℹ fail 0', 'ok 1 - Expected value', 'the AssertionError class', 'no TypeError: here']) {
    assert.equal(firstFailure(`${line}\nend`), 'end', line);
  }
});

test('firstFailure falls back to the last non-empty line, caps at 200 characters, and strips colour', () => {
  assert.equal(firstFailure('first\nlast one\n\n'), 'last one');
  assert.equal(firstFailure('x'.repeat(500) + '\nerror TS1: ' + 'y'.repeat(500)).length, 200);
  assert.equal(firstFailure('\u001b[31mnot ok 1 - red\u001b[39m'), 'not ok 1 - red');
  assert.equal(firstFailure(''), null);
  assert.equal(firstFailure(undefined), null);
});

test('parseCounts starts a new summary block when a key repeats, so two runs printed back to back are both counted', () => {
  // Two node summaries with no line between them: the second `pass` must not overwrite the first.
  assert.deepEqual(parseCounts(['ℹ pass 4', 'ℹ fail 1', 'ℹ skipped 0', 'ℹ pass 9', 'ℹ fail 0', 'ℹ skipped 2'].join('\n')), { pass: 13, fail: 1, skipped: 2 });
  assert.deepEqual(parseCounts(['# pass 4', '# fail 0', '# pass 5', '# fail 2'].join('\n')), { pass: 9, fail: 2, skipped: 0 });
  // A failure in the first of two back-to-back blocks is not hidden by the second.
  assert.equal(parseCounts(['ℹ pass 1', 'ℹ fail 3', 'ℹ pass 8', 'ℹ fail 0'].join('\n')).fail, 3);
  // The same for Playwright.
  assert.deepEqual(parseCounts(['  1 failed', '  2 passed (3s)', '  1 failed', '  4 passed (2s)'].join('\n')), { pass: 6, fail: 2, skipped: 0 });
  // A cancelled count and a fail count in the same block are different keys and stay one block.
  assert.deepEqual(parseCounts(['ℹ pass 4', 'ℹ fail 1', 'ℹ cancelled 2', 'ℹ skipped 0'].join('\n')), { pass: 4, fail: 3, skipped: 0 });
});

test('parseCounts treats Playwright "did not run" and "interrupted" as failures', () => {
  assert.deepEqual(parseCounts(['  2 did not run', '  3 passed (1s)'].join('\n')), { pass: 3, fail: 2, skipped: 0 });
  assert.deepEqual(parseCounts(['  1 interrupted', '  3 passed (1s)'].join('\n')), { pass: 3, fail: 1, skipped: 0 });
  assert.deepEqual(parseCounts(['  1 flaky', '  3 passed (1s)'].join('\n')), { pass: 3, fail: 0, skipped: 0 }, 'a flaky test passed on retry');
});
