// A quit while the engine works (an import or an export writing) is held until the engine is idle, with a bound and a box; after the bound the app quits and the journal
// recovers the folder. The tools come in as arguments, so no Electron runs here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUIT_WORDS, QUIT_WAIT_MS, quitHold } from '../main/quit-hold.js';
import { DESKTOP } from './support.js';

const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
const later = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function harness(idle: (() => Promise<void>) | null, options: { waitMs?: number; boxAfterMs?: number; ending?: boolean; busy?: boolean; backstopMs?: number } = {}) {
  const events: string[] = [], logs: string[] = [];
  let prevented = 0;
  let handler!: ReturnType<typeof quitHold>;
  handler = quitHold({
    engine: idle === null ? null : { idle, busy: () => options.busy !== false },
    ending: () => options.ending === true,
    exit: code => { events.push(`exit:${code}`); },
    ...(options.backstopMs === undefined ? {} : { backstopMs: options.backstopMs }),
    showBox: words => { events.push(`box:${words.title}`); },
    // app.quit() runs before-quit again.
    quit: () => { events.push('quit'); handler({ preventDefault: () => { prevented += 1; events.push('prevented-again'); } }); },
    log: text => { logs.push(text); },
    ...(options.waitMs === undefined ? {} : { waitMs: options.waitMs }),
    ...(options.boxAfterMs === undefined ? {} : { boxAfterMs: options.boxAfterMs }),
  });
  const hold = handler;
  const press = (): void => { handler({ preventDefault: () => { prevented += 1; events.push('prevented'); } }); };
  return { events, logs, press, hold, prevented: () => prevented };
}

test('the words of the box say a save is finishing, name the bound, and say what happens after', () => {
  assert.match(QUIT_WORDS.message, /save is finishing/);
  assert.match(QUIT_WORDS.detail, new RegExp(`${QUIT_WAIT_MS / 1000} seconds`));
  assert.match(QUIT_WORDS.detail, /Finish a stopped harness/);
  assert.equal(QUIT_WAIT_MS, 30_000);
});

test('a quit during a write is held: no quit and a box while the engine is busy, then the quit goes on once the engine is idle', async () => {
  let release: () => void = () => undefined;
  const h = harness(() => new Promise<void>(resolve => { release = resolve; }), { boxAfterMs: 5, waitMs: 5_000 });
  h.press();
  assert.deepEqual(h.events, ['prevented'], 'the first quit is stopped');
  await later(30);
  assert.deepEqual(h.events, ['prevented', `box:${QUIT_WORDS.title}`], 'the box shows, and the quit has not gone');
  release(); await later(10);
  assert.deepEqual(h.events, ['prevented', `box:${QUIT_WORDS.title}`, 'quit'], 'the quit goes on; the quit it makes is let through, not held again');
  assert.deepEqual(h.logs, []);
});

test('an engine that is idle at once shows no box; the quit is held for a turn and then goes on', async () => {
  const h = harness(async () => undefined, { boxAfterMs: 200 });
  h.press(); await settle(); await settle();
  assert.deepEqual(h.events, ['prevented', 'quit']);
});

test('past the bound the app quits anyway, and the log says a stopped save is recovered at the next open', async () => {
  const h = harness(() => new Promise<void>(() => undefined), { boxAfterMs: 5, waitMs: 40 });
  h.press();
  await later(90);
  assert.deepEqual(h.events, ['prevented', `box:${QUIT_WORDS.title}`, 'quit']);
  assert.equal(h.logs.length, 1);
  assert.match(h.logs[0]!, /did not finish/);
  assert.match(h.logs[0]!, /recovered when the folder is opened again/);
});

test('a second quit while the first is held adds no second box and no second quit', async () => {
  let release: () => void = () => undefined;
  const h = harness(() => new Promise<void>(resolve => { release = resolve; }), { boxAfterMs: 5, waitMs: 5_000 });
  h.press(); h.press(); h.press();
  await later(30);
  release(); await later(10);
  assert.equal(h.events.filter(e => e.startsWith('box:')).length, 1);
  assert.equal(h.events.filter(e => e === 'quit').length, 1);
});

test('a launch with no engine calls, and an app that is already ending on its own, are not held', () => {
  const none = harness(null);
  none.press();
  assert.deepEqual(none.events, [], 'no preventDefault, no quit');
  const ending = harness(() => new Promise<void>(() => undefined), { ending: true });
  ending.press();
  assert.deepEqual(ending.events, [], 'the failed-window path has its own bound');
});

test('an engine whose idle signal fails does not stop the quit, and the failure is logged', async () => {
  const h = harness(() => Promise.reject(new Error('broken')), { boxAfterMs: 50 });
  h.press(); await later(20);
  assert.deepEqual(h.events, ['prevented', 'quit']);
  assert.equal(h.logs.length, 1);
});

