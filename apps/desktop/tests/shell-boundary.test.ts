// The shell boundary of the desktop app (docs/v0.9/shell-map.md). Two rules hold the core and the page apart from Electron:
//  1. Only main/main.ts and preload/real-preload.ts load Electron. Everything else in main, preload, shared and renderer runs in any Node host or in any browser engine.
//  2. Only renderer/api/transport.ts reads the two bridges (`bowerloomReal` and `bowerloomEngine`) in the page, and only preload/real-preload.ts puts them there.
// A shell written in another framework then has one file of each kind to write again, and nothing else to find.
//
// The files are read with the tokenizer of the static check of the reader (tests/fixtures-real/static-check.ts), which knows strings, comments, template literals and regular
// expressions. A comment or a string that talks about Electron is not a load, and a load cannot hide in a string. Each file is read twice, as written (so a type-only import
// counts) and as plain JavaScript that esbuild makes from it (so JSX cannot confuse the tokenizer). A file that does not parse is a problem, never a clean file.
//
// Known limit: a bridge name built at run time ('bowerloom' + 'Real') or reached through an alias is not a name in the source. The runtime check of the end-to-end suite
// (scope item 3) backs this static check for that case. Scope: main, preload, shared and renderer. tools/ (build scripts) and the e2e and tests folders are not product code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DESKTOP, tempDir } from './support.js';
import { plainJs, tokenize } from './fixtures-real/static-check.js';
import type { Token } from './fixtures-real/static-check.js';

/** The folders of the product code, relative to apps/desktop. */
const FOLDERS: readonly string[] = ['main', 'preload', 'shared', 'renderer'];
/** The two files that may load Electron. */
const MAY_LOAD_ELECTRON: readonly string[] = ['main/main.ts', 'preload/real-preload.ts'];
/** The file that puts the two bridges on the window, and the one file of the page that reads them. */
const BRIDGE_DEFINER = 'preload/real-preload.ts';
const BRIDGE_READER = 'renderer/api/transport.ts';
const MAY_NAME_BRIDGES: readonly string[] = [BRIDGE_DEFINER, BRIDGE_READER];
const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** The module `electron`, a subpath of it, and the `@electron/` helper packages. */
const ELECTRON_MODULE = /^(?:node:)?electron(?:\/.*)?$|^@electron\//;
const BRIDGE_NAME = /\bbowerloom(?:Real|Engine)\b/g;
/** A declaration file (`.d.ts`, `.d.mts`) has no code, and esbuild cannot turn it into JavaScript, so it is read as written only. */
const DECLARATION_FILE = /\.d\.[mc]?ts$/;

interface Found { readonly electron: readonly string[]; readonly bridges: readonly string[]; readonly unreadable: readonly string[]; readonly parseError: string | null }

/** What one token list loads from Electron, which bridge names it holds as code or text (never in a comment), and which loads the check cannot read. */
function scanTokens(tokens: readonly Token[]): { electron: string[]; bridges: string[]; unreadable: string[] } {
  const electron: string[] = [], bridges: string[] = [], unreadable: string[] = [];
  const judge = (spec: string): void => { if (ELECTRON_MODULE.test(spec)) electron.push(spec); };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1], after = tokens[i + 2];
    if (t.type === 'id' && t.text === 'from' && next?.type === 'str') judge(next.text);
    else if (t.type === 'id' && t.text === 'import' && next?.type === 'str') judge(next.text);
    else if (t.type === 'id' && (t.text === 'import' || t.text === 'require') && next?.text === '(') {
      if (after?.type === 'str' && tokens[i + 3]?.text === ')') judge(after.text);
      else unreadable.push(`${t.text}( with a name the check cannot read`);
    } else if (t.type === 'id' && t.text === 'createRequire') unreadable.push('createRequire is used');
    if (t.type === 'id' || t.type === 'str' || t.type === 'tpl') for (const m of t.text.matchAll(BRIDGE_NAME)) bridges.push(m[0]);
  }
  return { electron, bridges, unreadable };
}

