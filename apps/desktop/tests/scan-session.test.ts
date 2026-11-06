// The saved read as the app uses it (main/scan-session.ts): a read is kept after it ends; a launch shows the kept read and reads no folder; a later, cheap check says whether the
// watched folders changed; and a kept read never lets a folder be read without the look and the question that come first. Every folder here is a made-up temporary one.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScanner } from '../main/real-scan.js';
import { cachePath, createScanCache } from '../main/scan-cache.js';
import { createScanSession, fingerprintOf } from '../main/scan-session.js';
import type { Fingerprinter } from '../main/scan-session.js';
import { registerRealIpc } from '../main/real-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { APP_INDEX } from '../main/security.js';
import { REAL_BASE } from '../shared/harness/route.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { REAL_CHANNELS } from '../shared/real/types.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { buildFixture } from './fixtures-real/build.js';
import type { Fixture } from './fixtures-real/build.js';
import { tempDir } from './support.js';
import type { TestContext } from 'node:test';

const fixture = (t: TestContext): Fixture => { const f = buildFixture(); t.after(() => f.cleanup()); return f; };

/** A real read of the made-up home: the places step one lists, and the answer of step two for the Claude Code and Codex places. */
async function readOf(f: Fixture): Promise<{ chosen: RealPlace[]; result: RealResult }> {
  const scanner = createScanner({ home: f.home }), found = await scanner.discover();
  const chosen = found.places.filter(p => p.label === 'Claude Code at home' || p.label === 'Codex at home');
  const batch = await scanner.read(chosen.map(p => p.id));
  return { chosen, result: buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 10, 5), foldExtraApps: true }) };
}

const counting = (): { fingerprint: Fingerprinter; calls: number[] } => {
  const calls: number[] = [];
  return { calls, fingerprint: async (home, watched, now) => { calls.push(watched.length); return fingerprintOf(home, watched, now); } };
};

test('a read is kept after it ends, and the next launch gets exactly what the window got', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  const session = createScanSession({ home: f.home, stateRoot: state, now: () => 1_234_000 });
  assert.deepEqual(await session.savedScan(), { status: 'none' }, 'nothing is kept before a read');
  assert.equal(await session.keepRead(chosen, async () => result), result, 'the read itself passes through unchanged');
  const back = await createScanSession({ home: f.home, stateRoot: state }).savedScan();
  assert.equal(back.status, 'saved');
  if (back.status !== 'saved') return;
  assert.equal(back.savedAtMs, 1_234_000);
  assert.deepEqual(back.chosen, chosen);
  assert.deepEqual(back.result, result);
  // The window makes the same screens from the kept read as from the live one.
  assert.deepEqual(realToHarnessState(back.result, back.chosen), realToHarnessState(result, chosen));
});

test('a launch with a kept read reads no folder: the fingerprint walk is not called, and the answer comes with the home folder locked', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const spy = counting(), launch = createScanSession({ home: f.home, stateRoot: state, fingerprint: spy.fingerprint });
  // Every tool folder of the made-up home is locked: a launch that listed one would meet an error and give another answer.
  for (const name of ['.claude', '.codex', '.config', '.hermes']) { try { chmodSync(join(f.home, name), 0o000); } catch { /* not there */ } }
  chmodSync(f.home, 0o000);
  try {
    const answer = await launch.savedScan();
    assert.equal(answer.status, 'saved');
    assert.deepEqual(answer.status === 'saved' ? answer.result : null, result);
    assert.deepEqual(spy.calls, [], 'no walk of any folder');
  } finally {
    chmodSync(f.home, 0o755);
    for (const name of ['.claude', '.codex', '.config', '.hermes']) { try { chmodSync(join(f.home, name), 0o755); } catch { /* not there */ } }
  }
});

test('the check is the only thing that looks at the folders, and it says same, then changed', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  const spy = counting(), session = createScanSession({ home: f.home, stateRoot: state, fingerprint: spy.fingerprint });
  await session.keepRead(chosen, async () => result);
  assert.deepEqual(spy.calls, [chosen.length], 'one walk before the read');
  assert.equal(await session.checkSavedScan(), 'same');
  assert.deepEqual(spy.calls, [chosen.length, chosen.length], 'one more walk for the check');
  mkdirSync(join(f.home, '.claude', 'skills', 'fresh'), { recursive: true });
  writeFileSync(join(f.home, '.claude', 'skills', 'fresh', 'SKILL.md'), '---\nname: Fresh\ndescription: Added after the read.\n---\n');
  assert.equal(await session.checkSavedScan(), 'changed');
});

test('a change made while the read runs is seen at the next launch, because the folders are fingerprinted first', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  const session = createScanSession({ home: f.home, stateRoot: state });
  await session.keepRead(chosen, async () => {
    writeFileSync(join(f.home, '.claude', 'skills', 'write-reply', 'SKILL.md'), '---\nname: Write a reply\ndescription: Changed during the read.\n---\n\nA new body that is longer than the old one was.\n');
    return result;
  });
  assert.equal(await session.checkSavedScan(), 'changed');
});

