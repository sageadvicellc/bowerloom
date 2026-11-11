// The shell boundary of the desktop app (docs/v0.9/shell-map.md). Three rules keep the core and the page apart from Electron:
//  1. Only main/main.ts and preload/real-preload.ts load Electron. This holds for main, preload, shared and renderer, and for every package that those folders reach by
//     relative imports, however deep. The scan starts at the four folders and follows each relative import into packages/<name>/src until no new package appears.
//  2. Only renderer/api/transport.ts reads the four bridges (`bowerloomReal`, `bowerloomEngine`, `bowerloomLocal` and `bowerloomRuns`) in the page, and only preload/real-preload.ts puts them there.
//  3. No relative import leaves main, preload, shared, renderer and the src folders of packages. A relative import into tools, e2e, tests, another app, or a folder of a
//     package other than src is a problem.
// A shell written in another framework then has one file of each kind to write again, and nothing else to find.
//
// How the files are read: with the tokenizer of the static check of the reader (tests/fixtures-real/static-check.ts), which knows strings, comments, template literals and
// regular expressions. A comment or a string that talks about Electron is not a load. Each file is read as written (so a type-only import counts) and as plain JavaScript that
// esbuild makes from it (so JSX cannot confuse the tokenizer). A file that does not parse is a problem, never a clean file.
//
// What is covered: the folders above. A load is `import ... from`, `import 'x'`, `export ... from`, `import('x')`, `require('x')` and `x.require('x')`, for the module electron,
// its subpaths, `electron-*` packages and `@electron/*` or `@electron-*` packages. A load whose name is not a string, a `createRequire`, and a `require` that is not a call
// with a string are problems too, because the check cannot say where they go.
// What is not covered: tools/, e2e/ and tests/ (build scripts and test code), a package that only a bare package name reaches, and a name built at run time ('bowerloom' + 'Real') or
// reached through an alias. No runtime check backs this file up yet. This is a guard against accidental regressions in the source. It does not stop a person who works round it
// on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { DESKTOP, tempDir } from './support.js';
import { plainJs, tokenize } from './fixtures-real/static-check.js';
import type { Token } from './fixtures-real/static-check.js';

/** The folders of the product code, relative to apps/desktop. */
const FOLDERS: readonly string[] = ['main', 'preload', 'shared', 'renderer'];
/** The src folder of a package, as a path from apps/desktop. The scan finds these by following relative imports, so a new package is scanned when a file first imports it. */
const PACKAGE_SRC = /^\.\.\/\.\.\/packages\/([^/]+)\/src(?:\/|$)/;
const packageFolder = (name: string): string => `../../packages/${name}/src`;
/** The packages that the core imports directly today. The scan must reach each of them, or it is not reading what it claims to read. */
const DIRECT_PACKAGES: readonly string[] = ['adoption', 'contracts', 'diagnostics', 'harness-bundle', 'harness-definition', 'notes-source', 'project-context', 'project-sync', 'skill-manifest'];
/** The two files that may load Electron. */
const MAY_LOAD_ELECTRON: readonly string[] = ['main/main.ts', 'preload/real-preload.ts'];
/** The file that puts the three bridges on the window, and the one file of the page that reads them. */
const BRIDGE_DEFINER = 'preload/real-preload.ts';
const BRIDGE_READER = 'renderer/api/transport.ts';
const MAY_NAME_BRIDGES: readonly string[] = [BRIDGE_DEFINER, BRIDGE_READER];
const CODE_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** The module `electron`, its subpaths, `electron-*` wrapper packages, and `@electron/*` and `@electron-*` packages. */
const ELECTRON_MODULE = /^(?:node:)?electron(?:[-/].*)?$|^@electron[-/]/;
const BRIDGE_NAME = /\bbowerloom(?:Real|Engine|Local|Runs)\b/g;
/** A declaration file (`.d.ts`, `.d.mts`) has no code, and esbuild cannot turn it into JavaScript, so it is read as written only. */
const DECLARATION_FILE = /\.d\.[mc]?ts$/;