/** Reads every file two ways and merges what each way finds. One esbuild child process serves the whole set. */
function inspect(files: Readonly<Record<string, string>>): Record<string, Found> {
  const names = Object.keys(files);
  const convertible = Object.fromEntries(names.filter(name => !DECLARATION_FILE.test(name)).map(name => [name, files[name]!]));
  const plain = Object.keys(convertible).length === 0 ? {} : plainJs(convertible, DESKTOP);
  const out: Record<string, Found> = {};
  for (const name of names) {
    const converted = plain[name];
    const views = [scanTokens(tokenize(files[name]!))];
    if (converted?.js !== undefined) views.push(scanTokens(tokenize(converted.js)));
    const merge = (pick: (v: (typeof views)[number]) => string[]): string[] => [...new Set(views.flatMap(pick))].sort();
    out[name] = { electron: merge(v => v.electron), bridges: merge(v => v.bridges), unreadable: merge(v => v.unreadable), parseError: converted?.js !== undefined || DECLARATION_FILE.test(name) ? null : (converted?.error ?? 'no result') };
  }
  return out;
}

/** What is wrong with the files. An empty set is a problem: a check that read nothing proved nothing. */
function boundaryProblems(found: Readonly<Record<string, Found>>): string[] {
  const names = Object.keys(found).sort();
  if (names.length === 0) return ['no source file was read, so nothing was checked'];
  const problems: string[] = [];
  for (const name of names) {
    const f = found[name]!;
    if (f.parseError !== null) problems.push(`${name}: does not parse (${f.parseError})`);
    if (f.electron.length > 0 && !MAY_LOAD_ELECTRON.includes(name)) problems.push(`${name}: loads ${f.electron.join(', ')}; only ${MAY_LOAD_ELECTRON.join(' and ')} may load Electron`);
    if (f.bridges.length > 0 && !MAY_NAME_BRIDGES.includes(name)) problems.push(`${name}: names ${f.bridges.join(', ')}; only ${BRIDGE_READER} reads the bridges in the page`);
    for (const u of f.unreadable) problems.push(`${name}: ${u}`);
  }
  return problems;
}

/** The two lists must stay true: each allowed file still does what the list says, so a file that stopped loading Electron cannot keep a place on it. */
function staleListProblems(found: Readonly<Record<string, Found>>): string[] {
  const problems: string[] = [];
  for (const name of MAY_LOAD_ELECTRON) {
    if (found[name] === undefined) problems.push(`${name}: is on the list of Electron files and was not read`);
    else if (found[name]!.electron.length === 0) problems.push(`${name}: is on the list of Electron files and loads nothing from Electron`);
  }
  for (const name of MAY_NAME_BRIDGES) {
    const names = found[name]?.bridges;
    if (names === undefined) problems.push(`${name}: is on the list of bridge files and was not read`);
    else if (!names.includes('bowerloomReal') || !names.includes('bowerloomEngine')) problems.push(`${name}: is on the list of bridge files and does not name both bridges`);
  }
  return problems;
}

/** Every code file under the folders, by path from apps/desktop with forward slashes, and every link under them (a link is never followed). */
function readTree(base: string, folders: readonly string[]): { files: Record<string, string>; links: string[] } {
  const files: Record<string, string> = {}, links: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(join(base, dir)).sort(); } catch { return; }
    for (const name of entries) {
      const rel = `${dir}/${name}`, stat = lstatSync(join(base, rel));
      if (stat.isSymbolicLink()) links.push(rel);
      else if (stat.isDirectory()) walk(rel);
      else if (CODE_FILE.test(name)) files[rel] = readFileSync(join(base, rel), 'utf8');
    }
  };
  for (const folder of folders) walk(folder);
  return { files, links };
}

// ---------------------------------------------------------------------------------------------------------------------- the real tree

const real = readTree(DESKTOP, FOLDERS);
const realFound = inspect(real.files);

