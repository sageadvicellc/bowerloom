// Fixes of the 0.8.0-beta.1 release review in main: a worker bug during a write says a write may have stopped; a worker that ends while idle is logged; the share calls that open a
// native dialog hold the serial queue only outside the dialog and bind the plan again after it; the reader names an unknown fault and treats a linked .bowerloom as unreadable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CodedRefusal, WORKER_WORDS, createBundleHost } from '../main/engine-bundle-host.js';
import type { WorkerLike } from '../main/engine-bundle-host.js';
import type { Job } from '../main/engine-bundle-work.js';
import { createScanner, harnessOf } from '../main/real-scan.js';
import { makeBudget, newTally } from '../main/real-fs.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { HARNESS_UNREADABLE, overviewOf } from '../shared/harness/overview.js';
import type { RealPlace } from '../shared/real/types.js';
import { NO_CHOICES, codeOf, plainFolder, put, quietFolder, refused, shareSetup, value } from './helpers-engine/share.js';
import type { Share } from './helpers-engine/share.js';
import { filesOf } from './helpers-engine/folders.js';
import { tempDir } from './support.js';

class Fake extends EventEmitter implements WorkerLike {
  postMessage(): void { /* a fake holds nothing */ }
  terminate(): Promise<unknown> { return Promise.resolve(1); }
  unref(): void { /* a fake holds nothing */ }
}
const READ: Job = { op: 'drop', key: 'bundle-1' };
const WRITE = { op: 'write', key: 'bundle-1', choices: { link: new Map(), leave: new Set() }, revision: 'a'.repeat(64), acknowledged: null, dirs: {} as never, now: '2026-10-31T12:00:00Z', projectDir: '/x', adoptState: '/y' } satisfies Job;
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
function logged(t: test.TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
  return lines;
}
async function failure(run: Promise<unknown>): Promise<CodedRefusal> {
  try { await run; } catch (error) { assert.ok(error instanceof CodedRefusal, String(error)); return error; }
  throw new Error('the call did not fail');
}

// ---- the host

test('a worker bug during a write uses the words of a stopped write, never "Nothing more was changed"; a read keeps its general words', async t => {
  logged(t);
  const made: Fake[] = [];
  const host = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => { const w = new Fake(); made.push(w); return w; } });
  const write = failure(host.call(WRITE));
  await tick();
  made[0]!.emit('message', { id: 1, ok: false, refusal: { kind: 'bug' } });
  const w = await write;
  assert.equal(w.message, WORKER_WORDS.WORKER_CRASHED.write);
  assert.doesNotMatch(w.message, /Nothing more was changed/);
  assert.match(w.message, /Finish a stopped harness/);
  assert.equal(w.step, 'WORKER_CRASHED');
  const read = failure(host.call(READ));
  await tick();
  made[0]!.emit('message', { id: 2, ok: false, refusal: { kind: 'bug' } });
  const r = await read;
  assert.match(r.message, /Nothing more was changed/);
  assert.equal(r.step, undefined);
});

test('a worker that ends while it holds no job is logged with its exit code; one that is closed on purpose is not', async t => {
  const lines = logged(t);
  const made: Fake[] = [];
  const host = createBundleHost({ file: () => 'x', timeoutMs: 5000, writeTimeoutMs: 5000, spawn: () => { const w = new Fake(); made.push(w); return w; } });
  const first = host.call<number>(READ);
  await tick();
  made[0]!.emit('message', { id: 1, ok: true, value: 1 });
  await first;
  made[0]!.emit('exit', 7);
  assert.equal(lines.filter(l => /ended while idle \(exit code 7\)/.test(l)).length, 1, lines.join('\n'));
  lines.length = 0;
  const second = host.call<number>(READ);
  await tick();
  made[1]!.emit('message', { id: 2, ok: true, value: 1 });
  await second;
  await host.close();
  assert.equal(lines.filter(l => /ended while idle/.test(l)).length, 0, 'a close is not an unexpected end');
});

// ---- the queue is free during a native dialog, and the plan is bound again after it

