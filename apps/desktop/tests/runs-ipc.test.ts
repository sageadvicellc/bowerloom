// The four calls of the bowerloomRuns bridge, answered in main (main/runs-ipc.ts): the channels, the sender check, the argument count and shape, the folder lookup, the answers, and the rule
// that no full path and no chat text reaches the page. No real log and no real home: the store and the reader of figures are real over a made-up state folder, or faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { writeFileSync } from 'node:fs';
import { NO_FIGURES, RUN_CALLS, RUN_CHANNELS } from '../shared/api/runs.js';
import type { RunFigures } from '../shared/api/runs.js';
import { runsFile } from '../main/run-store.js';
import { registerRunsIpc } from '../main/runs-ipc.js';
import type { FolderRef } from '../main/runs-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { tempDir } from './support.js';

type Handler = (event: RealEvent, ...args: unknown[]) => unknown;
const GOOD: RealEvent = { senderFrame: { url: APP_INDEX, parent: null } };
const BAD_SENDERS: Record<string, RealEvent> = {
  'no frame': { senderFrame: null }, 'a foreign page': { senderFrame: { url: 'https://example.com/', parent: null } },
  'a file page': { senderFrame: { url: 'file:///etc/hosts', parent: null } }, 'a child frame of the app page': { senderFrame: { url: APP_INDEX, parent: {} } },
};
const NOW = Date.parse('2026-11-11T12:00:00Z');
const FOLDERS: Record<string, FolderRef> = { 'folder-1': { dir: '/Users/someone/Projects/team', name: 'team', label: '~/Projects/team' } };

interface Rig { readonly state: string; readonly handlers: Map<string, Handler>; readonly told: string[]; readonly asked: { engine: string; projectDir: string; startedAt: string }[] }
function rig(t: TestContext, figures: (q: { engine: string; projectDir: string; startedAt: string }) => Promise<RunFigures> = async () => NO_FIGURES('not-found')): Rig {
  const handlers = new Map<string, Handler>(), told: string[] = [], asked: Rig['asked'] = [], state = tempDir(t);
  registerRunsIpc({
    ipc: { handle: (channel, listener) => { assert.equal(handlers.has(channel), false, `${channel} registered twice`); handlers.set(channel, listener as Handler); } },
    appIndexUrl: APP_INDEX, home: '/Users/someone', stateRoot: state, now: () => NOW, tell: line => { told.push(line); },
    folder: async id => FOLDERS[id] ?? null,
    figures: async q => { asked.push(q); return figures(q); },
  });
  return { state, handlers, told, asked };
}
const call = (r: Rig, name: (typeof RUN_CALLS)[number], event: RealEvent, ...args: unknown[]): Promise<unknown> => Promise.resolve((r.handlers.get(RUN_CHANNELS[name]) as Handler)(event, ...args));
const code = async (promise: Promise<unknown>): Promise<string> => { try { await promise; return 'RESOLVED'; } catch (error) { return error instanceof Error ? error.message : String(error); } };
const input = { folderId: 'folder-1', engine: 'claude-code', instruction: 'Write a weekly report.', startedAt: '2026-11-11T10:30:00Z' };

test('main registers one handler on the channel of each runs call and on no other channel', t => {
  const r = rig(t);
  assert.deepEqual([...r.handlers.keys()].sort(), Object.values(RUN_CHANNELS).sort());
});

test('a call from any sender but the main frame of the app page is refused NOT_ALLOWED, and nothing is saved or read', async t => {
  const r = rig(t);
  for (const [name, event] of Object.entries(BAD_SENDERS)) {
    for (const callName of RUN_CALLS) assert.equal(await code(call(r, callName, event, ...(callName === 'listRuns' ? [] : callName === 'recordRun' ? [input] : callName === 'updateRun' ? ['run-1', { notes: 'x' }] : ['run-1']))), 'NOT_ALLOWED', `${callName} from ${name}`);
  }
  assert.deepEqual(await call(r, 'listRuns', GOOD), []);
  assert.equal(r.asked.length, 0);
});

test('a call with the wrong number of arguments is BAD_ARGUMENT', async t => {
  const r = rig(t);
  assert.equal(await code(call(r, 'listRuns', GOOD, 'x')), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'recordRun', GOOD)), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'recordRun', GOOD, input, input)), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'updateRun', GOOD, 'run-1')), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'readRunFigures', GOOD)), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'readRunFigures', GOOD, 'run-1', 'x')), 'BAD_ARGUMENT');
});

test('recordRun refuses a shape that is not exactly an input, and an unknown folder, before it writes', async t => {
  const r = rig(t);
  for (const bad of [null, 'x', [], { ...input, folderId: '../..' }, { ...input, engine: 'vim' }, { ...input, instruction: '' }, { ...input, extra: 1 }, { ...input, startedAt: 'now' }, { ...input, startedAt: '2019-01-01T00:00:00Z' }]) {
    assert.equal(await code(call(r, 'recordRun', GOOD, bad)), 'BAD_ARGUMENT', JSON.stringify(bad));
  }
  assert.equal(await code(call(r, 'recordRun', GOOD, { ...input, folderId: 'folder-9' })), 'UNKNOWN_FOLDER');
  assert.deepEqual(await call(r, 'listRuns', GOOD), []);
});