test('with nothing kept, or a damaged file, the check says it could not check and never throws', async t => {
  const f = fixture(t), state = tempDir(t), session = createScanSession({ home: f.home, stateRoot: state });
  assert.equal(await session.checkSavedScan(), 'unchecked');
  const { chosen, result } = await readOf(f);
  await session.keepRead(chosen, async () => result);
  writeFileSync(cachePath(state), '{"version":1');
  const launch = createScanSession({ home: f.home, stateRoot: state });
  assert.deepEqual(await launch.savedScan(), { status: 'damaged', why: 'bad-shape' });
  assert.equal(await launch.checkSavedScan(), 'unchecked');
});

test('the check works on the read the launch already loaded and shown, and does not open the file again', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const launch = createScanSession({ home: f.home, stateRoot: state });
  assert.equal(await launch.checkSavedScan(), 'unchecked', 'before a launch has loaded anything there is nothing to check');
  assert.equal((await launch.savedScan()).status, 'saved');
  // The file is replaced by another one after the launch loaded it: the check still answers for the read that is on the screen.
  writeFileSync(cachePath(state), '{"version":1');
  assert.equal(await launch.checkSavedScan(), 'same');
});

test('a check that runs past its small time budget says it could not check, and is given 5 seconds', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const budgets: (number | undefined)[] = [];
  let clock = 0;
  const slow: Fingerprinter = async (home, watched, now, budgetMs) => { budgets.push(budgetMs); return fingerprintOf(home, watched, () => { clock += 3_000; return clock; }, budgetMs); };
  const launch = createScanSession({ home: f.home, stateRoot: state, fingerprint: slow });
  await launch.savedScan();
  assert.equal(await launch.checkSavedScan(), 'unchecked');
  assert.deepEqual(budgets, [5_000]);
});

/** Names the window's path loses (see tests/scan-fingerprint.test.ts). */
const MANGLED = ['two  spaces', 'trailing ', 'n'.repeat(130), 'proj-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8', 'sk-abcdef0123456789abcdef'];

for (const name of MANGLED) {
  test(`a new skill in a picked folder named "${name.length > 30 ? `${name.slice(0, 12)}...(${name.length})` : name}" is never answered with same`, async t => {
    const f = fixture(t), state = tempDir(t), dir = join(f.home, name);
    mkdirSync(join(dir, '.claude', 'skills', 'first'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'first', 'SKILL.md'), '---\nname: First\n---\n');
    const scanner = createScanner({ home: f.home }), found = (await scanner.addFolder(dir)).places.filter(p => p.kind === 'picked');
    const batch = await scanner.read(found.map(p => p.id)), result = buildRealResult(batch.reads, batch.tally, { nowMs: 1, foldExtraApps: true });
    await createScanSession({ home: f.home, stateRoot: state }).keepRead(found, async () => result);
    mkdirSync(join(dir, '.claude', 'skills', 'second'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'skills', 'second', 'SKILL.md'), '---\nname: Second\n---\n');
    const launch = createScanSession({ home: f.home, stateRoot: state });
    assert.equal((await launch.savedScan()).status, 'saved');
    assert.notEqual(await launch.checkSavedScan(), 'same');
    assert.equal(await launch.checkSavedScan(), 'unchecked');
  });
}

test('a save that fails removes the older read, and tells it on the console in one fixed line with no path', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const real = createScanCache({ stateRoot: state }), told: unknown[][] = [];
  let forgot = 0;
  const failing = { load: () => real.load(), save: () => false, forget: () => { forgot += 1; return real.forget(); } };
  const log = mock.method(console, 'error', (...args: unknown[]) => { told.push(args); });
  try { await createScanSession({ home: f.home, stateRoot: state, cache: failing }).keepRead(chosen, async () => result); } finally { log.mock.restore(); }
  assert.equal(forgot, 1);
  assert.deepEqual(told, [['Bowerloom could not keep its last read.']]);
  assert.deepEqual(await createScanSession({ home: f.home, stateRoot: state }).savedScan(), { status: 'none' }, 'the next launch does not call an older read the last one');
});

test('a save that throws is told by its class name only, never its message', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f), told: unknown[][] = [];
  let forgot = 0;
  const throwing = { load: () => ({ status: 'none' as const }), save: (): boolean => { throw new RangeError('/private/path/in/the/message'); }, forget: () => { forgot += 1; return true; } };
  const log = mock.method(console, 'error', (...args: unknown[]) => { told.push(args); });
  try { assert.equal(await createScanSession({ home: f.home, stateRoot: state, cache: throwing }).keepRead(chosen, async () => result), result); } finally { log.mock.restore(); }
  assert.deepEqual(told, [['Bowerloom could not keep its last read (RangeError).']]);
  assert.equal(forgot, 1, 'and the older read is removed');
});

test('a read that fails passes its error on and leaves the older kept read as it was', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f), session = createScanSession({ home: f.home, stateRoot: state, now: () => 10 });
  await session.keepRead(chosen, async () => result);
  const before = readFileSync(cachePath(state), 'utf8');
  await assert.rejects(session.keepRead(chosen, async () => { throw new Error('FAILED'); }), /FAILED/);
  assert.equal(readFileSync(cachePath(state), 'utf8'), before);
});

