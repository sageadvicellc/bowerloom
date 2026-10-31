// Hard static checks of the real-setup reader: its source calls nothing that writes, deletes, renames, starts a process or reaches the network; its bridge has exactly three
// calls; its handler answers only the app's own page; and the launcher and main process lock it the way every launch is locked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_INDEX, decideNavigation, isAllowedRealSender } from '../main/security.js';
import { registerRealIpc, usableHome } from '../main/real-ipc.js';
import type { RealEvent } from '../main/real-ipc.js';
import { REAL_BASE } from '../shared/harness/route.js';
import { REAL_CALLS, REAL_CHANNELS } from '../shared/real/types.js';
import { ENGINE_CALLS, ENGINE_CHANNELS } from '../shared/engine/types.js';
import type { EngineCall } from '../shared/engine/types.js';
import { DESKTOP, tempDir } from './support.js';
import { bundleOf, checkEntries, importsOf, problemsOfBuilt, problemsOfLibraryBundle, problemsOfShippedBundle, tokenize } from './fixtures-real/static-check.js';
import type { BundleAllowance, Policy } from './fixtures-real/static-check.js';
import { buildFixture } from './fixtures-real/build.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const names = (dir: string, pattern: RegExp): string[] => readdirSync(join(DESKTOP, dir)).filter(f => pattern.test(f)).map(f => `${dir}/${f}`);

/** The files that make up the reader on the main and bridge side. */
const MAIN_FILES = names('main', /^real-.*\.ts$/), PRELOAD_FILES = names('preload', /^real-.*\.ts$/), SHARED_FILES = names('shared/real', /\.ts$/);

test('the reader is made of the files we expect', () => {
  assert.deepEqual(MAIN_FILES, ['main/real-fs.ts', 'main/real-ipc.ts', 'main/real-scan.ts']);
  assert.deepEqual(PRELOAD_FILES, ['preload/real-preload.ts']);
  assert.ok(SHARED_FILES.length >= 8, SHARED_FILES.join(','));
});

// ---- what the reader may import and call. The checker is in tests/fixtures-real/static-check.ts: it asks esbuild for the whole import graph (every relative import followed,
// however deep), reads each file of it as plain JavaScript with a real tokenizer, and refuses a file, an import or a name that is not on the lists below.

const FS_READ = ['lstatSync', 'readdirSync', 'readFileSync', 'realpathSync', 'statSync', 'openSync', 'closeSync', 'fstatSync', 'readSync', 'opendirSync', 'constants'];
const SHARED_REAL = (rel: string): boolean => /^shared\/real\/[\w-]+\.ts$/.test(rel);

const MAIN_ENTRIES = ['main/real-ipc.ts', 'main/real-scan.ts', 'main/real-fs.ts'];
const MAIN_POLICY: Policy = {
  allowFile: rel => SHARED_REAL(rel) || /^main\/real-[\w-]+\.ts$/.test(rel) || ['main/safe.ts', 'main/security.ts', 'shared/world/sample.ts', 'shared/world/types.ts', 'shared/world/rng.ts', 'shared/world/words.ts', 'shared/world/slicerule.ts'].includes(rel),
  // main/security.ts re-exports the temporary-folder helpers of the made-up launches from main/temp-data.mjs. The reader imports none of them, so the bundler drops that file;
  // the check holds it to contributing no code at all.
  deadOk: { 'main/temp-data.mjs': 'security.ts re-exports the helpers of the made-up launches; the reader uses none and the bundle holds none of it' },
  modules: { 'node:fs': FS_READ, 'node:path': '*', 'node:url': ['fileURLToPath'] },
};
const PRELOAD_POLICY: Policy = {
  // The bridge also names the calls of the adopt and install sheets (shared/engine/types.ts): names and channels only, no code that runs.
  allowFile: rel => SHARED_REAL(rel) || /^preload\/real-[\w-]+\.ts$/.test(rel) || rel === 'shared/engine/types.ts',
  deadOk: {},
  modules: { electron: ['contextBridge', 'ipcRenderer'] },
};
// The page. The window runs one script, dist/renderer/app.js, built from renderer/app.ts: the harness-first app and everything it imports. That code sees the person's setup, so it is held to the
// rules of a page: no markup built from text, no channel out of the page, no text run as code, no storage, no new window, and the real bridge named in one file only. The names that write
// files or start programs are the ordinary words of a page, so they are not on this list.
const SHELL_ENTRIES = ['renderer/app.ts'];
const SHELL_POLICY: Policy = {
  page: true,
  allowFile: rel => /^(?:renderer|shared)\/[\w./-]+\.(?:tsx?|css)$/.test(rel) || /(?:^|\/)packages\/harness-definition\/src\/words\.ts$/.test(rel),
  deadOk: {},
  modules: { react: '*', 'react/jsx-runtime': '*', 'react-dom': '*', 'react-dom/client': '*' },
  extraNames: /^(?:innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|localStorage|sessionStorage|indexedDB|openDatabase|bowerloomReal)$/,
  extraStrings: /^(?:innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|localStorage|sessionStorage|indexedDB|bowerloomReal)$/,
  extraPaths: ['window.bowerloom', 'window.open', 'self.open', 'top.open', 'globalThis.open', 'document.write', 'document.writeln'],
  tolerate: {
    'renderer/home/real/bridge.ts': { names: /^bowerloomReal$/, strings: /^bowerloomReal$/, why: 'the one file that names the real bridge, read from the window by name' },
    'renderer/harness/tour/seen.ts': { names: /^sessionStorage$/, strings: /^$/, why: 'keeps one key, whether the guided tour was seen, in the window\'s memory-only session store; tests/harness-boundary.test.ts allows it in this file alone' },
  },
};

