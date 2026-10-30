// The usage events of the app: what the engine service records on a write (the scenario, the engines, the plan, a pseudonymous folder id, the refusal code),
// that a recorder which throws changes no result, the new recordCheck call (arity, channel, validation in main), and the recorder's own log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readEvents, eventLogPath } from '../../../packages/diagnostics/src/index.js';
import { createEngineService, checkCheckArgs } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { registerEngineIpc } from '../main/engine-ipc.js';
import { createRecorder } from '../main/engine-events.js';
import { APP_INDEX } from '../main/security.js';
import { ENGINE_ARITY, ENGINE_CALLS, ENGINE_CHANNELS, CHECK_ANSWERS } from '../shared/engine/types.js';
import type { Answer, FolderInfo, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { createSampleEngine } from '../shared/engine/sample.js';
import { tempDir } from './support.js';
import { definedFolder, engineFolder, homeFolder } from './helpers-engine/folders.js';

const WHEN = new Date('2026-10-28T12:00:00Z');
type Seen = Record<string, unknown>;
const INPUT: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code}`); return a.value; };

function setup(t: test.TestContext, record: ((input: Seen) => void) | undefined): { home: string; service: EngineService; pick(dir: string | null): void } {
  const home = homeFolder(tempDir(t, 'bowerloom-events-'));
  let next: string | null = null;
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, confirm: async () => true, who: 'tester', now: () => WHEN, ...(record === undefined ? {} : { record }) });
  return { home, service, pick: dir => { next = dir; } };
}
async function choose(service: EngineService, pick: (d: string | null) => void, dir: string): Promise<FolderInfo> { pick(dir); return value(await service.chooseFolder()); }
/** Plans an install, ticks every line it asks for, plans again, and writes the plan shown last. */
async function install(service: EngineService, folder: FolderInfo, input: ProjectInput = INPUT): Promise<Answer<unknown>> {
  const ask = value(await service.planProjection(folder.id, input));
  const approve = ask.kind === 'approve' ? ask.lines.map(l => l.key) : [];
  const planned = value(await service.planProjection(folder.id, { ...input, approve })) as Extract<ProjectAnswer, { kind: 'plan' }>;
  return service.runProjection(folder.id, planned.plan.revision, { ...input, approve });
}

test('an install into both engines records S2 with the engines, the plan, and the folder for the log to key; nothing else', async t => {
  const seen: Seen[] = [];
  const { home, service, pick } = setup(t, e => seen.push(e));
  const dir = definedFolder(home);
  const folder = await choose(service, pick, dir);
  assert.equal((await install(service, folder)).ok, true);
  assert.equal(seen.length, 1);
  const e = seen[0]!;
  assert.deepEqual([e.source, e.kind, e.scenario, e.step, e.outcome, e.engines], ['app', 'scenario', 'S2', 'install', 'done', ['claude-code', 'codex']]);
  assert.match(String(e.plan), /^[0-9a-f]{64}$/);
  assert.equal(e.targetRoot, dir);
});

test('an install into one engine records no scenario, only step install and its engine', async t => {
  const seen: Seen[] = [];
  const { home, service, pick } = setup(t, e => seen.push(e));
  const folder = await choose(service, pick, definedFolder(home));
  assert.equal((await install(service, folder, { ...INPUT, engines: ['claude-code'] })).ok, true);
  assert.equal(seen[0]!.scenario, undefined);
  assert.deepEqual([seen[0]!.step, seen[0]!.outcome, seen[0]!.engines], ['install', 'done', ['claude-code']]);
});

test('a removal records S5 remove; a write the package refuses records the refusal code and still returns the refusal', async t => {
  const seen: Seen[] = [];
  const { home, service, pick } = setup(t, e => seen.push(e));
  const dir = definedFolder(home);
  const folder = await choose(service, pick, dir);
  await install(service, folder);
  seen.length = 0;
  const removal = value(await service.planRemoval(folder.id));
  assert.equal((await service.runRemoval(folder.id, removal.revision)).ok, true);
  assert.deepEqual([seen[0]!.scenario, seen[0]!.step, seen[0]!.outcome], ['S5', 'remove', 'done']);
  // An install is planned, then the definition changes under the plan: the package refuses the write.
  const ask = value(await service.planProjection(folder.id, INPUT));
  const approve = ask.kind === 'approve' ? ask.lines.map(l => l.key) : [];
  const planned = value(await service.planProjection(folder.id, { ...INPUT, approve })) as Extract<ProjectAnswer, { kind: 'plan' }>;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'CLAUDE.md'), '# Changed after the plan was shown\n');
  seen.length = 0;
  const refused = await service.runProjection(folder.id, planned.plan.revision, { ...INPUT, approve });
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok);
  assert.deepEqual([seen[0]!.step, seen[0]!.outcome, seen[0]!.code], ['install', 'refused', refused.refusal.code]);
  assert.match(String(seen[0]!.code), /^[A-Z][A-Z0-9_]{2,63}$/);
});

test('an adoption records S1 adopt', async t => {
  const seen: Seen[] = [];
  const { home, service, pick } = setup(t, e => seen.push(e));
  const folder = await choose(service, pick, engineFolder(home));
  const first = value(await service.planAdoption(folder.id, { picks: {}, acknowledged: [] }));
  const picks = Object.fromEntries(first.conflicts.map(c => [c.key, c.variants[0]!.key]));
  const probe = value(await service.planAdoption(folder.id, { picks, acknowledged: [] }));
  const acknowledged = probe.unmapped.filter(u => u.gate === 'acknowledge').map(u => ({ id: u.id, hash: u.hash }));
  const final = value(await service.planAdoption(folder.id, { picks, acknowledged }));
  const done = await service.runAdoption(folder.id, final.revision, { picks, acknowledged }, final.approvals.map(a => ({ key: a.key, hash: a.hash })));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.deepEqual([seen[0]!.scenario, seen[0]!.step, seen[0]!.outcome], ['S1', 'adopt', 'done']);
});

test('a recorder that throws changes no result of any call', async t => {
  const quiet = setup(t, undefined), loud = setup(t, () => { throw new Error('disk full'); });
  const a = await choose(quiet.service, quiet.pick, definedFolder(quiet.home)), b = await choose(loud.service, loud.pick, definedFolder(loud.home));
  const first = await install(quiet.service, a), second = await install(loud.service, b);
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.deepEqual(Object.keys((second as { value: object }).value), Object.keys((first as { value: object }).value));
  assert.equal(await loud.service.recordCheck('yes', null), false, 'the check says it was not recorded, and does not throw');
  const removal = value(await loud.service.planRemoval(b.id));
  assert.equal((await loud.service.runRemoval(b.id, removal.revision)).ok, true);
});

test('recordCheck: main validates the answer and the note again, and passes only a clean pair to the recorder', async t => {
  const seen: Seen[] = [];
  const { service } = setup(t, e => seen.push(e));
  assert.equal(await service.recordCheck('yes', null), true);
  assert.equal(await service.recordCheck('partly', 'I wanted two files.'), true);
  assert.equal(await service.recordCheck('no', '   '), true);
  assert.deepEqual(seen.map(e => [e.kind, e.answer, e.note]), [['check', 'yes', undefined], ['check', 'partly', 'I wanted two files.'], ['check', 'no', undefined]]);
  const bads: readonly (readonly [unknown, unknown])[] = [[undefined, null], ['maybe', null], ['YES', null], [1, null], ['yes', 5], ['yes', 'x'.repeat(501)], ['yes', {}]];
  for (const [answer, note] of bads) await assert.rejects(service.recordCheck(answer, note), /BAD_ARGUMENT/, JSON.stringify([answer, note]));
  assert.equal(seen.length, 3, 'a refused call records nothing');
  assert.equal(checkCheckArgs('no', 'x'.repeat(500)).note?.length, 500);
});

test('recordCheck is one more call on its own channel with two arguments, and the channel refuses another page and a wrong count', async () => {
  assert.ok((ENGINE_CALLS as readonly string[]).includes('recordCheck'));
  assert.equal(ENGINE_ARITY.recordCheck, 2);
  assert.equal(ENGINE_CHANNELS.recordCheck, 'bowerloom-engine:recordCheck');
  const seen: Seen[] = [];
  const handlers = new Map<string, (event: { senderFrame: unknown }, ...args: unknown[]) => unknown>();
  registerEngineIpc({ ipc: { handle: (c, l) => { handlers.set(c, l as never); } }, appIndexUrl: APP_INDEX, home: '/nonexistent-home', stateRoot: '/nonexistent-home/.local/state/bowerloom', chooseFolder: async () => null, confirm: async () => false, who: 't', record: e => seen.push(e) });
  const call = handlers.get(ENGINE_CHANNELS.recordCheck)!;
  const page = { senderFrame: { url: APP_INDEX, parent: null } };
  const reason = async (event: { senderFrame: unknown }, ...args: unknown[]): Promise<string> => { try { await call(event, ...args); return 'ok'; } catch (e) { return (e as Error).message; } };
  assert.equal(await reason({ senderFrame: { url: 'https://example.com/', parent: null } }, 'yes', null), 'NOT_ALLOWED');
  assert.equal(await reason(page, 'yes'), 'BAD_ARGUMENT');
  assert.equal(await reason(page, 'yes', null, 'x'), 'BAD_ARGUMENT');
  assert.equal(await reason(page, 'sure', null), 'BAD_ARGUMENT');
  assert.equal(seen.length, 0);
  assert.equal(await reason(page, 'partly', 'text'), 'ok');
  assert.equal(seen.length, 1);
});

test('the answers the window may send are the answers the log accepts, and the sample records nothing', async () => {
  assert.deepEqual([...CHECK_ANSWERS], ['yes', 'partly', 'no']);
  assert.equal(await createSampleEngine().recordCheck('yes', null), false);
});

test('the recorder writes a private log under the state root, keeps the folder only as a keyed id, and never throws', t => {
  const root = join(tempDir(t, 'bowerloom-recorder-'), 'state');
  const told: string[] = [];
  const record = createRecorder({ stateRoot: root, env: {}, now: () => WHEN, onFailure: m => told.push(m) });
  record({ source: 'app', kind: 'scenario', scenario: 'S2', step: 'install', outcome: 'done', engines: ['claude-code', 'codex'], plan: 'a'.repeat(64), targetRoot: '/home/test-person/Projects/demo' });
  record({ source: 'app', kind: 'check', answer: 'no', note: 'I wanted one file.' });
  assert.equal(told.length, 0);
  const { events, malformed } = readEvents(root);
  assert.equal(malformed, 0); assert.equal(events.length, 2);
  assert.equal(events[0]!.scenario, 'S2'); assert.equal(events[1]!.answer, 'no');
  const raw = readFileSync(eventLogPath(root), 'utf8');
  assert.equal(raw.includes('test-person'), false); assert.equal(raw.includes('Projects/demo'), false);
  assert.equal(statSync(eventLogPath(root)).mode & 0o777, 0o600);
  // The off switch writes nothing; a log that cannot be written is told, not thrown.
  const off = createRecorder({ stateRoot: root, env: { BOWERLOOM_EVENT_LOG: 'off' }, now: () => WHEN, onFailure: m => told.push(m) });
  off({ source: 'app', kind: 'check', answer: 'yes' });
  assert.equal(readEvents(root).events.length, 2);
  const broken = createRecorder({ stateRoot: eventLogPath(root), env: {}, now: () => WHEN, onFailure: m => told.push(m) });
  assert.doesNotThrow(() => broken({ source: 'app', kind: 'check', answer: 'yes' }));
  assert.equal(told.length, 1); assert.match(told[0]!, /^Bowerloom could not write its local event log: /);
});