async function pair(t: test.TestContext, name: string): Promise<{ a: Share; b: Share; file: string }> {
  const a = shareSetup(t, `${name}-a`);
  const dir = quietFolder(a.home);
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  a.save = join(a.base, 'one.bowerloom.json');
  value(await a.service.runExport(f.id, plan.revision, plan.acknowledge));
  const b = shareSetup(t, `${name}-b`);
  return { a, b, file: a.save };
}

test('the open dialog of an import does not hold the queue: other calls and idle() answer while it is open', async t => {
  const { file } = await pair(t, 'open-free');
  let answer: (path: string | null) => void = () => undefined;
  const b = shareSetup(t, 'open-free-b', { chooseBundleOpen: () => new Promise<string | null>(resolve => { answer = resolve; }) });
  const choosing = b.service.chooseBundle();
  await tick();
  assert.deepEqual(await b.service.folders(), [], 'folders() answers with the dialog open');
  await b.service.idle();
  answer(file);
  const bundle = value(await choosing);
  assert.match(bundle.bundleId, /^bundle-\d+$/);
});

test('the save dialog of an export does not hold the queue, and a plan made while it is open is the plan the write must name', async t => {
  let release: (path: string | null) => void = () => undefined;
  let held = false;
  // The first save dialog stays open until the test releases it; later ones answer with the path the test sets.
  const a: Share = shareSetup(t, 'save-free', { chooseBundleSave: () => (held ? Promise.resolve(a.save) : (held = true, new Promise<string | null>(resolve => { release = resolve; }))) });
  const dir = quietFolder(a.home);
  const f = await a.choose(dir);
  const plan = value(await a.service.planExport(f.id));
  const writing = a.service.runExport(f.id, plan.revision, plan.acknowledge);
  await tick();
  assert.equal((await a.service.folders()).length, 1, 'folders() answers with the dialog open');
  await a.service.idle();
  // The harness changes and is planned again while the dialog is open.
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Quiet\n\nBe very brief.\n');
  const again = value(await a.service.planExport(f.id));
  assert.notEqual(again.revision, plan.revision);
  release(join(a.base, 'late.bowerloom.json'));
  assert.equal(refused(await writing).code, 'NOT_THE_PLAN_SHOWN', 'the plan changed during the dialog, so the first one is not written');
  assert.equal(a.asks.length, 0, 'no question for a plan that is not the one shown');
  // The new plan is still good.
  a.save = join(a.base, 'late.bowerloom.json');
  value(await a.service.runExport(f.id, again.revision, again.acknowledge));
});

test('the write question of an import does not hold the queue; a plan lost while it is open is NOT_THE_PLAN_SHOWN after the yes, and nothing is written', async t => {
  const { file } = await pair(t, 'ask-free');
  let yes: (v: boolean) => void = () => undefined;
  let asked = false;
  const b = shareSetup(t, 'ask-free-b', { confirm: () => new Promise<boolean>(resolve => { asked = true; yes = resolve; }) });
  b.open = file;
  const dir = plainFolder(b.home, 'target');
  const f = await b.choose(dir);
  const bundle = value(await b.service.chooseBundle());
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  const before = filesOf(b.base);
  const writing = b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge);
  while (!asked) await tick();
  assert.equal((await b.service.folders()).length, 1, 'folders() answers with the question open');
  await b.service.idle();
  // While the question is open, a part appears in the folder, so a new plan is refused and the plan shown is gone.
  put(dir, '.bowerloom/harness.json', JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'target', description: 'Mine.', engines: [{ id: 'claude-code' }], parts: { 'system-prompt': 'instructions/AGENTS.md' } }));
  put(dir, '.bowerloom/instructions/AGENTS.md', '# Mine\n');
  const replanned = await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES);
  assert.equal(replanned.ok, false);
  const mid = filesOf(b.base);
  yes(true);
  assert.equal(refused(await writing).code, 'NOT_THE_PLAN_SHOWN');
  assert.deepEqual(filesOf(b.base), mid, 'the yes wrote nothing');
  assert.notDeepEqual(before, mid);
});