test('the main-process reader and everything it imports, however deep, import only the allowed files and modules and use no name that writes, runs a program, or reaches the network', () => {
  assert.deepEqual(checkEntries(MAIN_ENTRIES, DESKTOP, MAIN_POLICY), []);
});

test('the check sees the whole graph: the files the handler imports are all in it, and the file it must not use contributes nothing', () => {
  const graph = bundleOf(MAIN_ENTRIES, DESKTOP);
  const seen = new Map(graph.files.map(f => [f.abs.slice(DESKTOP.length + 1), f.bytes]));
  for (const file of ['main/real-ipc.ts', 'main/real-scan.ts', 'main/real-fs.ts', 'main/safe.ts', 'main/security.ts', 'shared/real/redact.ts', 'shared/real/adapters.ts', 'shared/real/map-world.ts', 'shared/real/toml.ts', 'shared/world/sample.ts']) assert.ok((seen.get(file) ?? 0) > 0, `${file} is in the graph and in the bundle`);
  assert.equal(seen.get('main/temp-data.mjs'), 0, 'the temporary-folder helpers are reached through main/security.ts and put no code in the bundle');
  assert.ok(graph.files.every(f => f.js !== ''), 'every file of the graph was read as JavaScript');
});

test('the tokenizer finds the same imports that esbuild finds, in every file of the real graphs', () => {
  for (const [entries, format, platform] of [[MAIN_ENTRIES, 'esm', 'node'], [['preload/real-preload.ts'], 'cjs', 'node'], [SHELL_ENTRIES, 'esm', 'browser']] as const) {
    for (const file of bundleOf(entries, DESKTOP, format, platform).files) {
      const mine = new Set(importsOf(tokenize(file.js)).map(i => i.from).filter(from => !from.startsWith('.')));
      assert.deepEqual([...mine].sort(), [...new Set(file.externals)].sort(), file.abs);
      assert.ok(file.kinds.every(kind => kind === 'import-statement' || kind === 'import-rule' || kind === 'require-call'), `${file.abs} has only static imports: ${file.kinds.join(',')}`);
    }
  }
});

test('the whole page that the window runs (renderer/app.ts and every file it imports) builds no markup from text, opens no channel out of the page, runs no text as code, uses no storage or new window, and names the real bridge in bridge.ts only', () => {
  assert.deepEqual(checkEntries(SHELL_ENTRIES, DESKTOP, SHELL_POLICY, 'esm', 'browser'), []);
});

test('the page check covers the files that ship: the entry, the harness mount, the real screens and the bridge are in its graph, and the home app is not', () => {
  const seen = new Set(bundleOf(SHELL_ENTRIES, DESKTOP, 'esm', 'browser').files.map(f => f.abs.slice(DESKTOP.length + 1)));
  for (const file of ['renderer/app.ts', 'renderer/harness/mount.tsx', 'renderer/harness/HarnessApp.tsx', 'renderer/harness/real/RealChoose.tsx', 'renderer/home/real/bridge.ts']) assert.ok(seen.has(file), `${file} is in the graph`);
  for (const file of ['renderer/home/mount.tsx', 'renderer/home/HomeApp.tsx', 'renderer/home/real/mountReal.tsx']) assert.equal(seen.has(file), false, `${file} is gone`);
  // The files that the window loads are the ones the page entry imports: if the page entry stops importing the harness mount, this list is stale.
  assert.match(read('renderer/app.ts'), /from '\.\/harness\/mount\.js'/);
});

test('the bridge and everything it imports use only electron\'s contextBridge and ipcRenderer, and no banned name', () => {
  assert.deepEqual(checkEntries(['preload/real-preload.ts'], DESKTOP, PRELOAD_POLICY, 'cjs'), []);
});

// The built files. The real handler is bundled into dist/main.mjs together with the normal controller and the rest of the main process, so that file holds code the reader's
// rules do not apply to; it cannot be scanned the same way. The module boundary is held instead: the source check above covers every file the real handler imports, and the two
// files below are the whole of what the real mode loads besides main.mjs.
const BUILT_PRELOAD_ENTRY = 'preload/real-preload.ts';

