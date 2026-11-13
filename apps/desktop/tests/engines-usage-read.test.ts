// How the module reads usage (shared/engines-usage/read.ts): it uses only the two read calls of the runs bridge that already exist (`listRuns` and `readRunFigures`), one at a time, for the newest runs,
// and it turns a failure into a state with a short code. It never calls a call that writes, and it adds no call to any bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSource, readUsage } from '../shared/engines-usage/read.js';
import type { UsageSource } from '../shared/engines-usage/model.js';
import { USAGE_RUN_CAP } from '../shared/engines-usage/model.js';
import { RUN_CALLS } from '../shared/api/runs.js';
import type { RunFigures, RunView, RunsBridge } from '../shared/api/runs.js';
import { fakeFigures, fakeRun } from './engines-usage-fixture.js';

interface Spy { readonly bridge: RunsBridge; readonly calls: string[]; readonly maxOpen: () => number }

/** A runs bridge made of spies. A call that writes throws, so a read that touched one fails loudly. */
function spyBridge(runs: readonly RunView[] | Error, figures: (id: string) => RunFigures | Error = () => fakeFigures()): Spy {
  const calls: string[] = [];
  let open = 0, most = 0;
  const bridge: RunsBridge = {
    listRuns: async () => { calls.push('listRuns'); if (runs instanceof Error) throw runs; return runs; },
    readRunFigures: async (id: string) => {
      calls.push(`readRunFigures:${id}`);
      open += 1; most = Math.max(most, open);
      await new Promise<void>(resolve => setImmediate(resolve));
      open -= 1;
      const answer = figures(id);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    recordRun: async () => { calls.push('recordRun'); throw new Error('a read must not record a run'); },
    updateRun: async () => { calls.push('updateRun'); throw new Error('a read must not change a run'); },
    startNewRunList: async () => { calls.push('startNewRunList'); throw new Error('a read must not reset the list'); },
  };
  return { bridge, calls, maxOpen: () => most };
}
/** The client turns the text of an error into a short code, so the code is in the message. The rest of the message must never reach the screen. */
const refusal = (code: string): Error => new Error(`${code}: a message the page must never show`);
const alive = (): boolean => true;

test('it lists the runs once, reads the figures of each, and answers the runs, the reads and the whole count', async () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'codex', '2026-11-11T09:00:00.000Z')];
  const spy = spyBridge(runs);
  const source = await readUsage(spy.bridge, alive);
  assert.equal(source.kind, 'ready');
  if (source.kind !== 'ready') return;
  assert.deepEqual(source.runs.map(r => r.id), ['run-1', 'run-2']);
  assert.equal(source.total, 2);
  assert.deepEqual([...source.reads.keys()].sort(), ['run-1', 'run-2']);
  assert.equal(source.reads.get('run-1')!.kind, 'figures');
  assert.deepEqual(spy.calls.filter(c => c === 'listRuns').length, 1);
});