test('a box that cannot be shown is logged and the wait goes on', async () => {
  const logs: string[] = [], events: string[] = [];
  let release: () => void = () => undefined;
  let handler!: ReturnType<typeof quitHold>;
  handler = quitHold({
    engine: { idle: () => new Promise<void>(resolve => { release = resolve; }), busy: () => true }, ending: () => false, boxAfterMs: 5, waitMs: 5_000,
    showBox: () => { throw new Error('no box'); }, quit: () => { events.push('quit'); handler({ preventDefault: () => { events.push('again'); } }); }, log: text => { logs.push(text); },
  });
  handler({ preventDefault: () => { events.push('prevented'); } });
  await later(30);
  assert.equal(logs.length, 1);
  release(); await later(10);
  assert.deepEqual(events, ['prevented', 'quit']);
});

test('a quit that was cancelled afterwards (the close question said Keep editing) holds the next quit again', async () => {
  const h = harness(async () => undefined);
  h.press(); await settle(); await settle();
  assert.deepEqual(h.events, ['prevented', 'quit']);
  h.press(); await settle(); await settle();
  assert.deepEqual(h.events, ['prevented', 'quit', 'prevented', 'quit'], 'the pass-through was used up by the first quit');
});

test('main.ts wires before-quit to the hold, with the engine of the launch and the failed-window mark', () => {
  const main = readFileSync(join(DESKTOP, 'main/main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(main, /const quitHeld = quitHold\(\{/);
  assert.match(main, /app\.on\('before-quit', quitHeld\)/);
  const block = main.slice(main.indexOf('const quitHeld'), main.indexOf('function createWindow'));
  assert.match(block, /get engine\(\) \{ return engineForExit; \}/);
  assert.match(block, /ending: \(\) => closeEnding/);
  assert.match(block, /quit: \(\) => app\.quit\(\)/);
});

test('an idle engine is never held: no preventDefault, no box, no quit of its own (the signal quit of the built app depends on this)', async () => {
  const h = harness(async () => undefined, { busy: false });
  h.press(); await settle();
  assert.deepEqual(h.events, [], 'the quit goes on by itself');
  assert.equal(h.prevented(), 0);
});

test('backstop: a held quit that closes every window and never reaches will-quit ends the app with exit(0) after the backstop time, and logs it', async () => {
  const h = harness(async () => undefined, { backstopMs: 40 });
  h.press(); await settle(); await settle();
  assert.deepEqual(h.events, ['prevented', 'quit']);
  h.hold.windowsClosed();
  assert.equal(h.events.filter(e => e === 'quit').length, 2, 'the windows are closed and will-quit has not come: the quit is asked once more');
  await later(20);
  assert.equal(h.events.includes('exit:0'), false, 'not before the time');
  await later(50);
  assert.equal(h.events.at(-1), 'exit:0');
  assert.match(h.logs.at(-1)!, /did not reach will-quit in 0\.04 seconds, so the app exits now/);
});

test('a quit that began as a signal: after the windows close without will-quit, the second ask goes through and is not held again', async () => {
  const h = harness(async () => undefined);
  h.press(); await settle(); await settle();
  h.hold.windowsClosed();
  assert.deepEqual(h.events, ['prevented', 'quit', 'quit']);
  assert.equal(h.prevented(), 1, 'only the first quit was stopped');
});

test('backstop: it does not fire on a normal quit that reaches will-quit', async () => {
  const h = harness(async () => undefined, { backstopMs: 30 });
  h.press(); await settle(); await settle();
  h.hold.windowsClosed();
  h.hold.reachedWillQuit();
  await later(80);
  assert.equal(h.events.some(e => e.startsWith('exit')), false);
  assert.deepEqual(h.logs, []);
});

test('backstop: it does not fire for a quit that was never held, or for a held quit that a window cancelled (the window stays open, so no window-all-closed)', async () => {
  const idle = harness(async () => undefined, { busy: false, backstopMs: 20 });
  idle.press(); idle.hold.windowsClosed();
  const cancelled = harness(async () => undefined, { backstopMs: 20 });
  cancelled.press(); await settle(); await settle();
  await later(70);
  assert.equal(idle.events.some(e => e.startsWith('exit')), false);
  assert.equal(cancelled.events.some(e => e.startsWith('exit')), false, 'Keep editing keeps the app and its drafts');
});

test('backstop: a new quit cancels the timer of the old one', async () => {
  const h = harness(async () => undefined, { backstopMs: 40 });
  h.press(); await settle(); await settle();
  h.hold.windowsClosed();
  h.press(); await settle(); await settle();
  await later(80);
  assert.equal(h.events.some(e => e.startsWith('exit')), false);
});

test('main.ts wires will-quit and window-all-closed to the hold, and the exit to app.exit', () => {
  const main = readFileSync(join(DESKTOP, 'main/main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(main, /app\.on\('will-quit', quitHeld\.reachedWillQuit\)/);
  assert.match(main, /app\.on\('window-all-closed', quitHeld\.windowsClosed\)/);
  assert.match(main, /exit: code => app\.exit\(code\)/);
});