test('the built bridge (preload-real.cjs) holds no banned name, and calls require only for electron', () => {
  const inMemory = bundleOf([BUILT_PRELOAD_ENTRY], DESKTOP, 'cjs', 'node', 'external').outputs[0]!;
  assert.deepEqual(problemsOfBuilt('preload-real.cjs (built now)', inMemory, PRELOAD_POLICY, ['electron']), []);
  const onDisk = join(DESKTOP, 'dist', 'preload-real.cjs');
  if (existsSync(onDisk)) assert.deepEqual(problemsOfBuilt('dist/preload-real.cjs', readFileSync(onDisk, 'utf8'), PRELOAD_POLICY, ['electron']), []);
});

// The page script that ships is dist/renderer/app.js: tools/bundle.mjs builds renderer/app.ts (the harness-first app, with React) as one
// script. It is built here in memory the same way and read for every sink and channel by name. A library uses a few of these names for its own business; each is listed with its exact count
// and its reason, so a new use, or a library update that adds one, fails here until a person has looked at it.
const KNOWN_LIBRARY_USES: Readonly<Record<string, BundleAllowance>> = {
  innerHTML: { ids: 3, strings: 2, why: 'react-dom sets and clears it for its own nodes and for the dangerouslySetInnerHTML prop that no file of ours uses' },
  dangerouslySetInnerHTML: { ids: 4, strings: 9, why: 'react-dom handles the prop by name; the source check above refuses the name in every file of ours' },
  bowerloomReal: { ids: 1, strings: 0, why: 'renderer/home/real/bridge.ts, the one file that reads the real bridge from the window; the source check above refuses the name anywhere else' },
  sessionStorage: { ids: 2, strings: 0, why: 'renderer/harness/tour/seen.ts keeps one key, whether the guided tour was seen, in the window\'s memory-only session store, so the tour starts once at first use; tests/harness-boundary.test.ts allows it in that file alone and refuses storage on disk everywhere' },
};

test('the page script that ships (built as it is for dist/renderer/app.js) uses no sink or channel beyond the listed library uses, each at its exact count', () => {
  assert.match(read('tools/bundle.mjs'), /entryPoints: \[join\(here, 'renderer\/app\.ts'\)\], outfile: join\(here, 'dist\/renderer\/app\.js'\), format: 'iife', platform: 'browser'/, 'the shipped script is built from renderer/app.ts');
  const built = bundleOf(['renderer/app.ts'], DESKTOP, 'iife', 'browser', 'bundle');
  assert.ok(built.inputs.some(f => f.endsWith('renderer/harness/real/RealChoose.tsx')) && built.inputs.some(f => f.endsWith('renderer/harness/mount.tsx')), 'the shipped script holds the harness-first app');
  assert.deepEqual(problemsOfShippedBundle('renderer/app.ts (built now)', built.outputs[0]!, KNOWN_LIBRARY_USES), []);
});

// ---- the checker itself, shown to fail on bad files

test('the tokenizer knows strings, comments, templates and regular expressions, so text inside one cannot hide a call or make one up', () => {
  const ids = (src: string): string[] => tokenize(src).filter(t => t.type === 'id').map(t => t.text);
  assert.deepEqual(ids('const a = "/*"; wf(1); const b = "*/";'), ['const', 'a', 'wf', 'const', 'b'], 'a comment marker inside a string hides nothing');
  assert.deepEqual(ids('// writeFileSync(x)\nx(); /* rmSync */ y();'), ['x', 'y'], 'a comment is not code');
  assert.deepEqual(ids('f("writeFileSync", \'rm\', `exec`)'), ['f'], 'a string is not code');
  assert.deepEqual(ids('const t = `a ${b + `c ${d}`} e ${rmSync(f)}`;'), ['const', 't', 'b', 'd', 'rmSync', 'f'], 'code inside a template substitution is code');
  assert.deepEqual(ids('x = /\\/\\*/.test(y) ? 1 : z / 2 / w; q();'), ['x', 'test', 'y', 'z', 'w', 'q'], 'a regular expression is not a comment, and a division is not a regular expression');
  assert.deepEqual(ids('a\n/ b / c'), ['a', 'b', 'c']);
  assert.deepEqual(importsOf(tokenize('import {\n  a,\n  b as c,\n} from "node:fs";\nimport d, * as e from "x";\nimport "y";\nexport * from "z";\nexport { q } from "w";\nexport { local };\nexport const k = 1;\nimport("dyn");')).map(i => [i.from, ...i.members]),
    [['node:fs', 'a', 'b'], ['x', 'default', '*'], ['y'], ['z', '*'], ['w', 'q']]);
});