test('it uses only the two read calls: a write call is never made, and the call list of the runs bridge is unchanged', async () => {
  const spy = spyBridge([fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z')]);
  await readUsage(spy.bridge, alive);
  assert.deepEqual(spy.calls, ['listRuns', 'readRunFigures:run-1']);
  assert.deepEqual([...RUN_CALLS], ['listRuns', 'recordRun', 'updateRun', 'readRunFigures', 'startNewRunList'], 'this lane adds no call to the runs bridge');
});

test('it reads one log at a time, newest run first, and no more than the cap', async () => {
  const runs = Array.from({ length: USAGE_RUN_CAP + 7 }, (_, i) => fakeRun(`run-${i + 1}`, 'claude-code', `2026-11-${String(10 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z`));
  const spy = spyBridge(runs);
  const source = await readUsage(spy.bridge, alive);
  assert.equal(spy.maxOpen(), 1, 'two reads never run together');
  const read = spy.calls.filter(c => c.startsWith('readRunFigures:')).map(c => c.slice('readRunFigures:'.length));
  assert.equal(read.length, USAGE_RUN_CAP);
  const newest = [...runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0)).slice(0, USAGE_RUN_CAP).map(r => r.id);
  assert.deepEqual(read, newest);
  if (source.kind === 'ready') { assert.equal(source.total, USAGE_RUN_CAP + 7); assert.equal(source.reads.size, USAGE_RUN_CAP); }
});

test('a refused read of one run is kept as that run\'s own state, with the short code and no message, and the other runs are still read', async () => {
  const runs = [fakeRun('run-1', 'claude-code', '2026-11-11T10:00:00.000Z'), fakeRun('run-2', 'claude-code', '2026-11-11T09:00:00.000Z')];
  const spy = spyBridge(runs, id => (id === 'run-1' ? refusal('UNKNOWN_RUN') : fakeFigures()));
  const source = await readUsage(spy.bridge, alive);
  assert.equal(source.kind, 'ready');
  if (source.kind !== 'ready') return;
  assert.deepEqual(source.reads.get('run-1'), { kind: 'refused', code: 'UNKNOWN_RUN' });
  assert.equal(source.reads.get('run-2')!.kind, 'figures');
  assert.equal(JSON.stringify(source).includes('message the page must never show'), false);
});

test('a list that cannot be read is "failed" with its code, never an empty list', async () => {
  const source = await readUsage(spyBridge(refusal('STORE_DAMAGED')).bridge, alive);
  assert.deepEqual(source, { kind: 'failed', code: 'STORE_DAMAGED' });
  const odd = await readUsage(spyBridge(new Error('x')).bridge, alive);
  assert.deepEqual(odd, { kind: 'failed', code: 'FAILED' }, 'an error with no known code is the plain failure');
});

test('a call that throws at once, before it returns a promise, is the same as a call that is refused', async () => {
  const bridge: RunsBridge = { ...spyBridge([]).bridge, listRuns: () => { throw refusal('NOT_ALLOWED'); } };
  assert.deepEqual(await readUsage(bridge, alive), { kind: 'failed', code: 'NOT_ALLOWED' });
});

test('it stops reading when the screen is gone, and answers that it was stopped', async () => {
  const runs = Array.from({ length: 10 }, (_, i) => fakeRun(`run-${i + 1}`, 'codex', `2026-11-11T10:0${i}:00.000Z`));
  const spy = spyBridge(runs);
  let reads = 0;
  const source = await readUsage(spy.bridge, () => { reads += 1; return reads <= 3; });
  assert.equal(source.kind, 'stopped');
  assert.ok(spy.calls.filter(c => c.startsWith('readRunFigures:')).length <= 3);
});

test('no run at all is a ready list with nothing in it and no read', async () => {
  const spy = spyBridge([]);
  const source = await readUsage(spy.bridge, alive);
  assert.equal(source.kind, 'ready');
  if (source.kind === 'ready') { assert.equal(source.total, 0); assert.equal(source.reads.size, 0); }
  assert.deepEqual(spy.calls, ['listRuns']);
});

// ---- fix round 1

test('a list that resolves to nothing, or to something that is no list, is "failed" and never a rejection that leaves the screen waiting', async () => {
  for (const answer of [null, undefined, 'x', 7, {}, { length: 2 }]) {
    const bridge: RunsBridge = { ...spyBridge([]).bridge, listRuns: async () => answer as never };
    assert.deepEqual(await readUsage(bridge, alive), { kind: 'failed', code: 'FAILED' }, String(answer));
  }
});

test('a run with a bad shape makes the list "failed": the list cannot be trusted, and no run is read', async () => {
  for (const bad of [null, 5, 'run-1', { id: 5, engine: 'codex', startedAt: 'x' }, { id: 'run-1', engine: 7, startedAt: 'x' }, { id: 'run-1', engine: 'codex' }]) {
    const spy = spyBridge([bad as never]);
    assert.deepEqual(await readUsage(spy.bridge, alive), { kind: 'failed', code: 'FAILED' }, JSON.stringify(bad));
    assert.deepEqual(spy.calls, ['listRuns']);
  }
});

test('figures with a bad shape are that run\'s refused read with the code FAILED, and good figures are kept', async () => {
  const bads: unknown[] = [null, 'found', 7, [], { state: 'weird' }, { ...fakeFigures(), state: undefined }, { ...fakeFigures(), reason: 'nope' }, { ...fakeFigures(), inputTokens: '12' }, { ...fakeFigures(), outputTokens: Number.NaN },
    { ...fakeFigures(), inputTokens: -1 }, { ...fakeFigures(), durationMs: Infinity }, { ...fakeFigures(), model: 5 }, { ...fakeFigures(), outcome: 'maybe' }, { ...fakeFigures(), inputTokens: undefined }];
  const runs = [...bads.map((_, i) => fakeRun(`run-${i + 1}`, 'claude-code', `2026-11-11T10:${String(i).padStart(2, '0')}:00.000Z`)), fakeRun('run-99', 'codex', '2026-11-10T10:00:00.000Z')];
  const index = new Map(runs.map((r, i) => [r.id, i]));
  const spy = spyBridge(runs, id => (id === 'run-99' ? fakeFigures() : (bads[index.get(id)!] as RunFigures)));
  const source = await readUsage(spy.bridge, alive);
  assert.equal(source.kind, 'ready');
  if (source.kind !== 'ready') return;
  for (const run of runs.slice(0, -1)) assert.deepEqual(source.reads.get(run.id), { kind: 'refused', code: 'FAILED' }, run.id);
  assert.equal(source.reads.get('run-99')!.kind, 'figures');
  assert.equal(source.reads.get('run-99')!.kind === 'figures' && (source.reads.get('run-99') as { figures: RunFigures }).figures.inputTokens, 1000);
});

test('a run of a name that is no engine is left out before the cap, so it takes no place from a real run', async () => {
  const runs = [fakeRun('run-1', 'nonesuch' as never, '2026-11-12T10:00:00.000Z'), fakeRun('run-2', 'other' as never, '2026-11-12T09:00:00.000Z'), fakeRun('run-3', 'codex', '2026-11-11T10:00:00.000Z')];
  const spy = spyBridge(runs);
  const source = await readUsage(spy.bridge, alive);
  assert.deepEqual(spy.calls, ['listRuns', 'readRunFigures:run-3']);
  if (source.kind === 'ready') assert.equal(source.total, 3, 'the whole list is still handed on, so the view can count them');
});

const READY: UsageSource = { kind: 'ready', runs: [], reads: new Map(), total: 0 };

test('a failed read after a good one keeps the good one and notes the code; a good read clears the note; a stopped read changes nothing', () => {
  const kept = nextSource(READY, { kind: 'failed', code: 'STORE_DAMAGED' });
  assert.deepEqual(kept, { ...READY, lastReadFailed: 'STORE_DAMAGED' });
  assert.deepEqual(nextSource(kept, { kind: 'failed', code: 'FAILED' }), { ...READY, lastReadFailed: 'FAILED' });
  assert.deepEqual(nextSource(kept, READY), READY);
  assert.equal(nextSource(kept, { kind: 'stopped' }), kept);
  assert.deepEqual(nextSource({ kind: 'loading' }, { kind: 'failed', code: 'FAILED' }), { kind: 'failed', code: 'FAILED' });
  assert.deepEqual(nextSource({ kind: 'failed', code: 'FAILED' }, READY), READY);
});
