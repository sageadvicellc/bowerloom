// A window that dies or fails to load after the app has started must never cut off a write in progress. Main waits for the engine to be idle, says so in words,
// and quits through app.quit() so that before-quit and quit run (the report copies are cleared). app.exit is for start-up failures only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngineService } from '../main/engine-service.js';
import { SAVING_WORDS, windowFailure } from '../main/window-failure.js';
import { DESKTOP, tempDir } from './support.js';
import { homeFolder } from './helpers-engine/folders.js';

const read = (path: string): string => readFileSync(join(DESKTOP, path), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

function fakes(engine: { idle(): Promise<void> } | null) {
  const events: string[] = [];
  const boxes: { title: string; message: string }[] = [];
  const handler = windowFailure({
    engine,
    say: text => { events.push(`say:${text.trim()}`); },
    showBox: (title, message) => { events.push('box'); boxes.push({ title, message }); },
    setExitCode: code => { events.push(`code:${code}`); },
    markEnding: () => { events.push('ending'); },
    quit: () => { events.push('quit'); },
  });
  return { events, boxes, handler };
}

test('with a write in progress, the box and the quit wait for the engine to be idle, and the quit is app.quit()', async () => {
  let release: () => void = () => undefined;
  const busy = new Promise<void>(resolve => { release = resolve; });
  const f = fakes({ idle: () => busy });
  const done = f.handler(new Error('The window stopped (crashed). Open Bowerloom again.'), 'Bowerloom stopped');
  await settle();
  assert.equal(f.boxes.length, 0, 'no box while the engine is busy');
  assert.equal(f.events.includes('quit'), false, 'no quit while the engine is busy');
  assert.match(f.events[0]!, /^say:Bowerloom stopped: The window stopped \(crashed\)/, 'the terminal has the cause at once, before the wait');
  release();
  await done;
  assert.equal(f.boxes.length, 1);
  assert.equal(f.boxes[0]!.title, 'Bowerloom stopped');
  assert.match(f.boxes[0]!.message, /^The window stopped \(crashed\)\. Open Bowerloom again\./);
  assert.ok(f.boxes[0]!.message.endsWith(SAVING_WORDS));
  assert.equal(SAVING_WORDS, 'If you were saving or installing, open the folder again to see what was written.');
  assert.deepEqual(f.events.filter(e => !e.startsWith('say:')), ['box', 'code:1', 'ending', 'quit'], 'the box first, then the exit code, then the mark that the app is ending, then the quit');
});

test('a second failure while the first waits adds no second box and no second quit', async () => {
  let release: () => void = () => undefined;
  const f = fakes({ idle: () => new Promise<void>(resolve => { release = resolve; }) });
  const a = f.handler(new Error('one'), 'Bowerloom stopped');
  const b = f.handler(new Error('two'), 'Bowerloom could not start');
  release(); await Promise.all([a, b]);
  assert.equal(f.boxes.length, 1);
  assert.equal(f.events.filter(e => e === 'quit').length, 1);
});

test('an engine that is already idle shows the box and quits in the same turn of work', async () => {
  const f = fakes({ idle: async () => undefined });
  await f.handler(new Error('The window stopped (oom).'), 'Bowerloom stopped');
  assert.equal(f.boxes.length, 1);
  assert.equal(f.events.at(-1), 'quit');
});

test('an engine whose idle signal fails still ends in the box and the quit', async () => {
  const f = fakes({ idle: () => Promise.reject(new Error('broken')) });
  await f.handler(new Error('The window stopped (crashed).'), 'Bowerloom stopped');
  assert.equal(f.boxes.length, 1);
  assert.equal(f.events.at(-1), 'quit');
});

test('a launch with no engine calls waits for nothing and does not mention saving', async () => {
  const f = fakes(null);
  await f.handler(new Error('The window stopped (crashed).'), 'Bowerloom stopped');
  assert.equal(f.boxes.length, 1);
  assert.doesNotMatch(f.boxes[0]!.message, /saving or installing/);
  assert.equal(f.events.at(-1), 'quit');
});

test('a box that throws still quits', async () => {
  const events: string[] = [];
  const handler = windowFailure({ engine: null, say: () => undefined, showBox: () => { throw new Error('no box'); }, setExitCode: () => undefined, markEnding: () => { events.push('ending'); }, quit: () => { events.push('quit'); } });
  await handler(new Error('x'), 'Bowerloom stopped');
  assert.deepEqual(events, ['ending', 'quit']);
});

test('the app is marked as ending before the quit, so the close question is skipped and a window with drafts cannot stop the quit', async () => {
  const f = fakes(null);
  await f.handler(new Error('The page did not load.'), 'Bowerloom could not start');
  const ending = f.events.indexOf('ending'), quit = f.events.indexOf('quit');
  assert.ok(ending >= 0 && ending < quit, 'marked, then quit');
  // A second failure does not mark or quit again.
  await f.handler(new Error('again'), 'Bowerloom stopped');
  assert.equal(f.events.filter(e => e === 'ending').length, 1);
});

test('the real engine service is not idle while a call runs, and is idle after: the serial queue is the signal', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-idle-'));
  let open: (value: string | null) => void = () => undefined;
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: () => new Promise<string | null>(resolve => { open = resolve; }), confirm: async () => true, who: 'tester' });
  let idle = false;
  await service.idle();
  const call = service.chooseFolder();
  const waiting = service.idle().then(() => { idle = true; });
  await settle(); await settle();
  assert.equal(idle, false, 'a running call keeps the engine busy');
  // A call queued behind the first one is waited for too.
  const second = service.folders();
  open(null);
  await call; await second; await waiting;
  assert.equal(idle, true);
  let again = false;
  await service.idle().then(() => { again = true; });
  assert.equal(again, true, 'an idle engine answers at once');
});

