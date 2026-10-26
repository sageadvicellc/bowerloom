// Hard static checks of the real-setup reader: its source calls nothing that writes, deletes, renames, starts a process or reaches the network; its bridge has exactly three
// calls; its handler answers only the app's own page; and the launcher and main process lock it the way every prototype is locked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_INDEX, decideNavigation, isAllowedRealSender, isAllowedSender } from '../main/security.js';
import { registerRealIpc, usableHome } from '../main/real-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { REAL_CALLS, REAL_CHANNELS, REAL_HARNESS_HASH, REAL_HASH } from '../shared/real/types.js';
import { CHANNELS } from '../shared/channels.js';
import { DESKTOP } from './support.js';
import { buildFixture } from './fixtures-real/build.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const names = (dir: string, pattern: RegExp): string[] => readdirSync(join(DESKTOP, dir)).filter(f => pattern.test(f)).map(f => `${dir}/${f}`);

/** The files that make up the reader on the main and bridge side. */
const MAIN_FILES = names('main', /^real-.*\.ts$/), PRELOAD_FILES = names('preload', /^real-.*\.ts$/), SHARED_FILES = names('shared/real', /\.ts$/);
const ALL = [...MAIN_FILES, ...PRELOAD_FILES, ...SHARED_FILES];

test('the reader is made of the files we expect', () => {
  assert.deepEqual(MAIN_FILES, ['main/real-fs.ts', 'main/real-ipc.ts', 'main/real-scan.ts']);
  assert.deepEqual(PRELOAD_FILES, ['preload/real-preload.ts']);
  assert.ok(SHARED_FILES.length >= 8, SHARED_FILES.join(','));
});