test('the checker rejects bad files: a multi-line aliased writer import, a relative import to a writer (used or not), Function, constructor.constructor, eval, a comment marker in a string, a dynamic import, require, process.binding, a process, the network, a namespace import, and other open flags', t => {
  const dir = tempDir(t), put = (name: string, text: string): string => { const file = join(dir, name); writeFileSync(file, text); return file; };
  const good = put('good.ts', "import { readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nexport const read = (d: string): string => readFileSync(join(d, 'a'), 'utf8');\n// writeFileSync is only named in this comment\nexport const text = 'rm -rf /*';\n");
  put('writer.ts', "import { writeFileSync } from 'node:fs';\nexport const save = (p: string): void => writeFileSync(p, 'x');\n");
  const bad: Record<string, [string, RegExp]> = {
    multi: ["import {\n  readFileSync,\n  writeFileSync as wf\n} from 'node:fs';\nexport const x = (): string => { wf('/tmp/x', 'y'); return readFileSync('/tmp/x', 'utf8'); };\n", /imports writeFileSync from node:fs/],
    rel: ["import { save } from './writer.js';\nexport const y = (): void => save('/tmp/x');\n", /writer\.ts: is imported by the reader but is not on the list/],
    relUnused: ["import { save } from './writer.js';\nexport const z = (): number => 1;\nexport { save };\n", /writer\.ts: is imported by the reader but is not on the list/],
    fn: ["export const f = (): unknown => Function('return 1')();\n", /uses Function/],
    newFn: ["export const f = (): unknown => new Function('return 1')();\n", /uses Function/],
    ctor: ["export const g = (): unknown => ([] as unknown as { constructor: { constructor: (s: string) => () => unknown } }).constructor.constructor('return 1')();\n", /uses constructor\.constructor/],
    ctorString: ["export const g2 = (o: Record<string, unknown>): unknown => o['constructor'];\n", /names a banned thing/],
    evil: ["export const h = (): unknown => eval('1');\n", /uses eval/],
    hidden: ["const a = '/*';\nimport { writeFileSync as wf } from 'node:fs';\nexport const i = (): void => wf('/tmp/x', 'y');\nconst b = '*/';\nexport { a, b };\n", /imports writeFileSync from node:fs/],
    regex: ["import { rmSync } from 'node:fs';\nexport const j = /\\/\\*/.test('x') ? 1 : 2;\nexport const j2 = (): void => rmSync('/tmp/x');\n", /imports rmSync from node:fs|uses rmSync/],
    dyn: ["export const k = async (): Promise<unknown> => import('node:fs');\n", /uses a dynamic import/],
    req: ["declare const require: (id: string) => unknown;\nexport const l = require('node:fs');\n", /uses require/],
    bind: ["export const m = (process as unknown as { binding(n: string): unknown }).binding('fs');\n", /uses process|uses binding/],
    child: ["import { spawn } from 'node:child_process';\nexport const n = spawn;\n", /imports node:child_process, which the reader may not use/],
    net: ["export const o = (): Promise<unknown> => fetch('https://example.test');\n", /uses fetch/],
    ns: ["import * as fs from 'node:fs';\nexport const p = fs;\n", /imports \* from node:fs/],
    flags: ["import { openSync } from 'node:fs';\nexport const q = (): number => openSync('/tmp/x', 'w');\n", /openSync with flags other than OPEN_READ/],
    flagsAlias: ["import { openSync as openIt } from 'node:fs';\nexport const q2 = (): number => openIt('/tmp/x', 'w');\n", /openIt with flags other than OPEN_READ/],
    flagBuilt: ["import { constants } from 'node:fs';\nexport const OPEN_READ = constants.O_RDONLY | constants.O_WRONLY;\n", /open flag O_WRONLY/],
    named: ["export const r = (fs: Record<string, unknown>): unknown => fs['writeFileSync'];\n", /names a banned thing/],
    tpl: ["export const s = `a ${eval('1')} b`;\n", /uses eval/],
    socket: ["export const u = (): unknown => new WebSocket('wss://x.test');\n", /uses WebSocket/],
  };
  const files = Object.fromEntries(Object.entries(bad).map(([name, [text]]) => [name, put(`${name}.ts`, text)]));
  const policy: Policy = {
    allowFile: rel => rel !== join(dir, 'writer.ts') && rel.startsWith(dir), deadOk: {},
    modules: { 'node:fs': ['lstatSync', 'readFileSync', 'openSync', 'constants'], 'node:path': '*' },
  };
  const problems = checkEntries([good, ...Object.values(files)], DESKTOP, policy);
  assert.deepEqual(problems.filter(x => x.startsWith(good)), [], 'the good file is not refused');
  for (const [name, [, expected]] of Object.entries(bad)) {
    const mine = problems.filter(x => x.startsWith(files[name]!) || (name.startsWith('rel') && x.includes('writer.ts')));
    assert.ok(mine.some(x => expected.test(x)), `${name} was not refused as expected: ${mine.join(' | ') || 'no problem found'}`);
  }
});