test('a file that cannot be written never fails the read', async t => {
  const f = fixture(t), root = tempDir(t), { chosen, result } = await readOf(f);
  writeFileSync(join(root, 'a-file'), 'x');
  const session = createScanSession({ home: f.home, stateRoot: join(root, 'a-file', 'below') });
  assert.equal(await session.keepRead(chosen, async () => result), result);
  assert.deepEqual(await session.savedScan(), { status: 'none' });
});

test('a failing fingerprint never fails the read, and removes the older kept read instead of leaving it as the last one', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const broken = createScanSession({ home: f.home, stateRoot: state, fingerprint: async () => { throw new Error('no'); } });
  assert.equal(await broken.keepRead(chosen, async () => result), result);
  assert.deepEqual(await broken.savedScan(), { status: 'none' });
});

test('the kept file holds no path of this machine, no key value and no fixture folder', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const text = readFileSync(cachePath(state), 'utf8');
  assert.ok(!text.includes(f.root), 'no absolute path of the made-up home');
  assert.doesNotMatch(text, /zq9-NOT-A-REAL-VALUE|sk-FAKEFAKEFAKE/, 'no key value');
  assert.doesNotMatch(text, /OUTSIDE-THE-ALLOWLIST/, 'nothing from outside the places');
  assert.equal(JSON.stringify(JSON.parse(text).result), JSON.stringify(result), 'it is the read the window got, and nothing more');
});

// ---- the reader still asks first

type Listener = (event: RealEvent, ...args: unknown[]) => unknown;
const page: RealEvent = { senderFrame: { url: `${APP_INDEX}${REAL_BASE}`, parent: null } };

test('a kept read gives no folder an id: a read of a place that was not looked at this session is still refused', async t => {
  const f = fixture(t), state = tempDir(t), { chosen, result } = await readOf(f);
  await createScanSession({ home: f.home, stateRoot: state }).keepRead(chosen, async () => result);
  const handlers = new Map<string, Listener>();
  const session = createScanSession({ home: f.home, stateRoot: state });
  registerRealIpc({ ipc: { handle: (c, l) => { handlers.set(c, l as Listener); } }, appIndexUrl: APP_INDEX, home: f.home, chooseFolder: async () => null, keepRead: session.keepRead });
  assert.equal((await session.savedScan()).status, 'saved');
  const read = async (...args: unknown[]): Promise<string> => { try { await handlers.get(REAL_CHANNELS.readSelected)!(page, ...args); return 'answered'; } catch (e) { return (e as Error).message; } };
  assert.equal(await read(chosen.map(p => p.id)), 'UNKNOWN_PLACE', 'the ids of the kept read are not known to the reader');
  // After the look (question one) the same ids are known, and the read is answered and kept again.
  await handlers.get(REAL_CHANNELS.discoverPlaces)!(page);
  assert.equal(await read(chosen.map(p => p.id)), 'answered');
});

test('a read through the handler keeps the places the window was shown, in the order it asked for them', async t => {
  const f = fixture(t), state = tempDir(t), handlers = new Map<string, Listener>();
  const kept: { ids: string[]; at: number }[] = [];
  const session = createScanSession({ home: f.home, stateRoot: state, now: () => 99 });
  registerRealIpc({
    ipc: { handle: (c, l) => { handlers.set(c, l as Listener); } }, appIndexUrl: APP_INDEX, home: f.home, chooseFolder: async () => f.work,
    keepRead: async (chosen, read) => { kept.push({ ids: chosen.map(p => p.id), at: kept.length }); return session.keepRead(chosen, read); },
  });
  const call = (channel: string, ...args: unknown[]): Promise<any> => Promise.resolve(handlers.get(channel)!(page, ...args));
  const found = await call(REAL_CHANNELS.discoverPlaces), picked = await call(REAL_CHANNELS.pickFolder);
  const claude = found.places.find((p: RealPlace) => p.label === 'Claude Code at home'), alpha = picked.places.find((p: RealPlace) => p.label === 'alpha');
  await call(REAL_CHANNELS.readSelected, [alpha.id, claude.id]);
  assert.deepEqual(kept, [{ ids: [alpha.id, claude.id], at: 0 }]);
  const back = await session.savedScan();
  assert.equal(back.status, 'saved');
  assert.deepEqual(back.status === 'saved' ? back.chosen.map(p => p.id) : [], [alpha.id, claude.id]);
  assert.deepEqual(back.status === 'saved' ? back.chosen.map(p => p.details.path) : [], [alpha.details.path, '~']);
  // A refused read keeps nothing.
  await assert.rejects(call(REAL_CHANNELS.readSelected, ['place-000000000000']), /UNKNOWN_PLACE/);
  assert.equal(kept.length, 1);
  // The fingerprint of the kept places matches the folders now.
  assert.equal(await session.checkSavedScan(), 'same');
});