interface Found {
  readonly electron: readonly string[]; readonly bridges: readonly string[]; readonly unreadable: readonly string[]; readonly relative: readonly string[]; readonly parseError: string | null;
}

/** What one token list loads from Electron, which relative paths it imports, which bridge names it holds as code or text (never in a comment), and which loads the check cannot read. */
function scanTokens(tokens: readonly Token[]): { electron: string[]; bridges: string[]; unreadable: string[]; relative: string[] } {
  const electron: string[] = [], bridges: string[] = [], unreadable: string[] = [], relative: string[] = [];
  const judge = (spec: string): void => {
    if (ELECTRON_MODULE.test(spec)) electron.push(spec);
    if (spec.startsWith('.') || spec.startsWith('/')) relative.push(spec);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1], after = tokens[i + 2];
    if (t.type === 'id' && t.text === 'from' && next?.type === 'str') judge(next.text);
    else if (t.type === 'id' && t.text === 'import' && next?.type === 'str') judge(next.text);
    else if (t.type === 'id' && (t.text === 'import' || t.text === 'require') && next?.text === '(') {
      if (after?.type === 'str' && tokens[i + 3]?.text === ')') judge(after.text);
      else unreadable.push(`${t.text}( with a name the check cannot read`);
    } else if (t.type === 'id' && t.text === 'require') {
      // A `require` that is not a call, such as `const r = require`, hides every later load. A property named require (`options.require`) and an object key or a type member named require are not the loader.
      const key = next?.text === ':' || next?.text === '?';
      if (tokens[i - 1]?.text !== '.' && tokens[i - 1]?.text !== '?.' && !key) unreadable.push(`require is used other than as a call with a string`);
    } else if (t.type === 'id' && t.text === 'createRequire') unreadable.push('createRequire is used');
    if (t.type === 'id' || t.type === 'str' || t.type === 'tpl') for (const m of t.text.matchAll(BRIDGE_NAME)) bridges.push(m[0]);
  }
  return { electron, bridges, unreadable, relative };
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
    out[name] = {
      electron: merge(v => v.electron), bridges: merge(v => v.bridges), unreadable: merge(v => v.unreadable), relative: merge(v => v.relative),
      parseError: converted?.js !== undefined || DECLARATION_FILE.test(name) ? null : (converted?.error ?? 'no result'),
    };
  }
  return out;
}

/** Whether a path, from apps/desktop with forward slashes, lies in a scanned folder. */
const inScannedFolder = (path: string): boolean => FOLDERS.some(folder => path.startsWith(`${folder}/`)) || PACKAGE_SRC.test(path);
const resolveSpec = (name: string, spec: string): string => posix.normalize(posix.join(posix.dirname(name), spec));

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
    for (const spec of f.relative) {
      if (!inScannedFolder(resolveSpec(name, spec))) problems.push(`${name}: imports ${spec}, which leaves main, preload, shared, renderer and the src folders of packages`);
    }
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
    else if (!names.includes('bowerloomReal') || !names.includes('bowerloomEngine') || !names.includes('bowerloomLocal') || !names.includes('bowerloomRuns')) problems.push(`${name}: is on the list of bridge files and does not name all four bridges`);
  }
  return problems;
}

/**
 * Every code file under the folders, by path from `base` with forward slashes, and every link under them (a link is never followed). A top-level folder that does not exist
 * reads as empty, which the floors of the real test then catch. Any other read error stops the check with that error.
 */