test('the scan sees the product code: every folder holds files, and the files that the two lists name are among them', () => {
  for (const folder of FOLDERS) assert.ok(Object.keys(real.files).some(name => name.startsWith(`${folder}/`)), `no file was read under ${folder}/`);
  for (const name of [...MAY_LOAD_ELECTRON, ...MAY_NAME_BRIDGES]) assert.ok(name in real.files, `${name} was not read`);
  assert.ok(Object.keys(real.files).length >= 100, 'the scan sees the whole tree and not a part of it');
});

test('only main/main.ts and preload/real-preload.ts load Electron, in any form', () => {
  const electron = Object.entries(realFound).filter(([, f]) => f.electron.length > 0).map(([name]) => name).sort();
  assert.deepEqual(electron, [...MAY_LOAD_ELECTRON].sort());
});

test('only renderer/api/transport.ts reads the bridges in the page, and only the preload defines them', () => {
  const named = Object.entries(realFound).filter(([, f]) => f.bridges.length > 0).map(([name]) => name).sort();
  assert.deepEqual(named, [...MAY_NAME_BRIDGES].sort());
});

test('no file of the product code breaks either rule, and none is a load that the check cannot read', () => {
  assert.deepEqual(boundaryProblems(realFound), []);
});

test('the two lists are not stale: each file on them still does what the list says', () => {
  assert.deepEqual(staleListProblems(realFound), []);
});

test('no link lies under main, preload, shared or renderer, because a link could point a file at a place the check does not read', () => {
  assert.deepEqual(real.links, []);
});

// ---------------------------------------------------------------------------------------------------------------------- self-tests: the check fails when it should

const BAD_ELECTRON: Record<string, string> = {
  'a static import': `import { app } from 'electron';`,
  'a type-only import': `import type { BrowserWindow } from 'electron';`,
  'a namespace import': `import * as e from "electron";`,
  'a multi-line import': `import {\n  app,\n  dialog,\n} from 'electron';`,
  'a bare import': `import 'electron';`,
  'an export-from': `export { app } from 'electron';`,
  'an export-star-from': `export * from 'electron';`,
  'a dynamic import': `export const load = async () => import('electron');`,
  'a require': `const { app } = require('electron');`,
  'a type query': `export type T = typeof import('electron');`,
  'a subpath of electron': `import x from 'electron/main';`,
  'the node prefix': `import x from 'node:electron';`,
  'a helper package of electron': `import { x } from '@electron/remote';`,
  'a computed dynamic import': `export const load = (name: string) => import(name);`,
  'a template dynamic import': 'export const load = () => import(`electron`);',
  'a computed require': `declare const name: string; export const x = require(name);`,
  'createRequire': `import { createRequire } from 'node:module'; export const r = createRequire(import.meta.url);`,
};

const GOOD_ELECTRON: Record<string, string> = {
  'a plain import': `import { join } from 'node:path'; export const x = join('a', 'b');`,
  'a relative import': `import { a } from './electronic.js'; import { b } from '../../packages/electron-like/src/index.js'; export const c = a + b;`,
  'a comment that names electron': `// import { app } from 'electron';\n/* require('electron') */ export const A = 1;`,
  'a string that names electron': `export const WHERE = "import x from 'electron'"; export const B = \`from 'electron'\`;`,
  'a list that holds the word': `export const EXTERNAL = ['electron'];`,
  'a regular expression': `export const R = /from 'electron'/; export const S = /import\\('electron'\\)/;`,
  'words that hold the names of a load': `const important = 1; const requireAll = 2; const fromage = 3; export { important, requireAll, fromage };`,
  'the global Electron namespace of the types': `export const f = (c: Electron.WebContents): void => { void c; };`,
};

const BAD_BRIDGE: Record<string, string> = {
  'a property read': `export const r = (window as unknown as { bowerloomReal: object }).bowerloomReal;`,
  'the engine property': `export const m = (window as never as { bowerloomEngine: { mode: string } }).bowerloomEngine.mode;`,
  'a string key': `export const r = (window as never)['bowerloomReal'];`,
  'a template key': 'export const r = (window as never)[`bowerloomEngine`];',
  'a destructure': `declare const w: { bowerloomEngine: unknown }; export const { bowerloomEngine } = w;`,
  'a type member': `export type Found = { readonly bowerloomReal?: unknown };`,
  'a name handed to a function': `declare function expose(name: string, value: unknown): void; expose('bowerloomReal', {});`,
};

