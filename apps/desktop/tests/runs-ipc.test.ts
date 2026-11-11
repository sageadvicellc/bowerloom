// The five calls of the bowerloomRuns bridge, answered in main (main/runs-ipc.ts): the channels, the sender check, the argument count and shape, the folder lookup, the answers, and the rule
// that no full path and no chat text reaches the page. No real log and no real home: the store and the reader of figures are real over a made-up state folder, or faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_FIGURES, RUN_CALLS, RUN_CHANNELS } from '../shared/api/runs.js';
import type { RunFigures } from '../shared/api/runs.js';
import { createRunStore, runsDir, runsFile } from '../main/run-store.js';
import { cleanFigures, registerRunsIpc } from '../main/runs-ipc.js';
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
const FOLDERS: Record<string, FolderRef | { problem: 'UNKNOWN_FOLDER' | 'FOLDER_CHARACTER' | 'FOLDER_LINK' }> = {
  'folder-1': { dir: '/Users/someone/Projects/team', name: 'team', label: '~/Projects/team' },
  'folder-2': { problem: 'FOLDER_CHARACTER' }, 'folder-3': { problem: 'FOLDER_LINK' }, 'folder-4': { problem: 'UNKNOWN_FOLDER' },
};

interface Rig { readonly state: string; readonly handlers: Map<string, Handler>; readonly told: string[]; readonly asked: { engine: string; projectDir: string; startedAt: string; siblings?: readonly { startedAt: string }[] }[] }
function rig(t: TestContext, figures: (q: { engine: string; projectDir: string; startedAt: string; siblings?: readonly { startedAt: string }[] }) => Promise<RunFigures> = async () => NO_FIGURES('not-found')): Rig {
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
    for (const callName of RUN_CALLS) assert.equal(await code(call(r, callName, event, ...(callName === 'listRuns' || callName === 'startNewRunList' ? [] : callName === 'recordRun' ? [input] : callName === 'updateRun' ? ['run-1', { notes: 'x' }] : ['run-1']))), 'NOT_ALLOWED', `${callName} from ${name}`);
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
  assert.equal(await code(call(r, 'startNewRunList', GOOD, 'x')), 'BAD_ARGUMENT');
});

test('recordRun refuses a shape that is not exactly an input, and an unknown folder, before it writes', async t => {
  const r = rig(t);
  for (const bad of [null, 'x', [], { ...input, folderId: '../..' }, { ...input, engine: 'vim' }, { ...input, instruction: '' }, { ...input, extra: 1 }, { ...input, startedAt: 'now' }, { ...input, startedAt: '2019-01-01T00:00:00Z' }]) {
    assert.equal(await code(call(r, 'recordRun', GOOD, bad)), 'BAD_ARGUMENT', JSON.stringify(bad));
  }
  assert.equal(await code(call(r, 'recordRun', GOOD, { ...input, folderId: 'folder-9' })), 'UNKNOWN_FOLDER');
  assert.equal(await code(call(r, 'recordRun', GOOD, { ...input, folderId: 'folder-2' })), 'FOLDER_CHARACTER');
  assert.equal(await code(call(r, 'recordRun', GOOD, { ...input, folderId: 'folder-3' })), 'FOLDER_LINK');
  assert.equal(await code(call(r, 'recordRun', GOOD, { ...input, folderId: 'folder-4' })), 'UNKNOWN_FOLDER');
  assert.equal(await code(call(r, 'recordRun', GOOD, { ...input, instruction: 'a'.repeat(4001) })), 'TOO_LONG', 'a text over its limit says so');
  assert.equal(await code(call(r, 'updateRun', GOOD, 'run-1', { notes: 'a'.repeat(2001) })), 'TOO_LONG');
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
  assert.equal(await code(call(r, 'updateRun', GOOD, 'run-1', { notes: 'a'.repeat(2001) })), 'TOO_LONG');
  const done = await call(r, 'updateRun', GOOD, 'run-1', { status: 'done', rating: 'same', notes: 'fine' }) as { status: string; rating: string; notes: string };
  assert.deepEqual([done.status, done.rating, done.notes], ['done', 'same', 'fine']);
});

test('readRunFigures gives the reader the engine, the full folder path and the start time from main\'s own record, and the page gets only the figures', async t => {
  const figures: RunFigures = { state: 'found', reason: null, startedAt: '2026-11-11T10:31:00.000Z', endedAt: '2026-11-11T10:35:00.000Z', durationMs: 240000, inputTokens: 10, outputTokens: 20, model: 'm-1', outcome: 'finished' };
  const r = rig(t, async () => figures); await call(r, 'recordRun', GOOD, input);
  assert.deepEqual(await call(r, 'readRunFigures', GOOD, 'run-1'), figures);
  assert.deepEqual(r.asked, [{ engine: 'claude-code', projectDir: '/Users/someone/Projects/team', startedAt: '2026-11-11T10:30:00.000Z', siblings: [] }]);
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
  assert.deepEqual(await call(r, 'readRunFigures', GOOD, 'run-1'), { state: 'found', reason: null, startedAt: '2026-11-11T10:31:00.000Z', endedAt: null, durationMs: null, inputTokens: null, outputTokens: null, model: null, outcome: 'unknown' });
});

