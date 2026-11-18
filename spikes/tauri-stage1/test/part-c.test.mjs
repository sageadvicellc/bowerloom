// Gate 1 Part C on macOS: the Electron main process starts the Node core in a child process (utilityProcess) and holds it to the criteria below.
// The numbers marked "proposal" in the plan are the test values: 10,000 events, 30 seconds, 5 seconds, 100 cycles. They are not approved yet.
// Run against the dev Electron by default, or against a packaged app when SPIKE_ELECTRON_EXE names its executable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ELECTRON_EXE, alive, giveUpAfter, launch, run, tempDir, waitFor } from './support.mjs';
import { SHAPES, makeScanFixture } from '../src/fixture.mjs';

const PROPOSAL = Object.freeze({ events: 10000, callLimitMs: 30000, recoveryMs: 5000, cycles: 100 });
const BASELINE = SHAPES.find(s => s.baseline === true);

test('C1. ping: 1 call sent, 1 returned', async t => {
  const r = await run(t, 'ping');
  assert.equal(r.sent, 1);
  assert.equal(r.returned, 1);
  assert.equal(r.pong, true);
  assert.equal(r.childIsNotMain, true, 'the core runs in its own process');
  assert.match(r.versions.electron, /^44\./);
  assert.equal(typeof r.versions.node, 'string');
  assert.equal(r.childVersions.electron, r.versions.electron, 'the child runs on the same Electron');
});

test('C2a. a small scan result returns whole: size and hash agree on both sides', async t => {
  const root = tempDir(t);
  const made = makeScanFixture(root, { projects: 10, skills: 5, fileBytes: 800 });
  const r = await run(t, 'payload', { picked: made.picked, home: made.home });
  assert.equal(r.items, 50);
  assert.equal(r.bytesMatch, true);
  assert.equal(r.digestMatch, true);
  assert.ok(r.bytes > 20000, `bytes ${r.bytes}`);
});

test('C2b. the baseline payload (the largest scan result, step 1) returns whole', { timeout: 180000 }, async t => {
  assert.ok(BASELINE, 'one shape in SHAPES is marked baseline');
  const root = tempDir(t);
  const made = makeScanFixture(root, BASELINE);
  const r = await run(t, 'payload', { picked: made.picked, home: made.home });
  assert.equal(r.items, BASELINE.projects * BASELINE.skills);
  assert.equal(r.bytesMatch, true);
  assert.equal(r.digestMatch, true);
  assert.ok(r.bytes > 1024 * 1024, `bytes ${r.bytes}`);
});

test('C3. 10,000 numbered events arrive in order and once each', { timeout: 120000 }, async t => {
  const r = await run(t, 'events', { n: PROPOSAL.events });
  assert.equal(r.n, 10000);
  assert.equal(r.received, 10000);
  assert.equal(r.inOrder, true);
  assert.equal(r.duplicates, 0);
  assert.equal(r.missing, 0);
});

test('C4. every call returns or fails within 30 seconds: 3 calls, 1 returns, 2 fail with FAILED (a hang and a busy loop)', { timeout: 120000 }, async t => {
  const r = await run(t, 'timeout', { limitMs: PROPOSAL.callLimitMs });
  assert.equal(r.calls, 3);
  assert.equal(r.returned, 1);
  assert.equal(r.failedWithFAILED, 2);
  assert.ok(r.maxMs >= PROPOSAL.callLimitMs - 100, `a stuck call failed at ${r.maxMs} ms, not before the limit`);
  assert.ok(r.maxMs <= PROPOSAL.callLimitMs + 1000, `a stuck call failed at ${r.maxMs} ms, within 1 s of the limit`);
  assert.equal(r.recoveredAfter, true, 'both children came back and answered a ping');
});

test('C5. 100 kill-and-restart cycles in a row, each recovered in 5 seconds or less', { timeout: 600000 }, async t => {
  const r = await run(t, 'cycles', { n: PROPOSAL.cycles, limitMs: PROPOSAL.recoveryMs });
  assert.equal(r.n, 100);
  assert.equal(r.recovered, 100);
  assert.equal(r.withinLimit, 100);
  assert.equal(r.distinctChildren, 101, 'each cycle ran in a new child (100 restarts plus the first)');
  assert.ok(r.maxMs <= PROPOSAL.recoveryMs, `slowest recovery ${r.maxMs} ms`);
});

test('C6. a call in flight when the child dies fails with FAILED and is never replayed', async t => {
  const r = await run(t, 'inflight');
  assert.equal(r.code, 'FAILED');
  assert.equal(r.markerLines, 1, 'the call ran once in the old child and not again');
  assert.equal(r.sentToChild, 1);
  assert.equal(r.newChildSawCall, false);
});

test('C7. after a restart the plan shown last is cleared: a write returns NOT_THE_PLAN_SHOWN and writes nothing', { timeout: 120000 }, async t => {
  const home = join(tempDir(t), 'home');
  mkdirSync(home, { recursive: true });
  const r = await run(t, 'planstate', { home });
  assert.equal(r.controlWriteOk, true, 'before the kill the shown plan is accepted and written');
  assert.equal(r.afterRestartUnknownFolder, 'UNKNOWN_FOLDER', 'a folder id of the old child is unknown to the new one');
  assert.equal(r.afterRestartCode, 'NOT_THE_PLAN_SHOWN');
  assert.equal(r.folderUnchanged, true);
});

test('C8. orphans: the child ends after a normal quit, a forced end and a crash of the main process (3 of 3)', { timeout: 120000 }, async t => {
  const outcomes = {};
  for (const how of ['quit', 'kill9', 'crash']) {
    const started = launch(t, how === 'kill9' ? 'hold' : how);
    const pids = await waitFor(() => started.result(), 30000);
    assert.ok(pids, `${how}: the app reported its process ids`);
    assert.ok(alive(pids.mainPid) && alive(pids.childPid), `${how}: both processes run before the end`);
    if (how === 'kill9') process.kill(pids.mainPid, 'SIGKILL');
    const end = await Promise.race([started.ended, giveUpAfter(30000)]);
    assert.ok(end, `${how}: the main process ended`);
    const gone = await waitFor(() => !alive(pids.childPid), 5000);
    outcomes[how] = { mainEnd: end, childGone: gone === true };
    assert.equal(outcomes[how].childGone, true, `${how}: the child ended within 5 s of the main process (${JSON.stringify(end)})`);
  }
  t.diagnostic(`orphan outcomes: ${JSON.stringify(outcomes)}`);
  assert.deepEqual(Object.keys(outcomes), ['quit', 'kill9', 'crash']);
});

test('C8b. a normal quit that does not stop the child itself (the host stop is off) still ends the child: Electron cleans up (1 of 1)', { timeout: 60000 }, async t => {
  const started = launch(t, 'quit', { noStop: true });
  const pids = await waitFor(() => started.result(), 30000);
  assert.ok(pids && alive(pids.childPid));
  const end = await Promise.race([started.ended, giveUpAfter(30000)]);
  assert.ok(end, 'the main process ended');
  assert.equal(await waitFor(() => !alive(pids.childPid), 5000), true, `the child ended within 5 s (${JSON.stringify(end)})`);
});

test('C9. the Electron binary under test exists', () => {
  assert.ok(existsSync(ELECTRON_EXE), `no Electron at ${ELECTRON_EXE}`);
});