test('the shell policy rejects bad page files: markup from text, a channel out of the page, text run as code, storage, a new window, and the real bridge named outside bridge.ts; the ordinary words of a page pass', t => {
  const dir = tempDir(t), put = (name: string, text: string): string => { const file = join(dir, name); writeFileSync(file, text); return file; };
  const good = put('good.tsx', "import { useState } from 'react';\nexport const copyText = (s: string): string => { const f = (): number => requestAnimationFrame(() => undefined); void f; return useState(s)[0] + String(link(s)) + write(s) + exec(s); };\nconst link = (s: string): number => s.length, write = (s: string): string => s, exec = (s: string): string => s;\n");
  const bad: Record<string, [string, RegExp]> = {
    inner: ["export const a = (el: HTMLElement, text: string): void => { el.innerHTML = text; };\n", /uses innerHTML/],
    outer: ["export const a2 = (el: HTMLElement, text: string): void => { el.outerHTML = text; };\n", /uses outerHTML/],
    adjacent: ["export const a3 = (el: HTMLElement, text: string): void => { el.insertAdjacentHTML('beforeend', text); };\n", /uses insertAdjacentHTML/],
    dangerous: ["import { createElement } from 'react';\nexport const b = (html: string) => createElement('div', { dangerouslySetInnerHTML: { __html: html } });\n", /uses dangerouslySetInnerHTML/],
    write: ["export const c = (html: string): void => { document.write(html); };\n", /uses document\.write/],
    fetch: ["export const d = (): Promise<unknown> => fetch('https://example.test/');\n", /uses fetch/],
    xhr: ["export const d2 = (): unknown => new XMLHttpRequest();\n", /uses XMLHttpRequest/],
    socket: ["export const d3 = (): unknown => new WebSocket('wss://example.test');\n", /uses WebSocket/],
    beacon: ["export const d4 = (): boolean => navigator.sendBeacon('https://example.test', 'x');\n", /uses sendBeacon/],
    evil: ["export const e = (text: string): unknown => eval(text);\n", /uses eval/],
    fn: ["export const e2 = (text: string): unknown => new Function(text)();\n", /uses Function/],
    storage: ["export const f = (): void => { localStorage.setItem('a', 'b'); };\n", /uses localStorage/],
    session: ["export const f2 = (): string | null => sessionStorage.getItem('a');\n", /uses sessionStorage/],
    open: ["export const g = (): unknown => window.open('https://example.test');\n", /uses window\.open/],
    bridge: ["export const h = (): unknown => (window as unknown as { bowerloomReal?: unknown }).bowerloomReal;\n", /uses bowerloomReal/],
    bridgeText: ["export const h2 = (): unknown => (window as unknown as Record<string, unknown>)['bowerloomReal'];\n", /names a banned thing|has the text "bowerloomReal"/],
    normal: ["export const i = (): unknown => (window as unknown as { bowerloom?: unknown }).bowerloom;\n", /uses window\.bowerloom/],
  };
  const files = Object.fromEntries(Object.entries(bad).map(([name, [text]]) => [name, put(`${name}.tsx`, text)]));
  const policy: Policy = { ...SHELL_POLICY, allowFile: rel => rel.startsWith(dir), tolerate: {} };
  const problems = checkEntries([good, ...Object.values(files)], DESKTOP, policy, 'esm', 'browser');
  assert.deepEqual(problems.filter(x => x.startsWith(good)), [], 'the ordinary words of a page (link, write, exec, requestAnimationFrame) are not refused');
  for (const [name, [, expected]] of Object.entries(bad)) {
    const mine = problems.filter(x => x.startsWith(files[name]!));
    assert.ok(mine.some(x => expected.test(x)), `${name} was not refused as expected: ${mine.join(' | ') || 'no problem found'}`);
  }
  // The one file that may name the real bridge is the one the policy tolerates, and only for that name.
  const bridgeOnly = checkEntries([files['bridge']!, files['inner']!], DESKTOP, { ...policy, tolerate: { [files['bridge']!]: { names: /^bowerloomReal$/, strings: /^bowerloomReal$/, why: 'test' } } }, 'esm', 'browser');
  assert.equal(bridgeOnly.some(x => x.startsWith(files['bridge']!)), false, 'the tolerated file may name the bridge');
  assert.equal(bridgeOnly.some(x => x.startsWith(files['inner']!) && /innerHTML/.test(x)), true, 'and is not excused from anything else');
});