test('recordRun saves a run and answers it with the folder name and the ~ label, and never the full path', async t => {
  const r = rig(t);
  const run = await call(r, 'recordRun', GOOD, input);
  assert.deepEqual(run, { id: 'run-1', engine: 'claude-code', instruction: 'Write a weekly report.', projectName: 'team', projectLabel: '~/Projects/team', startedAt: '2026-11-11T10:30:00.000Z', status: 'recorded', groupId: 'group-1', rating: null, notes: '' });
  assert.deepEqual(await call(r, 'listRuns', GOOD), [run]);
  assert.equal(JSON.stringify(await call(r, 'listRuns', GOOD)).includes('/Users/someone'), false);
  const now = await call(r, 'recordRun', GOOD, { ...input, startedAt: null }) as { startedAt: string };
  assert.equal(now.startedAt, '2026-11-11T12:00:00.000Z', 'no time means now');
});

test('updateRun saves a status, a rating and notes, refuses a rating before done, and says UNKNOWN_RUN for a run that is not there', async t => {
  const r = rig(t); await call(r, 'recordRun', GOOD, input);
  assert.equal(await code(call(r, 'updateRun', GOOD, 'run-1', { rating: 'better' })), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'updateRun', GOOD, 'run-1', {})), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'updateRun', GOOD, 'nope', { notes: 'x' })), 'BAD_ARGUMENT');
  assert.equal(await code(call(r, 'updateRun', GOOD, 'run-77', { notes: 'x' })), 'UNKNOWN_RUN');
  const done = await call(r, 'updateRun', GOOD, 'run-1', { status: 'done', rating: 'same', notes: 'fine' }) as { status: string; rating: string; notes: string };
  assert.deepEqual([done.status, done.rating, done.notes], ['done', 'same', 'fine']);
});

test('readRunFigures gives the reader the engine, the full folder path and the start time from main\'s own record, and the page gets only the figures', async t => {
  const figures: RunFigures = { state: 'found', startedAt: '2026-11-11T10:31:00.000Z', endedAt: '2026-11-11T10:35:00.000Z', durationMs: 240000, inputTokens: 10, outputTokens: 20, model: 'm-1', outcome: 'finished' };
  const r = rig(t, async () => figures); await call(r, 'recordRun', GOOD, input);
  assert.deepEqual(await call(r, 'readRunFigures', GOOD, 'run-1'), figures);
  assert.deepEqual(r.asked, [{ engine: 'claude-code', projectDir: '/Users/someone/Projects/team', startedAt: '2026-11-11T10:30:00.000Z' }]);
  assert.equal(await code(call(r, 'readRunFigures', GOOD, 'run-5')), 'UNKNOWN_RUN');
  assert.equal(await code(call(r, 'readRunFigures', GOOD, '../x')), 'BAD_ARGUMENT');
});

test('a reader that throws gives "unreadable" figures, never a refusal with its message, and the log line names the class only', async t => {
  const r = rig(t, async () => { throw Object.assign(new TypeError('cannot open /Users/someone/.claude/projects/secret-chat'), { code: 'EACCES' }); });
  await call(r, 'recordRun', GOOD, input);
  assert.deepEqual(await call(r, 'readRunFigures', GOOD, 'run-1'), NO_FIGURES('unreadable'));
  assert.equal(r.told.length, 1);
  assert.match(r.told[0]!, /readRunFigures/); assert.match(r.told[0]!, /TypeError/);
  assert.equal(/Users|secret|EACCES/.test(r.told[0]!), false);
});

test('a reader that answers something that is not figures is "unreadable", and a figure the page would show as text is cut to numbers and a short model name', async t => {
  const r = rig(t, async () => ({ state: 'found', startedAt: '2026-11-11T10:31:00.000Z', endedAt: 'x', durationMs: -5, inputTokens: '9', outputTokens: 1.5, model: 'has space and /Users/x', outcome: 'whatever', note: 'secret chat' }) as unknown as RunFigures);
  await call(r, 'recordRun', GOOD, input);
  assert.deepEqual(await call(r, 'readRunFigures', GOOD, 'run-1'), { state: 'found', startedAt: '2026-11-11T10:31:00.000Z', endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
});

test('a damaged runs file is FAILED to the page for a list, with the class in the log and no path, and a new record keeps working', async t => {
  const r = rig(t);
  await call(r, 'recordRun', GOOD, input);
  writeFileSync(runsFile(r.state), 'not json /Users/someone/secret');
  assert.equal(await code(call(r, 'listRuns', GOOD)), 'FAILED');
  assert.equal(r.told.length, 1);
  assert.match(r.told[0]!, /listRuns/); assert.match(r.told[0]!, /RunStoreError/);
  assert.equal(/Users|secret/.test(r.told[0]!), false);
  assert.equal(((await call(r, 'recordRun', GOOD, input)) as { id: string }).id, 'run-1');
  assert.equal((await call(r, 'listRuns', GOOD) as unknown[]).length, 1);
});
