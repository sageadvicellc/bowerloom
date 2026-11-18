// Gate 1 Part A on macOS: a minimal Tauri shell (Rust) starts the Node core as a sidecar and holds it to the same criteria as Part C.
// Channel: one stdin and stdout pipe that only the shell holds. The plan shown last lives in the sidecar, next to the writes it guards.
// The scenarios run in the page of the app (calls go page -> Tauri command -> sidecar pipe). The numbers marked "proposal" are the test values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TAURI, alive, giveUpAfter, launch, run, tempDir, waitFor } from './support.mjs';
import { SHAPES, makeScanFixture } from '../src/fixture.mjs';
import { engineFolder, filesOf } from '../src/engine-folders.mjs';

const PROPOSAL = Object.freeze({ events: 10000, callLimitMs: 30000, recoveryMs: 5000, cycles: 100 });
const BASELINE = SHAPES.find(s => s.baseline === true);
const go = (t, scenario, options) => run(t, scenario, options, TAURI);

test('A1. ping: 1 call sent, 1 returned, from a separate sidecar process', async t => {
  const r = await go(t, 'ping');
  assert.equal(r.sent, 1);
  assert.equal(r.returned, 1);
  assert.equal(r.pong, true);
  assert.equal(r.childIsNotShell, true);
  assert.equal(typeof r.childVersions.node, 'string');
});

test('A2a. a small scan result returns whole through the page: size and hash agree', async t => {
  const made = makeScanFixture(tempDir(t), { projects: 10, skills: 5, fileBytes: 800 });
  const r = await go(t, 'payload', { picked: made.picked, home: made.home });
  assert.equal(r.items, 50);
  assert.equal(r.bytesMatch, true);
  assert.equal(r.digestMatch, true);
});

test('A2b. the baseline payload returns whole through the page', { timeout: 240000 }, async t => {
  const made = makeScanFixture(tempDir(t), BASELINE);
  const r = await go(t, 'payload', { picked: made.picked, home: made.home });
  assert.equal(r.items, BASELINE.projects * BASELINE.skills);
  assert.equal(r.bytesMatch, true);
  assert.equal(r.digestMatch, true);
  assert.ok(r.bytes > 1024 * 1024);
});

test('A3. 10,000 numbered events arrive in the page in order and once each', { timeout: 180000 }, async t => {
  const r = await go(t, 'events', { n: PROPOSAL.events });
  assert.equal(r.received, 10000);
  assert.equal(r.inOrder, true);
  assert.equal(r.duplicates, 0);
  assert.equal(r.missing, 0);
});

test('A4. every call returns or fails within 30 seconds: 3 calls, 1 returns, 2 fail with FAILED', { timeout: 180000 }, async t => {
  const r = await go(t, 'timeout', { limitMs: PROPOSAL.callLimitMs });
  assert.equal(r.calls, 3);
  assert.equal(r.returned, 1);
  assert.equal(r.failedWithFAILED, 2);
  assert.ok(r.maxMs >= PROPOSAL.callLimitMs - 100 && r.maxMs <= PROPOSAL.callLimitMs + 1000, `failed at ${r.maxMs} ms`);
  assert.equal(r.recoveredAfter, true);
});

test('A5. 100 kill-and-restart cycles in a row, each recovered in 5 seconds or less', { timeout: 600000 }, async t => {
  const r = await go(t, 'cycles', { n: PROPOSAL.cycles, limitMs: PROPOSAL.recoveryMs });
  assert.equal(r.n, 100);
  assert.equal(r.recovered, 100);
  assert.equal(r.withinLimit, 100);
  assert.equal(r.distinctChildren, 101);
  assert.ok(r.maxMs <= PROPOSAL.recoveryMs);
});

test('A6. a call in flight when the sidecar dies fails with FAILED and is never replayed', async t => {
  const marker = join(tempDir(t), 'marker.txt');
  writeFileSync(marker, '');
  const r = await go(t, 'inflight', { marker });
  assert.equal(r.code, 'FAILED');
  assert.equal(readFileSync(marker, 'utf8').split('\n').filter(Boolean).length, 1, 'the call ran once');
  assert.equal(r.sentToChild, 1);
  assert.equal(r.newChildSawCall, false);
});

test('A7. after a restart the plan shown last is cleared: NOT_THE_PLAN_SHOWN, and nothing is written', { timeout: 120000 }, async t => {
  const home = join(tempDir(t), 'home');
  mkdirSync(home, { recursive: true });
  const a = engineFolder(home, 'a');
  const b = engineFolder(home, 'b');
  const before = JSON.stringify(filesOf(b));
  const r = await go(t, 'planstate', { home, a, b });
  assert.equal(r.controlWriteOk, true);
  assert.equal(r.afterRestartUnknownFolder, 'UNKNOWN_FOLDER');
  assert.equal(r.afterRestartCode, 'NOT_THE_PLAN_SHOWN');
  assert.equal(JSON.stringify(filesOf(b)), before, 'folder b is unchanged');
  assert.notEqual(JSON.stringify(filesOf(a)), JSON.stringify(filesOf(engineFolder(join(tempDir(t), 'h'), 'a'))), 'the control write changed folder a');
});

test('A8. orphans: the sidecar ends after a normal quit, kill -9 of the shell and a shell crash (3 of 3)', { timeout: 120000 }, async t => {
  const outcomes = {};
  for (const how of ['quit', 'kill9', 'crash']) {
    const started = launch(t, how === 'kill9' ? 'hold' : how, {}, TAURI);
    const pids = await waitFor(() => started.result(), 30000);
    assert.ok(pids, `${how}: the shell reported its process ids (${started.stderr().slice(0, 300)})`);
    assert.ok(alive(pids.mainPid) && alive(pids.childPid), `${how}: both run before the end`);
    if (how === 'kill9') process.kill(pids.mainPid, 'SIGKILL');
    const end = await Promise.race([started.ended, giveUpAfter(30000)]);
    assert.ok(end, `${how}: the shell ended`);
    const gone = await waitFor(() => !alive(pids.childPid), 5000);
    outcomes[how] = { shellEnd: end, childGone: gone === true };
    assert.equal(outcomes[how].childGone, true, `${how}: the sidecar ended within 5 s (${JSON.stringify(end)})`);
  }
  t.diagnostic(`orphan outcomes: ${JSON.stringify(outcomes)}`);
  assert.deepEqual(Object.keys(outcomes), ['quit', 'kill9', 'crash']);
});

const STUCK_LIMIT_MS = 3000; // proposal: not approved

test('A8b. 10 runs: a sidecar stuck in a busy loop ends within 3 s (proposal) after kill -9 of the shell (10 of 10)', { timeout: 300000 }, async t => {
  const times = [];
  for (let run = 0; run < 10; run += 1) {
    const started = launch(t, 'hold-stuck', {}, TAURI);
    const pids = await waitFor(() => started.result(), 30000);
    assert.ok(pids, `run ${run}: the shell reported its process ids`);
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.ok(alive(pids.childPid), `run ${run}: the sidecar runs`);
    const began = Date.now();
    process.kill(pids.mainPid, 'SIGKILL');
    const gone = (await waitFor(() => !alive(pids.childPid), 10000, 10)) === true;
    times.push(gone ? Date.now() - began : null);
    if (!gone) process.kill(pids.childPid, 'SIGKILL');
  }
  t.diagnostic(`stuck sidecar after kill -9, ms to end per run: ${JSON.stringify(times)}`);
  assert.equal(times.filter(ms => ms !== null && ms <= STUCK_LIMIT_MS).length, 10);
});