const GOOD_BRIDGE: Record<string, string> = {
  'a line comment': `// the page reads bowerloomReal through the transport\nexport const A = 1;`,
  'a block comment': `/** window.bowerloomEngine is the engine bridge. */ export const B = 2;`,
  'a longer word': `export const bowerloomRealistic = 1; export const mybowerloomEngine = 2;`,
  'another window name': `export const x = (window as never as { bowerloomExtras?: unknown }).bowerloomExtras;`,
};

/** One file for each sample, all in one scan. The file path is where a main file or a page file would sit, and is not on either list. */
function sampleProblems(samples: Readonly<Record<string, string>>, folder: 'main' | 'renderer'): Record<string, string[]> {
  const files = Object.fromEntries(Object.entries(samples).map(([name], i) => [`${folder}/sample-${i}.ts`, samples[name]!]));
  const found = inspect(files);
  return Object.fromEntries(Object.keys(samples).map((name, i) => [name, boundaryProblems({ [`${folder}/sample-${i}.ts`]: found[`${folder}/sample-${i}.ts`]! })]));
}

test('the Electron rule fails every way to load Electron, from a file that is not on the list (negative self-tests)', () => {
  const problems = sampleProblems(BAD_ELECTRON, 'main');
  assert.equal(Object.keys(problems).length, Object.keys(BAD_ELECTRON).length);
  for (const [name, found] of Object.entries(problems)) assert.notDeepEqual(found, [], name);
});

test('the Electron rule names the file and the module it found', () => {
  const [problem] = sampleProblems({ x: `import { app } from 'electron';` }, 'main').x!;
  assert.match(problem!, /^main\/sample-0\.ts: loads electron; only main\/main\.ts and preload\/real-preload\.ts may load Electron$/);
});

test('the Electron rule passes plain imports, relative imports, and text that only looks like a load (positive self-tests)', () => {
  const problems = sampleProblems(GOOD_ELECTRON, 'main');
  for (const [name, found] of Object.entries(problems)) assert.deepEqual(found, [], name);
});

test('the bridge rule fails every way to name a bridge, from a file that is not on the list (negative self-tests)', () => {
  const problems = sampleProblems(BAD_BRIDGE, 'renderer');
  for (const [name, found] of Object.entries(problems)) assert.notDeepEqual(found, [], name);
  assert.match(sampleProblems({ x: BAD_BRIDGE['a property read']! }, 'renderer').x!.join('\n'), /names bowerloomReal; only renderer\/api\/transport\.ts reads the bridges in the page/);
});

test('the bridge rule passes a comment and a longer word that only look like a bridge name (positive self-tests)', () => {
  const problems = sampleProblems(GOOD_BRIDGE, 'renderer');
  for (const [name, found] of Object.entries(problems)) assert.deepEqual(found, [], name);
});

test('the files on the lists may do their own thing, and a file with a different path may not', () => {
  const source = `import { contextBridge } from 'electron'; contextBridge.exposeInMainWorld('bowerloomReal', {}); contextBridge.exposeInMainWorld('bowerloomEngine', {});`;
  assert.deepEqual(boundaryProblems(inspect({ [BRIDGE_DEFINER]: source })), []);
  assert.deepEqual(boundaryProblems(inspect({ [BRIDGE_READER]: `export const r = (window as never as { bowerloomReal?: unknown; bowerloomEngine?: unknown }).bowerloomReal;` })), []);
  assert.notDeepEqual(boundaryProblems(inspect({ 'preload/other.ts': source })), []);
  assert.notDeepEqual(boundaryProblems(inspect({ 'renderer/api/client.ts': `export const r = (window as never as { bowerloomReal?: unknown }).bowerloomReal;` })), []);
  assert.notDeepEqual(boundaryProblems(inspect({ [BRIDGE_READER]: `import { app } from 'electron'; export const a = app;` })), [], 'the transport may name the bridges, and may not load Electron');
});