function readTree(base: string, folders: readonly string[]): { files: Record<string, string>; links: string[] } {
  const files: Record<string, string> = {}, links: string[] = [];
  const walk = (dir: string, top: boolean): void => {
    let entries: string[];
    try { entries = readdirSync(join(base, dir)).sort(); } catch (error) {
      if (top && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const name of entries) {
      const rel = posix.join(dir, name), stat = lstatSync(join(base, rel));
      if (stat.isSymbolicLink()) links.push(rel);
      else if (stat.isDirectory()) walk(rel, false);
      else if (CODE_FILE.test(name)) files[rel] = readFileSync(join(base, rel), 'utf8');
    }
  };
  for (const folder of folders) walk(folder, true);
  return { files, links };
}

/**
 * The four folders, and every package src folder that they reach by relative imports, however deep. A package that no file imports is not read. A package that a file imports
 * and that has no src folder reads as empty, which the real test catches through its floors.
 */
function scanTree(base: string): { files: Record<string, string>; links: string[]; found: Record<string, Found>; packages: string[] } {
  const { files, links } = readTree(base, FOLDERS);
  const found = inspect(files), seen = new Set<string>();
  for (;;) {
    const next = new Set<string>();
    for (const [name, f] of Object.entries(found)) for (const spec of f.relative) { const m = PACKAGE_SRC.exec(resolveSpec(name, spec)); if (m !== null && !seen.has(m[1]!)) next.add(m[1]!); }
    if (next.size === 0) break;
    for (const name of next) seen.add(name);
    const added = readTree(base, [...next].map(packageFolder));
    Object.assign(files, added.files); links.push(...added.links); Object.assign(found, inspect(added.files));
  }
  return { files, links, found, packages: [...seen].sort() };
}

// ---------------------------------------------------------------------------------------------------------------------- the real tree

const real = scanTree(DESKTOP);
const realFound = real.found;
const countUnder = (folder: string): number => Object.keys(real.files).filter(name => name.startsWith(`${folder}/`)).length;

test('the scan sees the product code: each folder holds about as many files as it does today, and the files that the two lists name are among them', () => {
  // The counts at the time of writing are main 35, preload 1, shared 56, renderer 130. The floors sit a little below, so a scan that reads half a tree fails.
  const floors: Record<string, number> = { main: 30, preload: 1, shared: 50, renderer: 120 };
  for (const [folder, floor] of Object.entries(floors)) assert.ok(countUnder(folder) >= floor, `${folder}/ holds ${countUnder(folder)} files, below the floor of ${floor}`);
  for (const name of DIRECT_PACKAGES) assert.ok(real.packages.includes(name), `the scan did not reach packages/${name}`);
  for (const name of real.packages) assert.ok(countUnder(packageFolder(name)) >= 1, `no file was read under ${packageFolder(name)}/`);
  assert.ok(Object.keys(real.files).length >= 450, `the scan read only ${Object.keys(real.files).length} files`);
  for (const name of [...MAY_LOAD_ELECTRON, ...MAY_NAME_BRIDGES]) assert.ok(name in real.files, `${name} was not read`);
});

test('only main/main.ts and preload/real-preload.ts load Electron, in any form, in the folders and in every package that they reach', () => {
  const electron = Object.entries(realFound).filter(([, f]) => f.electron.length > 0).map(([name]) => name).sort();
  assert.deepEqual(electron, [...MAY_LOAD_ELECTRON].sort());
});

test('only renderer/api/transport.ts reads the bridges in the page, and only the preload defines them', () => {
  const named = Object.entries(realFound).filter(([, f]) => f.bridges.length > 0).map(([name]) => name).sort();
  assert.deepEqual(named, [...MAY_NAME_BRIDGES].sort());
});

test('no file breaks a rule, none is a load that the check cannot read, and no relative import leaves the folders and the package src folders', () => {
  assert.deepEqual(boundaryProblems(realFound), []);
});

test('the two lists are not stale: each file on them still does what the list says', () => {
  assert.deepEqual(staleListProblems(realFound), []);
});

test('no link lies under the scanned folders, because a link could point a file at a place the check does not read', () => {
  assert.deepEqual(real.links, []);
});

// ---------------------------------------------------------------------------------------------------------------------- self-tests: the check fails when it should

/** A sample and the problem text that it must produce. A sample that fails for another reason, such as a parse error, does not count. */
type Sample = readonly [source: string, expected: RegExp];

const BAD_ELECTRON: Record<string, Sample> = {
  'a static import': [`import { app } from 'electron';`, /loads electron;/],
  'a type-only import': [`import type { BrowserWindow } from 'electron';`, /loads electron;/],
  'a namespace import': [`import * as e from "electron";`, /loads electron;/],
  'a multi-line import': [`import {\n  app,\n  dialog,\n} from 'electron';`, /loads electron;/],
  'a bare import': [`import 'electron';`, /loads electron;/],
  'an export-from': [`export { app } from 'electron';`, /loads electron;/],
  'an export-star-from': [`export * from 'electron';`, /loads electron;/],
  'a dynamic import': [`export const load = async () => import('electron');`, /loads electron;/],
  'a require': [`const { app } = require('electron');`, /loads electron;/],
  'a require on module': [`declare const module: { require(name: string): unknown }; export const app = module.require('electron');`, /loads electron;/],
  'a type query': [`export type T = typeof import('electron');`, /loads electron;/],
  'a subpath of electron': [`import x from 'electron/main';`, /loads electron\/main;/],
  'the node prefix': [`import x from 'node:electron';`, /loads node:electron;/],
  'a helper package of electron': [`import { x } from '@electron/remote';`, /loads @electron\/remote;/],
  'a forge package of electron': [`import { x } from '@electron-forge/shared-types';`, /loads @electron-forge\/shared-types;/],
  'a wrapper package of electron': [`import Store from 'electron-store';`, /loads electron-store;/],
  'a computed dynamic import': [`export const load = (name: string) => import(name);`, /import\( with a name the check cannot read/],
  'a template dynamic import': ['export const load = () => import(`electron`);', /import\( with a name the check cannot read/],
  'a computed require': [`declare const name: string; export const x = require(name);`, /require\( with a name the check cannot read/],
  'an alias of require': [`declare const require: (name: string) => unknown; const r = require; export const x = r('electron');`, /require is used other than as a call/],
  'createRequire': [`import { createRequire } from 'node:module'; export const r = createRequire(import.meta.url);`, /createRequire is used/],
};

const GOOD_ELECTRON: Record<string, string> = {
  'a plain import': `import { join } from 'node:path'; export const x = join('a', 'b');`,
  'a relative import': `import { a } from './electronic.js'; import { b } from '../shared/electron-like.js'; export const c = a + b;`,
  'a comment that names electron': `// import { app } from 'electron';\n/* require('electron') */ export const A = 1;`,
  'a string that names electron': `export const WHERE = "import x from 'electron'"; export const B = \`from 'electron'\`;`,
  'a list that holds the word': `export const EXTERNAL = ['electron'];`,
  'a regular expression': `export const R = /from 'electron'/; export const S = /import\\('electron'\\)/;`,
  'words that hold the names of a load': `const important = 1; const requireAll = 2; const fromage = 3; export { important, requireAll, fromage };`,
  'a property named require': `export const f = (o: { require?: boolean }): boolean => o.require === true;`,
  'a package whose name starts with the same letters': `import { x } from 'electronic-parts'; export const y = x;`,
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
  'the local property': `export const l = (window as never as { bowerloomLocal: object }).bowerloomLocal;`,
  'the local name as a string key': `export const l = (window as never)['bowerloomLocal'];`,
  'the runs property': `export const r = (window as never as { bowerloomRuns: object }).bowerloomRuns;`,
  'the runs name as a string key': `export const r = (window as never)['bowerloomRuns'];`,
};

const GOOD_BRIDGE: Record<string, string> = {
  'a line comment': `// the page reads bowerloomReal through the transport\nexport const A = 1;`,
  'a block comment': `/** window.bowerloomEngine is the engine bridge. */ export const B = 2;`,
  'a longer word': `export const bowerloomRealistic = 1; export const mybowerloomEngine = 2; export const bowerloomLocalised = 3;`,
  'another window name': `export const x = (window as never as { bowerloomExtras?: unknown }).bowerloomExtras;`,
};

/** Relative imports from main/sample.ts. The first five leave the folders, and the rest stay inside. */
const BAD_LEAVE: Record<string, string> = {
  'the tools folder': `import { x } from '../tools/made-up-home.js';`,
  'a package folder other than src': `import { x } from '../../../packages/fidelity/test/helper.js';`,
  'another app': `import { x } from '../../cli/src/main.js';`,
  'the tests folder': `import { x } from '../tests/support.js';`,
  'an export-from out of the folders': `export { x } from '../e2e/hidden.js';`,
};
const GOOD_LEAVE: Record<string, string> = {
  'a sibling file': `import { x } from './launch.js';`,
  'another scanned folder': `import { x } from '../shared/api/calls.js';`,
  'a package src folder': `import { x } from '../../../packages/adoption/src/index.js';`,
  'another package src folder': `import { x } from '../../../packages/engine-api/src/index.js';`,
};

/** One file for each sample, all in one scan. The file path is where a main file or a page file would sit, and is on neither list. */
function sampleProblems(samples: Readonly<Record<string, string>>, folder: 'main' | 'renderer'): Record<string, string[]> {
  const files = Object.fromEntries(Object.keys(samples).map((name, i) => [`${folder}/sample-${i}.ts`, samples[name]!]));
  const found = inspect(files);
  return Object.fromEntries(Object.keys(samples).map((name, i) => [name, boundaryProblems({ [`${folder}/sample-${i}.ts`]: found[`${folder}/sample-${i}.ts`]! })]));
}

function assertCaught(problems: readonly string[], expected: RegExp, name: string): void {
  assert.ok(problems.some(p => expected.test(p)), `${name}: no problem matches ${String(expected)}. Problems: ${JSON.stringify(problems)}`);
  assert.ok(!problems.some(p => /does not parse/.test(p)), `${name}: the sample does not parse, so it proves nothing. Problems: ${JSON.stringify(problems)}`);
}

test('the Electron rule fails every way to load Electron, and each failure names the load (negative self-tests)', () => {
  const problems = sampleProblems(Object.fromEntries(Object.entries(BAD_ELECTRON).map(([name, [source]]) => [name, source])), 'main');
  assert.equal(Object.keys(problems).length, Object.keys(BAD_ELECTRON).length);
  for (const [name, [, expected]] of Object.entries(BAD_ELECTRON)) assertCaught(problems[name]!, expected, name);
});

test('the Electron rule names the file and the module it found', () => {
  const [problem] = sampleProblems({ x: `import { app } from 'electron';` }, 'main').x!;
  assert.match(problem!, /^main\/sample-0\.ts: loads electron; only main\/main\.ts and preload\/real-preload\.ts may load Electron$/);
});

test('the Electron rule passes plain imports, relative imports, and text that only looks like a load (positive self-tests)', () => {
  const problems = sampleProblems(GOOD_ELECTRON, 'main');
  for (const [name, found] of Object.entries(problems)) assert.deepEqual(found, [], name);
});

test('the bridge rule fails every way to name a bridge, and each failure names the bridge (negative self-tests)', () => {
  const problems = sampleProblems(BAD_BRIDGE, 'renderer');
  for (const [name, found] of Object.entries(problems)) assertCaught(found, /names bowerloom(?:Real|Engine|Local|Runs); only renderer\/api\/transport\.ts reads the bridges in the page/, name);
});

test('the bridge rule passes a comment and a longer word that only look like a bridge name (positive self-tests)', () => {
  const problems = sampleProblems(GOOD_BRIDGE, 'renderer');
  for (const [name, found] of Object.entries(problems)) assert.deepEqual(found, [], name);
});

test('an import that leaves the folders and the package src folders fails, and the ones that stay inside pass', () => {
  for (const [name, found] of Object.entries(sampleProblems(BAD_LEAVE, 'main'))) assertCaught(found, /which leaves main, preload, shared, renderer and the src folders of packages/, name);
  for (const [name, found] of Object.entries(sampleProblems(GOOD_LEAVE, 'main'))) assert.deepEqual(found, [], name);
  assert.deepEqual(boundaryProblems(inspect({ '../../packages/adoption/src/x.ts': `import { a } from '../../project-sync/src/index.js';` })), [], 'a package may import the src folder of another package');
  assertCaught(boundaryProblems(inspect({ '../../packages/adoption/src/x.ts': `import { a } from '../../../apps/cli/src/main.js';` })), /which leaves main, preload/, 'a package that imports an app');
  assertCaught(boundaryProblems(inspect({ '../../packages/adoption/src/x.ts': `import { app } from 'electron';` })), /loads electron;/, 'a package that loads Electron');
});

test('the files on the lists do their own thing, and a file with a different path may not', () => {
  const source = `import { contextBridge } from 'electron'; contextBridge.exposeInMainWorld('bowerloomReal', {}); contextBridge.exposeInMainWorld('bowerloomEngine', {});`;
  assert.deepEqual(boundaryProblems(inspect({ [BRIDGE_DEFINER]: source })), []);
  assert.deepEqual(boundaryProblems(inspect({ [BRIDGE_READER]: `export const r = (window as never as { bowerloomReal?: unknown; bowerloomEngine?: unknown }).bowerloomReal;` })), []);
  assertCaught(boundaryProblems(inspect({ 'preload/other.ts': source })), /loads electron;/, 'another preload file');
  assertCaught(boundaryProblems(inspect({ 'renderer/api/client.ts': `export const r = (window as never as { bowerloomReal?: unknown }).bowerloomReal;` })), /names bowerloomReal;/, 'the client');
  assertCaught(boundaryProblems(inspect({ [BRIDGE_READER]: `import { app } from 'electron'; export const a = app;` })), /loads electron;/, 'the transport may name the bridges and may not load Electron');
});

test('an empty file set fails, so a scan that finds no file cannot pass', t => {
  assert.deepEqual(boundaryProblems({}), ['no source file was read, so nothing was checked']);
  const base = tempDir(t);
  assert.deepEqual(readTree(base, FOLDERS).files, {}, 'a top-level folder that does not exist reads as empty');
  assert.notDeepEqual(boundaryProblems(inspect(readTree(base, FOLDERS).files)), []);
  mkdirSync(join(base, 'main'));
  assert.notDeepEqual(boundaryProblems(inspect(readTree(base, FOLDERS).files)), [], 'an empty folder is an empty set too');
  assert.match(staleListProblems({}).join('\n'), /was not read/, 'an empty set also fails the lists');
});

test('a read error other than a missing top-level folder stops the check, and a file where a folder should be does too', t => {
  const base = tempDir(t);
  writeFileSync(join(base, 'main'), 'not a folder');
  assert.throws(() => readTree(base, ['main']), /ENOTDIR/);
  mkdirSync(join(base, 'preload'));
  symlinkSync(join(base, 'nowhere'), join(base, 'preload', 'dangling.ts'));
  assert.deepEqual(readTree(base, ['preload']).links, ['preload/dangling.ts'], 'a dangling link is listed and never read');
});

test('a stale list fails: a listed file that loads nothing from Electron, or names one bridge only, is a problem', () => {
  const quiet = inspect({ 'main/main.ts': `export const x = 1;`, 'preload/real-preload.ts': `import { contextBridge } from 'electron'; contextBridge.exposeInMainWorld('bowerloomReal', {});`, [BRIDGE_READER]: `export const y = 'bowerloomReal bowerloomEngine bowerloomLocal bowerloomRuns';` });
  const problems = staleListProblems(quiet).join('\n');
  assert.match(problems, /main\/main\.ts: is on the list of Electron files and loads nothing from Electron/);
  assert.match(problems, /preload\/real-preload\.ts: is on the list of bridge files and does not name all four bridges/);
  assert.doesNotMatch(problems, /transport/);
});

test('a declaration file is read as written, and a load of Electron in one is found', () => {
  assert.deepEqual(boundaryProblems(inspect({ 'main/ok.d.mts': `export declare const A: string;\nexport const B: string;` })), []);
  assertCaught(boundaryProblems(inspect({ 'main/bad.d.mts': `import type { App } from 'electron';\nexport const app: App;` })), /loads electron;/, 'a declaration file');
});

test('a source that does not parse is a problem, never a clean file', () => {
  const problems = boundaryProblems(inspect({ 'main/broken.ts': 'export const = ;' }));
  assert.match(problems.join('\n'), /main\/broken\.ts: does not parse/);
});

test('a planted violation is found in a file of every extension that the scan reads, by the reader that reads the real tree', t => {
  const planted: Record<string, string> = {
    'main/planted.ts': `import { app } from 'electron'; export const a = app;`,
    'main/planted.tsx': `import { app } from 'electron'; export const A = () => <p>{String(app)}</p>;`,
    'main/planted.js': `const { app } = require('electron'); module.exports = app;`,
    'main/planted.jsx': `import { app } from 'electron'; export const A = () => <p>{String(app)}</p>;`,
    'main/planted.cjs': `const { app } = require('electron'); module.exports = app;`,
    'main/planted.mjs': `import { app } from 'electron'; export const a = app;`,
    'main/planted.mts': `import { app } from 'electron'; export const a: unknown = app;`,
    'main/planted.cts': `const { app } = require('electron'); export const a: unknown = app;`,
  };
  const base = tempDir(t);
  for (const [rel, text] of Object.entries(planted)) { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), text); }
  const tree = readTree(base, FOLDERS);
  assert.deepEqual(Object.keys(tree.files).sort(), Object.keys(planted).sort(), 'every extension is read');
  const problems = boundaryProblems(inspect(tree.files));
  for (const rel of Object.keys(planted)) assert.ok(problems.some(p => p.startsWith(`${rel}: loads electron;`)), `${rel} was not found. Problems: ${JSON.stringify(problems)}`);
  assert.ok(!problems.some(p => /does not parse/.test(p)), `a planted file does not parse: ${JSON.stringify(problems)}`);
});

test('the scan follows relative imports into packages, however deep, and finds a load of Electron there', t => {
  const base = tempDir(t), desktop = join(base, 'apps', 'desktop');
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(desktop, rel)), { recursive: true }); writeFileSync(join(desktop, rel), text); };
  put('main/main.ts', `import { a } from '../../../packages/one/src/index.js'; export const x = a;`);
  put('../../packages/one/src/index.ts', `import { b } from '../../two/src/index.js'; export const a = b;`);
  put('../../packages/two/src/index.ts', `import { c } from './deep/c.js'; export const b = c;`);
  put('../../packages/two/src/deep/c.ts', `import { app } from 'electron'; export const c = app;`);
  put('../../packages/unreached/src/index.ts', `import { app } from 'electron'; export const u = app;`);
  const tree = scanTree(desktop);
  assert.deepEqual(tree.packages, ['one', 'two']);
  assert.ok(!('../../packages/unreached/src/index.ts' in tree.files), 'a package that no file imports is not read');
  assertCaught(boundaryProblems(tree.found), /^\.\.\/\.\.\/packages\/two\/src\/deep\/c\.ts: loads electron;/, 'a deep package file');
});

test('a planted violation in a tree is found by the same reader that reads the real tree, and a link is found', t => {
  const base = tempDir(t);
  const put = (rel: string, text: string): void => { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), text); };
  put('main/main.ts', `import { app } from 'electron'; export const a = app;`);
  put('main/helper.ts', `import { dialog } from 'electron'; export const d = dialog;`);
  put('preload/real-preload.ts', `import { contextBridge } from 'electron'; contextBridge.exposeInMainWorld('bowerloomReal', {}); contextBridge.exposeInMainWorld('bowerloomEngine', {}); contextBridge.exposeInMainWorld('bowerloomLocal', {}); contextBridge.exposeInMainWorld('bowerloomRuns', {});`);
  put('shared/calls.ts', `export const N = 3;`);
  put('renderer/api/transport.ts', `export const t = (window as never as { bowerloomReal?: unknown; bowerloomEngine?: unknown; bowerloomLocal?: unknown; bowerloomRuns?: unknown }).bowerloomReal;`);
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