test('the other runs of the same engine and project are given to the reader as siblings, and no other run is', async t => {
  const r = rig(t);
  await call(r, 'recordRun', GOOD, input);
  await call(r, 'recordRun', GOOD, { ...input, startedAt: '2026-11-11T10:40:00Z' });
  await call(r, 'recordRun', GOOD, { ...input, engine: 'codex' });
  await call(r, 'readRunFigures', GOOD, 'run-1');
  assert.deepEqual(r.asked.at(-1)?.siblings, [{ startedAt: '2026-11-11T10:40:00.000Z' }]);
});

test('a damaged runs file is STORE_DAMAGED to the page for a list, a record and a change, nothing is written, the log names the class and the reason and no path, and only startNewRunList moves it aside', async t => {
  const r = rig(t);
  await call(r, 'recordRun', GOOD, input);
  writeFileSync(runsFile(r.state), 'not json /Users/someone/secret');
  for (const [name, args] of [['listRuns', []], ['recordRun', [input]], ['updateRun', ['run-1', { notes: 'x' }]], ['readRunFigures', ['run-1']]] as const) assert.equal(await code(call(r, name, GOOD, ...args)), 'STORE_DAMAGED', name);
  assert.equal(readFileSync(runsFile(r.state), 'utf8'), 'not json /Users/someone/secret', 'nothing was written or moved');
  assert.equal(r.told.length, 4);
  assert.match(r.told[0]!, /listRuns/); assert.match(r.told[0]!, /RunStoreError, damaged/);
  for (const line of r.told) assert.equal(/Users|secret/.test(line), false);
  const done = await call(r, 'startNewRunList', GOOD) as { asideName: string };
  assert.match(done.asideName, /^runs\.damaged-\d{8}T\d{9}Z(-\d+)?\.json$/);
  assert.equal(readFileSync(join(runsDir(r.state), done.asideName), 'utf8'), 'not json /Users/someone/secret');
  assert.equal(((await call(r, 'recordRun', GOOD, input)) as { id: string }).id, 'run-1');
  assert.equal(await code(call(r, 'startNewRunList', GOOD)), 'BAD_ARGUMENT', 'a file that is not damaged is not moved');
});

test('the limit of runs is RUN_LIMIT, and a failed write is FAILED with the reason and the errno code in the log and no path', async t => {
  const full = rig(t);
  for (let i = 0; i < 500; i += 1) createRunStore({ stateRoot: full.state }).add({ engine: 'codex', instruction: `i${i}`, projectPath: '/p', projectName: 'p', projectLabel: '~/p', startedAt: '2026-11-11T10:30:00.000Z' });
  assert.equal(await code(call(full, 'recordRun', GOOD, input)), 'RUN_LIMIT');
  const state = tempDir(t), told: string[] = [];
  const handlers = new Map<string, Handler>();
  registerRunsIpc({ ipc: { handle: (c, l) => { handlers.set(c, l as Handler); } }, appIndexUrl: APP_INDEX, home: '/Users/someone', stateRoot: state, now: () => NOW, tell: l => { told.push(l); }, folder: async id => FOLDERS[id] ?? null,
    store: createRunStore({ stateRoot: state, rename: () => { throw Object.assign(new Error('disk full /Users/someone/x'), { code: 'ENOSPC' }); } }) });
  assert.equal(await code(Promise.resolve((handlers.get(RUN_CHANNELS.recordRun) as Handler)(GOOD, input))), 'FAILED');
  assert.match(told[0]!, /recordRun/); assert.match(told[0]!, /write-failed, ENOSPC/); assert.equal(/Users|disk full/.test(told[0]!), false);
});

test('cleanFigures cuts odd numbers and names to null: NaN, Infinity, 1e13, a negative zero, a prototype key and a name that is not a plain token', () => {
  const base = { state: 'found', reason: null, startedAt: '2026-11-11T10:31:00.000Z', endedAt: '2026-11-11T10:35:00.000Z', durationMs: 5, inputTokens: 1, outputTokens: 2, model: 'm-1', outcome: 'finished' };
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e13, -0, -1, 1.5, '7', null, [], {}]) {
    const f = cleanFigures({ ...base, inputTokens: bad, outputTokens: bad, durationMs: bad });
    assert.deepEqual([f.inputTokens, f.outputTokens, f.durationMs], [null, null, null], String(Object.is(bad, -0) ? '-0' : bad));
  }
  const zero = cleanFigures({ ...base, inputTokens: 0 });
  assert.equal(zero.inputTokens, 0, 'a real zero stays');
  const proto = cleanFigures(JSON.parse('{"state":"found","__proto__":{"polluted":1},"model":"__proto__","inputTokens":1}'));
  assert.equal(proto.model, null);
  assert.equal((proto as unknown as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, 'the prototype of objects is untouched');
  assert.deepEqual(Object.keys(proto).sort(), ['durationMs', 'endedAt', 'inputTokens', 'model', 'outcome', 'outputTokens', 'reason', 'startedAt', 'state']);
  for (const model of ['__proto__', '', ' x', 'x y', 'a'.repeat(81), -0, Number.NaN]) assert.equal(cleanFigures({ ...base, model }).model, null, String(model));
});