test('a cancelled question after the dialog is CANCELLED and leaves the queue free; the plan is kept', async t => {
  const { file } = await pair(t, 'cancel');
  const b = shareSetup(t, 'cancel-b');
  b.open = file;
  const f = await b.choose(plainFolder(b.home, 'target'));
  const bundle = value(await b.service.chooseBundle());
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  b.yes = false;
  assert.equal(refused(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge)).code, 'CANCELLED');
  b.yes = true;
  value(await b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge));
  assert.equal(await codeOf(() => b.service.discardBundle('bundle-x')), 'BAD_ARGUMENT');
});

// ---- the reader

const harnessJson = JSON.stringify({ format: 'bowerloom/harness/v1beta1', id: 'x', description: 'X.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/' } });
async function readHome(home: string, picked: string): Promise<ReturnType<typeof realToHarnessState>> {
  const scanner = createScanner({ home });
  const places: RealPlace[] = [...(await scanner.discover()).places];
  places.push(...(await scanner.addFolder(picked)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 4), foldExtraApps: true }), places);
}

test('harnessOf: a known fault (bad JSON, wrong shape) is unreadable and silent; an unknown fault is still unreadable but is logged by class name and code, never a path', t => {
  const lines = logged(t);
  const base = tempDir(t, 'bowerloom-harness-of-');
  mkdirSync(join(base, '.bowerloom'), { recursive: true });
  const dir = join(base, '.bowerloom');
  writeFileSync(join(dir, 'harness.json'), '{ not json');
  const budget = makeBudget(() => 0, 1000, 1e9, 1000);
  assert.deepEqual(harnessOf(dir, [], newTally(), budget), { readable: false, engines: [], parts: [], links: [] });
  writeFileSync(join(dir, 'harness.json'), '[1]');
  assert.equal(harnessOf(dir, [], newTally(), budget)?.readable, false);
  assert.deepEqual(lines, [], 'known faults are not logged');
  writeFileSync(join(dir, 'harness.json'), harnessJson);
  assert.equal(harnessOf(dir, null as never, newTally(), budget)?.readable, false, 'a TypeError from a bug is shown as unreadable');
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /TypeError/);
  assert.ok(!String(lines.join(' ')).includes(base), 'no path in the log');
});

test('a .bowerloom that is a link is unreadable, not "no harness here"', async t => {
  const home = join(tempDir(t, 'bowerloom-linked-'), 'home'), work = join(home, 'work');
  for (const [rel, text] of Object.entries({ 'real/harness.json': harnessJson, 'proj/README.md': '# P\n' })) { const abs = join(work, rel); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, text); }
  symlinkSync(join(work, 'real'), join(work, 'proj', '.bowerloom'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const state = await readHome(home, work);
  const g = overviewOf(state, []).groups.find(x => x.label === '~/work/proj' && x.name === 'proj (Bowerloom)');
  assert.ok(g, 'the folder is a place with an unreadable harness, not missing');
  assert.equal(g!.note, HARNESS_UNREADABLE);
  assert.deepEqual(g!.nodes, []);
});

// ---- busy covers a share call that waits on a native dialog

test('busy() is true while the open dialog of an import is up, and while a write question is up, and false again after', async t => {
  const { file } = await pair(t, 'busy');
  let answer: (path: string | null) => void = () => undefined;
  let yes: (v: boolean) => void = () => undefined;
  let asked = false;
  const b = shareSetup(t, 'busy-b', { chooseBundleOpen: () => new Promise<string | null>(resolve => { answer = resolve; }), confirm: () => new Promise<boolean>(resolve => { asked = true; yes = resolve; }) });
  assert.equal(b.service.busy(), false);
  const choosing = b.service.chooseBundle();
  await tick();
  assert.equal(b.service.busy(), true, 'the open dialog is work in progress for a quit');
  answer(file);
  const bundle = value(await choosing);
  assert.equal(b.service.busy(), false);
  const f = await b.choose(plainFolder(b.home, 'target'));
  const plan = value(await b.service.planImport(f.id, bundle.bundleId, NO_CHOICES));
  const writing = b.service.runImport(f.id, plan.revision, bundle.bundleId, NO_CHOICES, plan.acknowledge);
  while (!asked) await tick();
  assert.equal(b.service.busy(), true, 'the write question, and the write that follows it');
  yes(true);
  value(await writing);
  assert.equal(b.service.busy(), false);
});