test('idle also waits for a call that fails', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-idle-'));
  let fail: (error: Error) => void = () => undefined;
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: () => new Promise<string | null>((_resolve, reject) => { fail = reject; }), confirm: async () => true, who: 'tester' });
  const call = service.chooseFolder().catch(() => 'failed');
  let idle = false;
  const waiting = service.idle().then(() => { idle = true; });
  await settle();
  assert.equal(idle, false);
  fail(new Error('boom'));
  assert.equal(await call, 'failed'); await waiting;
  assert.equal(idle, true);
});

test('main.ts: a dead or unloadable window goes through windowFailure and app.quit(); app.exit is for start-up failures only', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /webContents\.on\('render-process-gone', \(_event, details\) => \{ if \(details\.reason !== 'clean-exit'\) void windowFailed\(/);
  assert.match(main, /webContents\.on\('did-fail-load', \(_event, code, description, _url, isMainFrame\) => \{ if \(isMainFrame && code !== -3\) void windowFailed\(/);
  const dead = main.slice(main.indexOf("on('render-process-gone'"), main.indexOf("window.once('ready-to-show'"));
  assert.doesNotMatch(dead, /startupFailed|app\.exit/, 'neither window event ends the process at once');
  assert.match(main, /quit: \(\) => app\.quit\(\)/);
  assert.match(main, /markEnding: \(\) => \{ closeEnding = true; \}/, 'the failure marks the close guard before it quits');
  assert.match(main, /get engine\(\) \{ return engineForExit; \}/);
  assert.match(main, /engineForExit = engine;/, 'the engine of the launch is the one waited for');
  // The only app.exit calls: the refused start (code 2) and startupFailed (code 1).
  const exits = [...main.matchAll(/app\.exit\((\d)\)/g)].map(m => m[1]);
  assert.deepEqual(exits, ['2', '1']);
  const startup = main.slice(main.indexOf('function startupFailed'), main.indexOf('let engineForExit'));
  assert.match(startup, /app\.exit\(1\)/);
  assert.match(main, /app\.once\('quit', \(\) => \{ engine\.clearReportCopies\(\); engine\.close\(\); \}\)/, 'before-quit and quit still run for the report copies and stop the worker');
});