test('the shipped-script check fails on a sink that is not listed, on a listed one at another count, and on a listed one that vanished; it passes the exact list', () => {
  const known: Record<string, BundleAllowance> = { innerHTML: { ids: 2, strings: 1, why: 'a library' }, Function: { ids: 1, strings: 0, why: 'a library' } };
  const lib = "var a = el.innerHTML; el.innerHTML = ''; var k = 'innerHTML'; var t = x instanceof Function;";
  assert.deepEqual(problemsOfShippedBundle('lib', lib, known), []);
  assert.deepEqual(problemsOfShippedBundle('lib', "var s = 'eval(innerHTML)'; // fetch, WebSocket and window.open in a string or a comment are not code\n" + lib, known), [], 'text inside a string or a comment is not a use');
  const has = (text: string, expected: RegExp): void => assert.ok(problemsOfShippedBundle('lib', text, known).some(x => expected.test(x)), `${expected} for ${text}`);
  has(`${lib} fetch('https://example.test');`, /uses fetch .*not on the list/);
  has(`${lib} new XMLHttpRequest();`, /uses XMLHttpRequest/);
  has(`${lib} new WebSocket('wss://x');`, /uses WebSocket/);
  has(`${lib} navigator.sendBeacon('u', 'd');`, /uses sendBeacon/);
  has(`${lib} eval(t);`, /uses eval/);
  has(`${lib} el.outerHTML = t;`, /uses outerHTML/);
  has(`${lib} el.insertAdjacentHTML('beforeend', t);`, /uses insertAdjacentHTML/);
  has(`${lib} document.write(t);`, /uses document\.write/);
  has(`${lib} window.open('u');`, /uses window\.open/);
  has(`${lib} localStorage.setItem('a', 'b');`, /uses localStorage/);
  has(`${lib} window.bowerloomReal.pickFolder();`, /uses bowerloomReal/);
  has(`${lib} el.innerHTML = t;`, /innerHTML is used 3 times as code and 1 as text; the list of known uses says 2 and 1/);
  has(`${lib} var y = new Function(t);`, /Function is used 2 times/);
  has("var a = el.innerHTML; var k = 'innerHTML'; var t = x instanceof Function;", /innerHTML is used 1 times as code/);
  has('var z = 1;', /innerHTML is used 0 times as code and 0 as text/);
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

test('the channels of the reader are its own: the viewer\'s channels are gone, and none of the three is shared with the engine calls', () => {
  assert.deepEqual(Object.keys(REAL_CHANNELS).sort(), ['discoverPlaces', 'pickFolder', 'readSelected']);
  assert.deepEqual([...REAL_CALLS], ['discoverPlaces', 'pickFolder', 'readSelected']);
  for (const channel of Object.values(REAL_CHANNELS)) assert.ok(!(Object.values(ENGINE_CHANNELS) as string[]).includes(channel) && !channel.startsWith('viewer:'), channel);
  assert.equal(existsSync(join(DESKTOP, 'shared', 'channels.ts')), false, 'the list of the viewer\'s 21 channels is gone');
});

test('only the app page, in real mode, may ask', () => {
  const hashes = [REAL_BASE, `${REAL_BASE}/harnesses`, ''];
  for (const hash of hashes) { assert.equal(isAllowedRealSender(true, `${APP_INDEX}${hash}`, APP_INDEX), true, hash); assert.equal(isAllowedRealSender(false, `${APP_INDEX}${hash}`, APP_INDEX), false, `not in real mode: ${hash}`); }
  for (const url of [null, 'https://github.com/x', 'file:///etc/passwd', 'app://evil/index.html', 'app://viewer/other.html', `${APP_INDEX}?q=1`, 'devtools://devtools/bundled/x.html']) assert.equal(isAllowedRealSender(true, url, APP_INDEX), false, String(url));
  assert.equal(decideNavigation(`${APP_INDEX}${REAL_BASE}`, APP_INDEX), 'allow-app');
});

// ---- the handler, run with a fake in place of Electron

type Listener = (event: RealEvent, ...args: unknown[]) => unknown;
function fakeIpc(): { handlers: Map<string, Listener>; ipc: { handle(c: string, l: Listener): void } } {
  const handlers = new Map<string, Listener>();
  return { handlers, ipc: { handle: (channel, listener) => { assert.ok(!handlers.has(channel), `${channel} registered twice`); handlers.set(channel, listener); } } };
}
const page: RealEvent = { senderFrame: { url: `${APP_INDEX}${REAL_BASE}`, parent: null } };

test('the handler refuses another page, a sub-frame, no frame, and the wrong number of arguments; it never reveals more than a short code', async t => {
  const f = buildFixture();
  t.after(() => f.cleanup());
  const { handlers, ipc } = fakeIpc();
  registerRealIpc({ ipc, appIndexUrl: APP_INDEX, home: f.home, chooseFolder: async () => f.work });
  assert.deepEqual([...handlers.keys()].sort(), Object.values(REAL_CHANNELS).sort());
  const reason = async (channel: string, event: RealEvent, ...args: unknown[]): Promise<string> => { try { await handlers.get(channel)!(event, ...args); return 'answered'; } catch (e) { return (e as Error).message; } };
  for (const channel of Object.values(REAL_CHANNELS)) {
    for (const bad of [null, { url: 'https://example.com/', parent: null }, { url: `${APP_INDEX}${REAL_BASE}`, parent: {} }, { url: 'file:///etc/hosts', parent: null }]) {
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

test('the bridge file exposes the reader\'s object with exactly three functions and the sheets\' object with one function per engine call, each sending on its own channel, and nothing generic', () => {
  const code = strip(read('preload/real-preload.ts')).replace(/^import .*$/gm, '');
  assert.equal([...code.matchAll(/exposeInMainWorld\(/g)].length, 2);
  assert.match(code, /exposeInMainWorld\('bowerloomEngine', Object\.freeze\(engine as unknown as EngineBridge\)\)/);
  assert.match(code, /for \(const call of ENGINE_CALLS\) engine\[call\] = \(\.\.\.args: unknown\[\]\) => ipcRenderer\.invoke\(ENGINE_CHANNELS\[call\], \.\.\.args\)/);
  assert.match(code, /exposeInMainWorld\('bowerloomReal', Object\.freeze\(api\)\)/);
  const start = code.indexOf('const api: RealBridge = {'), body = code.slice(start, code.indexOf('\n};', start));
  for (const call of REAL_CALLS) assert.match(body, new RegExp(`${call}: .*ipcRenderer\\.invoke\\(REAL_CHANNELS\\.${call}`), call);
  assert.equal([...body.matchAll(/^ {2}(\w+):/gm)].length, 3, 'three properties');
  assert.deepEqual([...code.matchAll(/ipcRenderer\.(\w+)/g)].map(m => m[1]), ['invoke', 'invoke', 'invoke', 'invoke']);
  assert.doesNotMatch(code, /ipcRenderer\s*[,}]|exposeInMainWorld\('[^']+',\s*ipcRenderer|require\(|process\.|\.on\(|\.send\w*\(|webFrame|shell|clipboard|remote/);
});

test('the built bridge, run with a fake Electron, exposes the reader\'s three frozen functions and the sheets\' fourteen, each sending one message and turning a refusal into a short code', async () => {
  // The bridge is built in a child process (the bundler is not bundled into the tests), in memory, from the source, with Electron left out.
  const script = "import { build } from 'esbuild'; const o = await build({ entryPoints: ['preload/real-preload.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['electron'], logLevel: 'silent' }); process.stdout.write(o.outputFiles[0].text);";
  const built = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: DESKTOP, encoding: 'utf8', timeout: 60000 });
  assert.equal(built.status, 0, built.stderr);
  const code = built.stdout;
  const sent: [string, unknown[]][] = [];
  let exposed: { name: string; api: Record<string, (...a: unknown[]) => Promise<unknown>> } | null = null;
  const all = new Map<string, Record<string, unknown>>();
  let fail: Error | null = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: never) => { all.set(name, api); if (exposed === null) exposed = { name, api }; } },
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
  // The sheets' object: one frozen function per engine call, each on its own channel, and the mode word.
  const engine = all.get('bowerloomEngine') as Record<string, unknown> & Record<EngineCall, (...a: unknown[]) => Promise<unknown>>;
  assert.ok(engine !== undefined);
  assert.equal(Object.isFrozen(engine), true);
  assert.deepEqual(Object.keys(engine).sort(), ['mode', ...ENGINE_CALLS].sort());
  assert.equal(engine.mode, 'real');
  fail = null; sent.length = 0;
  for (const call of ENGINE_CALLS) await engine[call]('folder-1');
  assert.deepEqual(sent, ENGINE_CALLS.map(call => [ENGINE_CHANNELS[call], ['folder-1']]));
  fail = new Error("Error invoking remote method 'bowerloom-engine:planRemoval': Error: UNKNOWN_FOLDER");
  await assert.rejects(engine.planRemoval('folder-1'), (e: Error) => e.message === 'UNKNOWN_FOLDER');
  fail = new Error('/Users/someone/secret exploded');
  await assert.rejects(engine.folders(), (e: Error) => e.message === 'FAILED');
});

// ---- main.ts and the launcher: the same lock for every launch

test('main.ts: the readers are registered only for the launches that plan them, the real bridge is named once, and the page and the guard are the same for every launch', () => {
  const main = strip(read('main/main.ts'));
  assert.match(main, /webPreferences\(launch\.preload === 'real' \? join\(root, 'preload-real\.cjs'\) : undefined, app\.isPackaged\)/);
  assert.equal([...main.matchAll(/preload-real\.cjs/g)].length, 1, 'the real bridge is named once');
  assert.equal([...main.matchAll(/registerRealIpc\(/g)].length, 1);
  assert.match(main, /if \(launch\.realReader\) \{[\s\S]*?registerRealIpc\(/, 'the reader handlers exist only for a launch that asks for them');
  assert.match(main, /window\.loadURL\(`\$\{indexUrl\}\$\{launch\.hash\}`\)\.catch\(startupFailed\)/);
  assert.equal([...main.matchAll(/ipcMain\.handle/g)].length, 0, 'main.ts answers no channel itself: the handlers of main/real-ipc.ts and main/engine-ipc.ts check the sender');
  assert.doesNotMatch(main, /openLink|controller/, 'main.ts opens no outside link and has no controller');
  assert.match(main, /The real setup reader needs a home folder/);
  assert.doesNotMatch(main, /real\.html/, 'every launch serves the same page');
  assert.match(main, /const url = new URL\(request\.url\), file = url\.host === APP_HOST \? resolveAppFile\(rendererDir, url\.pathname\) : null;/, 'one line picks the file, for every launch');
});

/** The policy of every page of the app, word for word: real mode loads the same page, so this is the policy of real mode too. */
const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'";

test('real mode loads the one page of the app, and that page has the strict policy it always had', () => {
  const page = read('renderer/index.html');
  assert.equal(/Content-Security-Policy" content="([^"]+)"/.exec(page)![1], PAGE_POLICY);
  assert.doesNotMatch(page, /<style|onclick|onload|javascript:/i);
  assert.deepEqual([...page.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]), ['app.js']);
  assert.equal(existsSync(join(DESKTOP, 'renderer', 'home', 'real', 'real.html')), false, 'no second page is left in the source');
  // The window of real mode gets the one page at the real address, and only the real bridge (checked in the main.ts test above).
  assert.equal(decideNavigation(`${APP_INDEX}${REAL_BASE}`, APP_INDEX), 'allow-app');
});

const sourcesUnder = (dir: string): string[] => readdirSync(join(DESKTOP, dir), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? sourcesUnder(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []));

test('the real bridge is read in one file of the page, and the screens never call anything but its three calls', () => {
  const naming = sourcesUnder('renderer').filter(file => /bowerloomReal/.test(strip(read(file))));
  assert.deepEqual(naming, ['renderer/home/real/bridge.ts'], 'only bridge.ts reads window.bowerloomReal');
  for (const file of sourcesUnder('renderer/harness/real')) {
    const calls = [...strip(read(file)).matchAll(/\b(?:calls|bridge)\.(\w+)\(/g)].map(m => m[1]!);
    assert.ok(calls.every(name => (REAL_CALLS as readonly string[]).includes(name)), `${file}: ${calls.join(',')}`);
  }
});

test('the launcher: the one mode flag is known, a real home folder is needed for the app on the person\'s own folders, and it says what it reads and writes before the window opens', async () => {
  const src = strip(read('tools/run.mjs'));
  assert.match(src, /KNOWN = new Set\(\['--sample', '--build-only'\]\)/); assert.match(src, /MODES = new Set\(\['--sample'\]\)/);
  const mod = await import(`${join(DESKTOP, 'tools', 'run.mjs')}`) as { APP_PROMISE: string; realHome(env: Record<string, string>, exists: (p: string) => boolean): string | null };
  if (process.platform !== 'win32') assert.equal(mod.realHome({ HOME: '/Users/x' }, () => true), '/Users/x');
  assert.equal(mod.realHome({ HOME: '/Users/x' }, () => false), null); assert.equal(mod.realHome({}, () => true), null); assert.equal(mod.realHome({ HOME: 'x' }, () => true), null);
  assert.match(src, /console\.log\(`\\n\$\{APP_PROMISE\}/);
  // The promise of the app on the person's own folders: the ticks are on folders, a write needs an approved plan, and every other write the app makes is named.
  const v = mod.APP_PROMISE;
  for (const fact of [/skills/, /agents/, /saved prompts/, /project instruction files/, /settings/, /hooks/, /tool entries/, /first lines of notes pages/, /config key names/, /Known key and password shapes are hidden/]) assert.match(v, fact, `reads: ${String(fact)}`);
  for (const fact of [/Writes: only a plan you approved and said yes to/, /in the folder you chose/, /private state folder of Bowerloom/, /state record of an earlier version/, /local usage log/, /no name and no path/, /BOWERLOOM_EVENT_LOG=off turns it off/, /usage summary only when you save it in the dialog/, /private temporary copy of a tidy-up report/, /removes when it closes/, /browser profile folder/, /window settings and cache/, /between starts/]) assert.match(v, fact, `writes: ${String(fact)}`);
  assert.doesNotMatch(v, /agents you tick/, 'the ticks of the app are on folders, not on skills and agents');
  assert.doesNotMatch(v, /never|no key|Writes: nothing|no changes to your files|deletes them when it closes|lasting data folder/i, 'the app writes on approval and keeps a browser profile: no read-only promise, and no claim the app does not keep');
});

test('the real page source never builds markup from text and never reaches the normal bridge', () => {
  for (const file of names('renderer/home/real', /\.tsx?$/)) {
    const code = strip(read(file));
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|dangerouslySetInnerHTML|document\.write|\beval\(|new Function\(|window\.bowerloom\b|localStorage|sessionStorage|indexedDB|\bfetch\(|XMLHttpRequest|WebSocket/, file);
  }
});
