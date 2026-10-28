// The pure rules of the adopt and install sheets: what still waits before a write, which approvals are sent, how text is made safe to show, and how loss
// lines are grouped by engine and part. Also the call handler of the main process: its channels, its sender check and its argument counts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptCanWrite, adoptWaits, approvalsToSend, projectCanWrite, shortRevision, tickOf, untickedLines } from '../shared/engine/gates.js';
import { hasHidden, labelOf, makeScrub, visible } from '../shared/engine/scrub.js';
import { lineKey, lossByEngine } from '../shared/engine/view.js';
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import type { AdoptView, LossView, ProjectView } from '../shared/engine/types.js';
import { registerEngineIpc } from '../main/engine-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { REAL_CHANNELS } from '../shared/real/types.js';
import { CHANNELS } from '../shared/channels.js';
import { sampleEngineFixtures } from '../shared/engine/sample.js';

const adopt = (): AdoptView => structuredClone(sampleEngineFixtures().adopt);

test('the adopt sheet waits for each conflict, each acknowledgement, each block, each problem and each approval, and names each one', () => {
  const v = adopt();
  const waits = adoptWaits(v, []);
  assert.deepEqual(waits.map(w => w.kind), ['conflict', 'acknowledge', 'acknowledge', 'approval', 'approval', 'approval']);
  assert.equal(adoptCanWrite(v, []), false);
  const picked: AdoptView = { ...v, conflicts: v.conflicts.map(c => ({ ...c, picked: c.variants[0]!.key })), unmapped: v.unmapped.map(u => ({ ...u, acknowledged: true })), ready: true };
  assert.deepEqual(adoptWaits(picked, []).map(w => w.kind), ['approval', 'approval', 'approval']);
  const all = picked.approvals.map(tickOf);
  assert.equal(adoptCanWrite(picked, all.slice(1)), false, 'one approval short');
  assert.equal(adoptCanWrite(picked, all), true);
  assert.equal(adoptCanWrite({ ...picked, ready: false }, all), false, 'the plan itself must say ready');
  const blocked: AdoptView = { ...picked, unmapped: [...picked.unmapped, { id: 'AGENTS.md#line-3', path: 'AGENTS.md', pointer: null, part: 'system-prompt', reason: 'Inline it first.', gate: 'block', acknowledged: false, hash: 'b'.repeat(64) }] };
  assert.deepEqual(adoptWaits(blocked, all), [{ kind: 'block', id: 'AGENTS.md#line-3' }]);
  const problem: AdoptView = { ...picked, problems: [{ code: 'X', path: 'harness.json', message: 'm' }] };
  assert.deepEqual(adoptWaits(problem, all), [{ kind: 'problem', code: 'X' }]);
});

test('only the plan\'s own approvals that the person ticked are sent, each with its hash, in the plan\'s order; a key the plan does not ask for never is', () => {
  const v = adopt(), ticks = v.approvals.map(tickOf);
  assert.deepEqual(approvalsToSend(v, ['made-up', ticks[2]!, ticks[0]!]), [v.approvals[0], v.approvals[2]].map(a => ({ key: a!.key, hash: a!.hash })));
  assert.deepEqual(approvalsToSend(v, []), []);
});

test('U3: a tick names the approval and the hash of what the person read; when the content changes, the tick no longer counts', () => {
  const v = adopt(), ticks = v.approvals.map(tickOf);
  const ready: AdoptView = { ...v, conflicts: v.conflicts.map(c => ({ ...c, picked: c.variants[0]!.key })), unmapped: v.unmapped.map(u => ({ ...u, acknowledged: true })), ready: true };
  assert.equal(adoptCanWrite(ready, ticks), true);
  const changed: AdoptView = { ...ready, approvals: ready.approvals.map((a, i) => (i === 1 ? { ...a, reasons: [...a.reasons, 'It now also reads your mail.'], hash: 'c'.repeat(64) } : a)) };
  assert.equal(adoptCanWrite(changed, ticks), false);
  assert.deepEqual(adoptWaits(changed, ticks), [{ kind: 'approval', key: changed.approvals[1]!.key }]);
  assert.deepEqual(approvalsToSend(changed, ticks).map(a => a.key), [changed.approvals[0]!.key, changed.approvals[2]!.key]);
});

test('the install sheet writes only a plan that changes something, after the person approved that very revision', () => {
  const plan = { noop: false, revision: 'a'.repeat(64) } as ProjectView;
  assert.equal(projectCanWrite(plan, null), false);
  assert.equal(projectCanWrite(plan, 'b'.repeat(64)), false, 'a changed plan needs a new approval');
  assert.equal(projectCanWrite(plan, 'a'.repeat(64)), true);
  assert.equal(projectCanWrite({ ...plan, noop: true }, 'a'.repeat(64)), false);
  assert.equal(projectCanWrite(null, 'a'), false);
  assert.equal(shortRevision('0123456789abcdef'), '01234567');
  const ask = { kind: 'approve' as const, lines: [{ key: 'k1' }, { key: 'k2' }] as never, approvedSoFar: [] };
  assert.deepEqual(untickedLines(ask, ['k2']), ['k1']);
  assert.deepEqual(untickedLines({ kind: 'plan', plan }, []), []);
});

