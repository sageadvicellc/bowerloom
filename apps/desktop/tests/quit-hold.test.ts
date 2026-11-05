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
    exit: () => undefined, showBox: () => { throw new Error('no box'); }, quit: () => { events.push('quit'); handler({ preventDefault: () => { events.push('again'); } }); }, log: text => { logs.push(text); },
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
  assert.equal(h.events.includes('exit:1'), false, 'not before the time');
  await later(50);
  assert.equal(h.events.at(-1), 'exit:1');
  assert.match(h.logs.at(-1)!, /did not reach will-quit in 0\.04 seconds, so the app exits now \(engine busy: true\)/);
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
  assert.match(main, /exit: code => \{[\s\S]*?clearReportCopies\(\)[\s\S]*?app\.exit\(code\);/, 'the backstop runs the clean-up of the quit event first');
  assert.match(main, /kept: \(\) => \{ quitHeld\.cancelled\(\);/, 'a window that keeps its changes ends the held quit');
});

test('a held quit that a window cancels (Keep editing) is over: a later close of the last window quits nothing and arms no backstop', async () => {
  const h = harness(async () => undefined, { backstopMs: 30 });
  h.press(); await settle(); await settle();
  assert.deepEqual(h.events, ['prevented', 'quit']);
  h.hold.cancelled();
  h.hold.windowsClosed();
  await later(80);
  assert.deepEqual(h.events, ['prevented', 'quit'], 'no second quit and no exit');
  assert.deepEqual(h.logs, []);
});

test('cancelled also stops a backstop that is already running', async () => {
  const h = harness(async () => undefined, { backstopMs: 40 });
  h.press(); await settle(); await settle();
  h.hold.windowsClosed();
  h.hold.cancelled();
  await later(90);
  assert.equal(h.events.some(e => e.startsWith('exit')), false);
});

test('the backstop exits with code 1', async () => {
  const h = harness(async () => undefined, { backstopMs: 20 });
  h.press(); await settle(); await settle();
  h.hold.windowsClosed();
  await later(60);
  assert.equal(h.events.at(-1), 'exit:1');
});

test('the pass-through does not stay set: a quit that did not reach before-quit leaves the next quit held, and will-quit clears it too', async () => {
  const events: string[] = [];
  let busy = true;
  let handler!: ReturnType<typeof quitHold>;
  // This quit does not call before-quit (it was swallowed).
  handler = quitHold({ engine: { idle: async () => undefined, busy: () => busy }, ending: () => false, showBox: () => undefined, quit: () => { events.push('quit'); }, exit: () => undefined, log: () => undefined });
  handler({ preventDefault: () => { events.push('prevented'); } }); await settle(); await settle();
  handler({ preventDefault: () => { events.push('prevented-2'); } });
  assert.deepEqual(events, ['prevented', 'quit', 'prevented-2'], 'the second quit is held, not let through');
  await settle(); await settle();
  handler.windowsClosed();
  handler.reachedWillQuit();
  handler({ preventDefault: () => { events.push('prevented-3'); } });
  assert.equal(events.at(-1), 'prevented-3');
  busy = false;
});

test('begun() is true from the first quit until a window keeps its changes, and then false again', async () => {
  const h = harness(async () => undefined, { busy: false });
  assert.equal(h.hold.begun(), false);
  h.press();
  assert.equal(h.hold.begun(), true, 'an idle quit has begun too: a share call back from its dialog must not write');
  h.hold.cancelled();
  assert.equal(h.hold.begun(), false, 'Keep editing ends the quit; share writes work again');
});

test('a wait that fails after the quit began clears the pass-through and logs, so no later quit is let through by accident', async () => {
  const events: string[] = [], logs: string[] = [];
  let handler!: ReturnType<typeof quitHold>;
  handler = quitHold({
    engine: { idle: async () => undefined, busy: () => true }, ending: () => false, exit: () => undefined, showBox: () => undefined,
    quit: () => { events.push('quit'); throw new Error('quit failed'); },
    log: (text, cause) => { logs.push(`${text} ${cause instanceof Error ? cause.message : ''}`); },
  });
  handler({ preventDefault: () => { events.push('prevented'); } });
  await settle(); await settle();
  assert.match(logs.join('\n'), /quit failed/);
  handler({ preventDefault: () => { events.push('prevented-2'); } });
  assert.equal(events.at(-1), 'prevented-2', 'the next quit is held, not let through');
  assert.equal(handler.begun(), true, 'the second press began a quit again');
});

test('a quit that throws when it is started again leaves no quit begun, so a later share write is not refused', async () => {
  let handler!: ReturnType<typeof quitHold>;
  handler = quitHold({
    engine: { idle: async () => undefined, busy: () => true }, ending: () => false, exit: () => undefined, showBox: () => undefined,
    quit: () => { throw new Error('quit failed'); }, log: () => undefined,
  });
  handler({ preventDefault: () => undefined });
  assert.equal(handler.begun(), true);
  await settle(); await settle();
  assert.equal(handler.begun(), false);
});

test('main.ts logs a failed clean-up before the backstop exit, logs a missing engine, and keeps an error listener on stderr', () => {
  const main = readFileSync(join(DESKTOP, 'main/main.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const exit = main.slice(main.indexOf('exit: code'), main.indexOf('});', main.indexOf('exit: code')));
  assert.match(exit, /catch \(error\)/);
  assert.match(exit, /engineForExit === null/);
  assert.match(exit, /app\.exit\(code\)/);
  assert.match(main, /process\.stderr\.on\('error'/);
  assert.ok(main.indexOf("process.stderr.on('error'") < main.indexOf('leaveDock(app, argv)'), 'the listener comes first');
});