// What a file may import. `node:fs` only for these read calls (and the types of what they return).
const FS_READ = new Set(['lstatSync', 'readdirSync', 'readFileSync', 'realpathSync', 'statSync', 'Dirent', 'Stats']);
const MAY_IMPORT = (file: string): RegExp => (file.startsWith('main/') ? /^(\.{1,2}\/|node:fs$|node:path$)/ : file.startsWith('preload/') ? /^(\.{1,2}\/|electron$)/ : /^\.{1,2}\//);

test('the reader imports only what it needs: relative files, node:path, node:fs for the read calls below, and (in the bridge) electron', () => {
  for (const file of ALL) {
    const code = strip(read(file));
    for (const m of code.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?([^'"\n]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
      assert.match(m[2]!, MAY_IMPORT(file), `${file} imports ${m[2]}`);
      if (m[2] === 'node:fs') for (const piece of m[1]!.replace(/[{}]/g, '').split(',').map(x => x.trim().replace(/^type\s+/, '')).filter(Boolean)) assert.ok(FS_READ.has(piece), `${file} imports ${piece} from node:fs`);
    }
    assert.doesNotMatch(code, /\brequire\s*\(|\bimport\s*\(/, `${file}: no require, no dynamic import`);
  }
});

test('no file of the reader calls anything that writes, deletes, renames, links, changes a mode, starts a process, or reaches the network', () => {
  const calls = /(?<![\w$.])(writeFile\w*|appendFile\w*|mkdir\w*|mkdtemp\w*|rm\w*|rmdir\w*|unlink\w*|rename\w*|copyFile\w*|cp\w*|chmod\w*|chown\w*|lchown|lchmod|link\w*|symlink\w*|truncate\w*|utimes\w*|futimes\w*|createWriteStream|open\w*|write\w*|fsync\w*|spawn\w*|exec\w*|fork|fetch|setInterval)\s*\(/;
  const methods = /\.(write\w*|appendFile\w*|mkdir\w*|rm\w*|unlink\w*|rename\w*|copyFile\w*|chmod\w*|symlink\w*|truncate\w*|send\w*|openExternal|showItemInFolder|exec\w*|spawn\w*)\s*\(/;
  const words = /child_process|worker_threads|cluster|node:net|node:http|node:https|node:http2|node:dgram|node:dns|node:tls|node:vm|node:inspector|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bfetch\b|globalThis|\beval\b|new Function|process\./;
  for (const file of ALL) {
    // The text of a pattern in a string or a regular expression is not a call: only code is looked at (strings and regular expression bodies are blanked).
    const code = strip(read(file)).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""').replace(/(?<=[(,=:?&|!]\s*)\/(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, '/x/');
    assert.doesNotMatch(code, calls, `${file} calls ${(code.match(calls) ?? [])[0] ?? ''}`);
    assert.doesNotMatch(code, methods, `${file} calls ${(code.match(methods) ?? [])[0] ?? ''}`);
    assert.doesNotMatch(code, words, `${file} uses ${(code.match(words) ?? [])[0] ?? ''}`);
  }
});

test('the scan itself catches what it should (so a pass means something)', () => {
  const calls = /(?<![\w$.])(writeFile\w*|rm\w*|spawn\w*|exec\w*|open\w*)\s*\(/;
  for (const bad of ['writeFileSync(x, y)', 'rmSync(p)', 'spawn("a")', 'execFile(a)', 'openSync(p, "w")', 'await rm(p)']) assert.match(bad, calls, bad);
  for (const ok of ['readFileSync(p)', 'x.test(y)', 'const rmx = 1', 'format(a)']) assert.doesNotMatch(ok, calls, ok);
  const methods = /\.(write\w*|rm\w*|send\w*|exec\w*)\s*\(/;
  for (const bad of ['fs.writeFileSync(a)', 'win.webContents.send(c)', 'fs.promises.rm(p)', 'cp.execSync(c)']) assert.match(bad, methods, bad);
});

test('the handler file names the three channels and answers the app page only, before it does anything else', () => {
  const code = strip(read('main/real-ipc.ts'));
  assert.equal([...code.matchAll(/deps\.ipc\.handle\(/g)].length, 1, 'one guard registers every handler');
  assert.equal([...code.matchAll(/guarded\(REAL_CHANNELS\.\w+/g)].length, 3, 'three handlers');
  for (const call of REAL_CALLS) assert.match(code, new RegExp(`guarded\\(REAL_CHANNELS\\.${call},`), call);
  assert.doesNotMatch(code, /\.on\(|\.once\(|\.send\w*\(|\.removeHandler|ipcMain|electron/);
  const guard = code.slice(code.indexOf('const guarded'), code.indexOf('guarded(REAL_CHANNELS.discoverPlaces'));
  assert.ok(guard.indexOf('isAllowedRealSender(') > -1 && guard.indexOf('isAllowedRealSender(') < guard.indexOf('run(args)'), 'the sender is checked first');
  assert.match(guard, /frame\.parent !== null/, 'the top frame only');
  assert.match(guard, /args\.length !== argCount/, 'the number of arguments is checked');
});

test('the channels of the reader are its own: none is in the normal list, and the normal list is unchanged', () => {
  assert.deepEqual(Object.keys(REAL_CHANNELS).sort(), ['discoverPlaces', 'pickFolder', 'readSelected']);
  assert.deepEqual([...REAL_CALLS], ['discoverPlaces', 'pickFolder', 'readSelected']);
  for (const channel of Object.values(REAL_CHANNELS)) assert.ok(!(Object.values(CHANNELS) as string[]).includes(channel), channel);
  assert.equal(Object.keys(CHANNELS).length, 21);
});

test('only the app page, in real mode, may ask; the normal refusal of every prototype is not changed', () => {
  const hashes = [REAL_HASH, REAL_HARNESS_HASH, ''];
  for (const hash of hashes) { assert.equal(isAllowedRealSender(true, `${APP_INDEX}${hash}`, APP_INDEX), true, hash); assert.equal(isAllowedRealSender(false, `${APP_INDEX}${hash}`, APP_INDEX), false, `not in real mode: ${hash}`); }
  for (const url of [null, 'https://github.com/x', 'file:///etc/passwd', 'app://evil/index.html', 'app://viewer/other.html', `${APP_INDEX}?q=1`, 'devtools://devtools/bundled/x.html']) assert.equal(isAllowedRealSender(true, url, APP_INDEX), false, String(url));
  for (const hash of hashes) assert.equal(isAllowedSender(true, `${APP_INDEX}${hash}`, APP_INDEX), false, 'the normal check still refuses every prototype page');
  assert.equal(decideNavigation(`${APP_INDEX}${REAL_HASH}`, APP_INDEX), 'allow-app');
});

// ---- the handler, run with a fake in place of Electron

type Listener = (event: RealEvent, ...args: unknown[]) => unknown;
function fakeIpc(): { handlers: Map<string, Listener>; ipc: { handle(c: string, l: Listener): void } } {
  const handlers = new Map<string, Listener>();
  return { handlers, ipc: { handle: (channel, listener) => { assert.ok(!handlers.has(channel), `${channel} registered twice`); handlers.set(channel, listener); } } };
}
const page: RealEvent = { senderFrame: { url: `${APP_INDEX}${REAL_HASH}`, parent: null } };

test('the handler refuses another page, a sub-frame, no frame, and the wrong number of arguments; it never reveals more than a short code', async t => {
  const f = buildFixture();
  t.after(() => f.cleanup());
  const { handlers, ipc } = fakeIpc();
  registerRealIpc({ ipc, appIndexUrl: APP_INDEX, home: f.home, chooseFolder: async () => f.work });
  assert.deepEqual([...handlers.keys()].sort(), Object.values(REAL_CHANNELS).sort());
  const reason = async (channel: string, event: RealEvent, ...args: unknown[]): Promise<string> => { try { await handlers.get(channel)!(event, ...args); return 'answered'; } catch (e) { return (e as Error).message; } };
  for (const channel of Object.values(REAL_CHANNELS)) {
    for (const bad of [null, { url: 'https://example.com/', parent: null }, { url: `${APP_INDEX}${REAL_HASH}`, parent: {} }, { url: 'file:///etc/hosts', parent: null }]) {
      assert.equal(await reason(channel, { senderFrame: bad }), 'NOT_ALLOWED', `${channel} ${JSON.stringify(bad)}`);
    }
  }
  assert.equal(await reason(REAL_CHANNELS.discoverPlaces, page, 'extra'), 'BAD_ARGUMENT'); assert.equal(await reason(REAL_CHANNELS.pickFolder, page, {}), 'BAD_ARGUMENT'); assert.equal(await reason(REAL_CHANNELS.readSelected, page), 'BAD_ARGUMENT'); assert.equal(await reason(REAL_CHANNELS.readSelected, page, [], []), 'BAD_ARGUMENT');
  assert.equal(await reason(REAL_CHANNELS.readSelected, page, ['place-0']), 'UNKNOWN_PLACE'); assert.equal(await reason(REAL_CHANNELS.readSelected, page, []), 'BAD_ARGUMENT'); assert.equal(await reason(REAL_CHANNELS.readSelected, page, 'x'), 'BAD_ARGUMENT');
});

test('the handler runs the three calls in order: places, a picked folder, then the chosen places only', async t => {
  const f = buildFixture();
  t.after(() => f.cleanup());
  const { handlers, ipc } = fakeIpc();
  let chose: string | null = f.work;
  registerRealIpc({ ipc, appIndexUrl: APP_INDEX, home: f.home, chooseFolder: async () => chose, now: () => Date.UTC(2026, 9, 26) });
  const call = (channel: string, ...args: unknown[]): Promise<any> => Promise.resolve(handlers.get(channel)!(page, ...args));
  const d = await call(REAL_CHANNELS.discoverPlaces);
  assert.equal(d.places.length, 4);
  chose = null;
  const cancelled = await call(REAL_CHANNELS.pickFolder);
  assert.deepEqual([cancelled.cancelled, cancelled.places], [true, []]);
  chose = f.work;
  const picked = await call(REAL_CHANNELS.pickFolder);
  assert.deepEqual([picked.cancelled, picked.places.map((p: { label: string }) => p.label)], [false, ['work', 'alpha']]);
  const claude = d.places.find((p: { label: string }) => p.label === 'Claude Code at home');
  const result = await call(REAL_CHANNELS.readSelected, [claude.id]);
  assert.equal(result.counts.agents, 2); assert.equal(result.world.scopes.length, 1, 'only the chosen place is in the world');
  assert.doesNotMatch(JSON.stringify(result), /alpha|tidy-up|planner/);
});

test('usableHome accepts an absolute folder only', () => {
  const yes = (): boolean => true, no = (): boolean => false;
  assert.equal(usableHome('/Users/x', yes), '/Users/x');
  for (const bad of [undefined, null, '', '/', 'relative/path', '~', '/a\u0000b', 5]) assert.equal(usableHome(bad, yes), null, String(bad));
  assert.equal(usableHome('/Users/x', no), null);
});

// ---- the bridge: exactly three functions

test('the bridge file exposes one object with exactly three functions, each sending on its own channel, and nothing generic', () => {
  const code = strip(read('preload/real-preload.ts')).replace(/^import .*$/gm, '');
  assert.equal([...code.matchAll(/exposeInMainWorld\(/g)].length, 1);
  assert.match(code, /exposeInMainWorld\('bowerloomReal', Object\.freeze\(api\)\)/);
  const start = code.indexOf('const api: RealBridge = {'), body = code.slice(start, code.indexOf('\n};', start));
  for (const call of REAL_CALLS) assert.match(body, new RegExp(`${call}: .*ipcRenderer\\.invoke\\(REAL_CHANNELS\\.${call}`), call);
  assert.equal([...body.matchAll(/^ {2}(\w+):/gm)].length, 3, 'three properties');
  assert.deepEqual([...code.matchAll(/ipcRenderer\.(\w+)/g)].map(m => m[1]), ['invoke', 'invoke', 'invoke']);
  assert.doesNotMatch(code, /ipcRenderer\s*[,}]|exposeInMainWorld\('[^']+',\s*ipcRenderer|require\(|process\.|\.on\(|\.send\w*\(|webFrame|shell|clipboard|remote/);
});

test('the built bridge, run with a fake Electron, exposes exactly three frozen functions that send one message each and turn a refusal into a short code', async () => {
  // The bridge is built in a child process (the bundler is not bundled into the tests), in memory, from the source, with Electron left out.
  const script = "import { build } from 'esbuild'; const o = await build({ entryPoints: ['preload/real-preload.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'], logLevel: 'silent' }); process.stdout.write(o.outputFiles[0].text);";
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: DESKTOP, encoding: 'utf8', timeout: 60000 });
  assert.equal(built.status, 0, built.stderr);
  const code = built.stdout;
  const sent: [string, unknown[]][] = [];
  let exposed: { name: string; api: Record<string, (...a: unknown[]) => Promise<unknown>> } | null = null;
  let fail: Error | null = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: never) => { exposed = { name, api }; } },
    ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => { sent.push([channel, args]); return fail === null ? Promise.resolve('ok') : Promise.reject(fail); } },
  };
  new Function('require', 'module', 'exports', code)((id: string) => { assert.equal(id, 'electron'); return electron; }, { exports: {} }, {});
  assert.ok(exposed !== null);
  const { name, api } = exposed as { name: string; api: Record<string, (...a: unknown[]) => Promise<unknown>> };
  assert.equal(name, 'bowerloomReal');
  assert.deepEqual(Object.keys(api).sort(), ['discoverPlaces', 'pickFolder', 'readSelected']);
  assert.equal(Object.isFrozen(api), true);
  await api.discoverPlaces!(); await api.pickFolder!(); await api.readSelected!(['a', 5, null, 'b']); await api.readSelected!('x' as never);
  assert.deepEqual(sent, [[REAL_CHANNELS.discoverPlaces, []], [REAL_CHANNELS.pickFolder, []], [REAL_CHANNELS.readSelected, [['a', 'b']]], [REAL_CHANNELS.readSelected, [[]]]]);
  fail = new Error("Error invoking remote method 'bowerloom-real:read-selected': Error: UNKNOWN_PLACE");
  await assert.rejects(api.readSelected!(['a']), (e: Error) => e.message === 'UNKNOWN_PLACE');
  fail = new Error('C:\\secret\\path exploded');
  await assert.rejects(api.discoverPlaces!(), (e: Error) => e.message === 'FAILED');
});

// ---- main.ts and the launcher: the same lock as every prototype

test('main.ts: the real flag is one more prototype mode (temp data folder, strict CSP, no outside link), with one preload of its own and a page of its own', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /const prototypeReal = argv\.includes\('--prototype-real'\);/);
  assert.match(main, /const prototypeMode = argv\.includes\('--prototype'\) \|\| prototypeV2 \|\| prototypeReal;/);
  assert.match(main, /prototypeReal \? webPreferences\(join\(root, 'preload-real\.cjs'\), app\.isPackaged\) : webPreferences\(prototypeMode \? undefined : join\(root, 'preload\.cjs'\), app\.isPackaged\)/);
  assert.equal([...main.matchAll(/preload-real\.cjs/g)].length, 1, 'the real bridge is named once');
  assert.equal([...main.matchAll(/registerRealIpc\(/g)].length, 1);
  assert.match(main, /if \(prototypeReal\) \{[\s\S]*?registerRealIpc\(/, 'the handlers exist only in real mode');
  assert.match(main, /loadURL\(`\$\{indexUrl\}\$\{REAL_HASH\}`\)\.catch\(startupFailed\)/);
  assert.equal([...main.matchAll(/ipcMain\.handle/g)].length, 1, 'main.ts still has one guard of its own');
  assert.equal([...main.matchAll(/!prototypeMode/g)].length, 2, 'an outside link is opened only outside prototype mode, in both places');
  assert.match(main, /The real setup reader needs a home folder/);
  assert.match(main, /prototypeReal && asked === join\(rendererDir, 'index\.html'\) \? join\(rendererDir, 'real\.html'\) : asked/);
});

test('the real page has the same policy as the normal one, and a script of its own', () => {
  const real = read('renderer/home/real/real.html'), normal = read('renderer/index.html');
  assert.equal(/Content-Security-Policy" content="([^"]+)"/.exec(real)![1], /Content-Security-Policy" content="([^"]+)"/.exec(normal)![1]);
  assert.doesNotMatch(real, /<style|onclick|onload|javascript:/i);
  assert.deepEqual([...real.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]), ['real.js']);
});

test('the launcher: the real flag is known, excludes every other mode, needs a real home folder, and says what it reads before the window opens', async () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\[[^\]]*'--prototype-real'/); assert.match(src, /MODES = new Set\(\[[^\]]*'--prototype-real'/);
  const run = (args: string[], env: Record<string, string>): { status: number | null; stdout: string; stderr: string } => {
    const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), ...args], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8', timeout: 30000 });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  for (const other of ['--sample-data', '--real-data', '--sandbox', '--prototype', '--prototype-v2']) {
    const r = run(['--prototype-real', other], { HOME: '/tmp' });
    assert.equal(r.status, 2, other); assert.match(r.stderr, /not more/); assert.doesNotMatch(r.stdout, /Installing|Building/);
  }
  for (const home of ['', 'relative/home', '/this/folder/does/not/exist']) {
    const r = run(['--prototype-real', '--build-only'], { HOME: home });
    assert.equal(r.status, 2, `HOME=${home}`); assert.match(r.stderr, /needs a home folder/); assert.doesNotMatch(r.stdout, /Installing|Building/, 'nothing is built, nothing is read');
  }
  const mod = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { REAL_PROMISE: string; REAL_FLAG: string; realHome(env: Record<string, string>, exists: (p: string) => boolean): string | null; electronArgs(d: string, f: string[], u: string | null): string[] };
  assert.equal(mod.REAL_PROMISE, 'Reads: names, descriptions, structure and key names. Writes: nothing.');
  assert.equal(mod.REAL_FLAG, '--prototype-real');
  if (process.platform !== 'win32') assert.equal(mod.realHome({ HOME: '/Users/x' }, () => true), '/Users/x');
  assert.equal(mod.realHome({ HOME: '/Users/x' }, () => false), null); assert.equal(mod.realHome({}, () => true), null); assert.equal(mod.realHome({ HOME: 'x' }, () => true), null);
  assert.deepEqual(mod.electronArgs('/d', ['--prototype-real'], '/tmp/bowerloom-prototype-x'), ['/d', '--user-data-dir=/tmp/bowerloom-prototype-x', '--prototype-real']);
  assert.match(src, /PROTOTYPES\.some\(flag => args\.includes\(flag\)\) \|\| args\.includes\(REAL_FLAG\) \? makePrototypeDataDir\(\) : null/, 'the real preview gets a fresh temporary data folder too');
  assert.match(src, /console\.log\(`\\n\$\{REAL_PROMISE\}/);
  const root = JSON.parse(read('../../package.json')) as { scripts: Record<string, string> };
  assert.equal(root.scripts['desktop:prototype:real'], 'node apps/desktop/tools/run.mjs --prototype-real');
  assert.equal(root.scripts['desktop:prototype:v2'], 'node apps/desktop/tools/run.mjs --prototype-v2', 'the sample world keeps its own command');
});

test('the real page source never builds markup from text and never reaches the normal bridge', () => {
  for (const file of names('renderer/home/real', /\.tsx?$/)) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\(|new Function\(|window\.bowerloom\b|localStorage|sessionStorage|indexedDB|\bfetch\(|XMLHttpRequest|WebSocket/, file);
  }
});