test('text is shown in full, with every hiding character written out and the person\'s paths replaced', () => {
  assert.equal(visible('rm‮-rf'), 'rm[U+202E]-rf');
  assert.equal(visible('a\tb\nc'), 'a\tb\nc', 'tab and line feed stay');
  assert.equal(visible('x​y\u0007'), 'x[U+200B]y[U+0007]');
  assert.equal(hasHidden('plain'), false); assert.equal(hasHidden('a﻿'), true); assert.equal(hasHidden('a﻿'), true, 'the test does not keep state');
  const s = makeScrub([{ path: '/Users/ann', as: '~' }, { path: '/Users/ann/Projects/demo', as: '~/Projects/demo' }]);
  assert.equal(s('exists: /Users/ann/Projects/demo/CLAUDE.md, /Users/ann/CLAUDE.md.'), 'exists: ~/Projects/demo/CLAUDE.md, ~/CLAUDE.md.');
  assert.equal(s('/Users/annie/x'), '/Users/annie/x', 'a longer name is not a match');
  assert.equal(labelOf('/Users/ann/p', '/Users/ann'), '~/p'); assert.equal(labelOf('/opt/p', '/Users/ann'), '/opt/p');
});

test('loss lines are grouped by engine and part in plan order, with a count of each result word', () => {
  const l = (engine: 'codex' | 'claude-code', part: string, result: LossView['result']): LossView => ({ part, entry: 'e', field: null, engine, result, reason: 'r' });
  const out = lossByEngine([l('claude-code', 'skills', 'exact'), l('codex', 'hooks', 'weakened'), l('codex', 'skills', 'exact'), l('codex', 'hooks', 'absent')], [{ id: 'claude-code', version: null }, { id: 'codex', version: '0.157.0' }, { id: 'hermes', version: null }]);
  assert.deepEqual(out.map(e => e.engine), ['claude-code', 'codex'], 'an engine Bowerloom does not know is left out');
  assert.deepEqual(out[1]!.parts.map(p => `${p.part}:${p.lines.length}`), ['hooks:2', 'skills:1']);
  assert.deepEqual(out[1]!.counts, { exact: 1, translated: 0, weakened: 1, absent: 1 });
  assert.equal(out[1]!.version, '0.157.0');
  assert.notEqual(lineKey({ part: 'a', entry: 'b', engine: 'codex', result: 'weakened' }), lineKey({ part: 'a', entry: 'b', field: 'tools', engine: 'codex', result: 'weakened' }));
});

test('the handler has one channel per call, apart from every other channel, and refuses another page, a frame, and a wrong argument count before anything runs', async () => {
  const handlers = new Map<string, (event: RealEvent, ...args: unknown[]) => unknown>();
  registerEngineIpc({ ipc: { handle: (c, l) => { handlers.set(c, l); } }, appIndexUrl: APP_INDEX, home: '/nonexistent-home', stateRoot: '/nonexistent-home/.local/state/bowerloom', chooseFolder: async () => null, confirm: async () => false, who: 't' });
  assert.deepEqual([...handlers.keys()].sort(), Object.values(ENGINE_CHANNELS).sort());
  assert.equal(ENGINE_CALLS.length, 12);
  for (const channel of Object.values(ENGINE_CHANNELS)) {
    assert.ok(!(Object.values(REAL_CHANNELS) as string[]).includes(channel) && !(Object.values(CHANNELS) as string[]).includes(channel), channel);
  }
  const page: RealEvent = { senderFrame: { url: APP_INDEX, parent: null } };
  const reason = async (channel: string, event: RealEvent, ...args: unknown[]): Promise<string> => { try { await handlers.get(channel)!(event, ...args); return 'ok'; } catch (e) { return (e as Error).message; } };
  assert.equal(await reason(ENGINE_CHANNELS.folders, { senderFrame: { url: 'https://example.com/', parent: null } }), 'NOT_ALLOWED');
  assert.equal(await reason(ENGINE_CHANNELS.folders, { senderFrame: { url: APP_INDEX, parent: {} } }), 'NOT_ALLOWED');
  assert.equal(await reason(ENGINE_CHANNELS.folders, { senderFrame: null }), 'NOT_ALLOWED');
  for (const call of ENGINE_CALLS) assert.equal(await reason(ENGINE_CHANNELS[call], page, ...Array(ENGINE_ARITY[call] + 1).fill('x')), 'BAD_ARGUMENT', call);
  assert.equal(await reason(ENGINE_CHANNELS.planRemoval, page, 'folder-1'), 'UNKNOWN_FOLDER');
  assert.equal(await reason(ENGINE_CHANNELS.planRemoval, page, '../x'), 'BAD_ARGUMENT');
  assert.equal(await reason(ENGINE_CHANNELS.folders, page), 'ok');
});