test('an empty file set fails, so a scan that finds no file cannot pass', t => {
  assert.deepEqual(boundaryProblems({}), ['no source file was read, so nothing was checked']);
  const base = tempDir(t);
  assert.deepEqual(readTree(base, FOLDERS).files, {}, 'a folder with no files, or with no folder at all, reads as empty');
  assert.notDeepEqual(boundaryProblems(inspect(readTree(base, FOLDERS).files)), []);
  mkdirSync(join(base, 'main'));
  assert.notDeepEqual(boundaryProblems(inspect(readTree(base, FOLDERS).files)), [], 'an empty folder is an empty set too');
  assert.match(staleListProblems({}).join('\n'), /was not read/, 'an empty set also fails the lists');
});

test('a stale list fails: a listed file that loads nothing from Electron, or names one bridge only, is a problem', () => {
  const quiet = inspect({ 'main/main.ts': `export const x = 1;`, 'preload/real-preload.ts': `import { contextBridge } from 'electron'; contextBridge.exposeInMainWorld('bowerloomReal', {});`, [BRIDGE_READER]: `export const y = 'bowerloomReal bowerloomEngine';` });
  const problems = staleListProblems(quiet).join('\n');
  assert.match(problems, /main\/main\.ts: is on the list of Electron files and loads nothing from Electron/);
  assert.match(problems, /preload\/real-preload\.ts: is on the list of bridge files and does not name both bridges/);
  assert.doesNotMatch(problems, /transport/);
});

test('a declaration file is read as written, and a load of Electron in one is found', () => {
  assert.deepEqual(boundaryProblems(inspect({ 'main/ok.d.mts': `export declare const A: string;\nexport const B: string;` })), []);
  assert.notDeepEqual(boundaryProblems(inspect({ 'main/bad.d.mts': `import type { App } from 'electron';\nexport const app: App;` })), []);
});

test('a source that does not parse is a problem, never a clean file', () => {
  const problems = boundaryProblems(inspect({ 'main/broken.ts': 'export const = ;' }));
  assert.match(problems.join('\n'), /main\/broken\.ts: does not parse/);
});

test('a planted violation in a tree is found by the same reader that reads the real tree, and a link is found', t => {
  const base = tempDir(t);
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), text); };
  put('main/main.ts', `import { app } from 'electron'; export const a = app;`);
  put('main/helper.ts', `import { dialog } from 'electron'; export const d = dialog;`);
  put('preload/real-preload.ts', `import { contextBridge } from 'electron'; contextBridge.exposeInMainWorld('bowerloomReal', {}); contextBridge.exposeInMainWorld('bowerloomEngine', {});`);
  put('shared/calls.ts', `export const N = 3;`);
  put('renderer/api/transport.ts', `export const t = (window as never as { bowerloomReal?: unknown; bowerloomEngine?: unknown }).bowerloomReal;`);
  put('renderer/screen.tsx', `export const Screen = () => <p>{String((window as never as { bowerloomEngine?: unknown }).bowerloomEngine)}</p>;`);
  const tree = readTree(base, FOLDERS);
  assert.deepEqual(Object.keys(tree.files).sort(), ['main/helper.ts', 'main/main.ts', 'preload/real-preload.ts', 'renderer/api/transport.ts', 'renderer/screen.tsx', 'shared/calls.ts']);
  const found = inspect(tree.files);
  assert.deepEqual(boundaryProblems(found).map(p => p.split(':')[0]), ['main/helper.ts', 'renderer/screen.tsx']);
  assert.deepEqual(staleListProblems(found), []);
  symlinkSync(join(base, 'shared/calls.ts'), join(base, 'shared/link.ts'));
  assert.deepEqual(readTree(base, FOLDERS).links, ['shared/link.ts']);
  assert.equal(Object.hasOwn(readTree(base, FOLDERS).files, 'shared/link.ts'), false, 'a link is not read as a file');
});
