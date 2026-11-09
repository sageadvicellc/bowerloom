// The import graph of packages/engine-api: nothing in it reaches apps/desktop, Electron, another package, or a Node module that opens a port or starts a program.
// The files are read with the tokenizer of the static check of the reader (tests/fixtures-real/static-check.ts), which knows strings, comments, template literals and
// regular expressions, so the text of a string or a comment can neither hide an import nor make one up.
//
// The source of the package (src/) is also held to the banned names of that static check: process, globalThis, eval, Function, binding, dlopen, fetch, WebSocket, Worker,
// and a banned name written as a string key. That closes the ways round an import (`process.getBuiltinModule('node:net')`, `process.binding('tcp_wrap')`, `eval`). The tests
// and scripts of the package are held to the import rules only, because they read files and compare text. A link inside the package fails the check, because a link could
// point a file of the package at a place the check does not read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { DESKTOP, tempDir } from './support.js';
import { BANNED_EXACT, BANNED_NAME, plainJs, problemsOfSource, tokenize } from './fixtures-real/static-check.js';
import type { Policy } from './fixtures-real/static-check.js';

const ROOT = join(DESKTOP, '..', '..');
const PACKAGE = 'packages/engine-api';
/** The package's tests load its compiled copy, which the root build makes here. It is the package itself. */
const BUILT = 'dist/packages/engine-api';

/** Node modules the package may not load: they open a port, reach a host, start a program or a thread, or read the app's own process. */
const BANNED_MODULES = /^(?:node:)?(?:net|http|https|http2|dgram|dns|dns\/promises|tls|child_process|worker_threads|cluster|inspector|repl|vm|wasi|module|process)$/;
/** The one exception: a test of the package may start the golden check (`make-golden.mjs --check`) as a child, to prove its exit code. The source of the package may not. */
const TEST_MAY_SPAWN = /^(?:node:)?child_process$/;

/**
 * What is wrong with the imports of one file. `file` is relative to the repository root, with forward slashes. Every way to load a module is read from the tokens:
 * `import x from`, `import 'x'`, `export ... from 'x'` (also `export type`), `import('x')`, `require('x')`, and any use of `createRequire`. A load whose name is not a plain string
 * is a problem, because the check cannot say where it goes.
 */
function importProblems(file: string, source: string): string[] {
  const tokens = tokenize(source), problems: string[] = [];
  const judge = (spec: string, how: string): void => {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      const target = spec.startsWith('/') ? spec : posix.normalize(posix.join(posix.dirname(file), spec));
      if (target.startsWith('apps/') || target.includes('/apps/') || target.includes('apps/desktop')) problems.push(`${file}: ${how} reaches apps: ${spec}`);
      else if (![PACKAGE, BUILT].some(inside => target === inside || target.startsWith(`${inside}/`))) problems.push(`${file}: ${how} leaves the package: ${spec}`);
      return;
    }
    if (/^(?:node:)?electron(?:\/.*)?$/.test(spec) || spec.startsWith('@electron/')) problems.push(`${file}: ${how} loads electron: ${spec}`);
    else if (BANNED_MODULES.test(spec) && !(TEST_MAY_SPAWN.test(spec) && file.startsWith(`${PACKAGE}/test/`))) problems.push(`${file}: ${how} loads a module that opens a port or starts a program: ${spec}`);
    else if (!spec.startsWith('node:')) problems.push(`${file}: ${how} loads a package from outside: ${spec}`);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1], after = tokens[i + 2];
    if (t.type === 'id' && t.text === 'from' && next?.type === 'str') judge(next.text, 'a static import or export-from');
    else if (t.type === 'id' && t.text === 'import' && next?.type === 'str') judge(next.text, 'a bare import');
    else if (t.type === 'id' && (t.text === 'import' || t.text === 'require') && next?.text === '(') {
      if (after?.type === 'str' && tokens[i + 3]?.text === ')') judge(after.text, t.text === 'import' ? 'a dynamic import' : 'a require');
      else problems.push(`${file}: ${t.text}( with a name the check cannot read`);
    } else if (t.type === 'id' && t.text === 'createRequire') problems.push(`${file}: createRequire is used`);
  }
  return problems;
}

/** The code files under a folder, and every link under it (a link is never followed). */
function walk(base: string, dir: string): { files: string[]; links: string[] } {
  const files: string[] = [], links: string[] = [];
  for (const name of readdirSync(join(base, dir))) {
    const rel = `${dir}/${name}`, stat = lstatSync(join(base, rel));
    if (stat.isSymbolicLink()) links.push(rel);
    else if (stat.isDirectory()) { const inner = walk(base, rel); files.push(...inner.files); links.push(...inner.links); }
    else if (/\.(?:ts|mjs|js|cjs|mts|cts)$/.test(name)) files.push(rel);
  }
  return { files: files.sort(), links: links.sort() };
}
const filesOf = (dir: string): string[] => walk(ROOT, dir).files;

/** The banned-name rules of the static check of the reader, applied to the source of the package. Nothing outside the package is allowed, so the module list is empty. */
const POLICY: Policy = { allowFile: () => true, deadOk: {}, modules: {} };

/**
 * What the banned names of the static check find in each source. The sources are plain text with a name that ends in .ts, read as TypeScript by one esbuild child process for the
 * whole set. A source that does not parse is a problem, never a clean file.
 */
function nameProblems(sources: Readonly<Record<string, string>>): Record<string, string[]> {
  const plain = plainJs(sources, DESKTOP), out: Record<string, string[]> = {};
  for (const [name, result] of Object.entries(plain)) out[name] = result.js === undefined ? [`${name}: does not parse (${result.error ?? 'no reason'})`] : problemsOfSource(name, result.js, POLICY);
  return out;
}

test('no file of packages/engine-api reaches apps/desktop, electron, a port or a program, however it loads', () => {
  const files = filesOf(PACKAGE);
  assert.ok(files.some(f => f.startsWith(`${PACKAGE}/src/`)), 'the scan sees the source');
  assert.ok(files.some(f => f.startsWith(`${PACKAGE}/test/`)) && files.some(f => f.startsWith(`${PACKAGE}/scripts/`)), 'the scan sees the tests and the scripts');
  const problems = files.flatMap(f => importProblems(f, readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(problems, []);
  assert.equal(relative(ROOT, join(ROOT, PACKAGE)).split(sep).join('/'), PACKAGE);
});

test('no source file of packages/engine-api uses a banned name or a way round an import', () => {
  const sources = Object.fromEntries(filesOf(`${PACKAGE}/src`).map(f => [f, readFileSync(join(ROOT, f), 'utf8')]));
  assert.ok(Object.keys(sources).length >= 4, 'the scan sees the source files');
  const found = nameProblems(sources);
  assert.deepEqual(Object.values(found).flat(), []);
});

test('no link lies inside packages/engine-api', () => {
  const { files, links } = walk(ROOT, PACKAGE);
  assert.ok(files.length > 0);
  assert.deepEqual(links, []);
});

test('a link inside a folder is found, whether it points at a file or a folder, and a real tree has none', t => {
  const base = tempDir(t);
  writeFileSync(join(base, 'real.ts'), 'export const A = 1;\n');
  assert.deepEqual(walk(base, '.').links, []);
  symlinkSync(join(base, 'real.ts'), join(base, 'link.ts'));
  symlinkSync(base, join(base, 'loop'));
  assert.deepEqual(walk(base, '.').links, ['./link.ts', './loop']);
  assert.deepEqual(walk(base, '.').files, ['./real.ts'], 'a link is not read as a file');
});

/** Ways round the import rules. Each is a source file on its own, and each must have a problem. */
const BYPASS: Record<string, string> = {
  'a private loader reached through node:module': `import M from 'node:module'; export const x = (M as never as { _load(n: string): unknown })._load('electron');`,
  'a built-in module reached through process': `export const x = process.getBuiltinModule('node:net');`,
  'a native binding reached through process': `export const x = process.binding('tcp_wrap');`,
  'the main module read with a string key': `export const x = process['mainModule'];`,
  'eval': `export const x = eval('1 + 1');`,
  'a Function constructor': `export const x = new Function('return 1');`,
  'fetch on globalThis': `export const x = globalThis.fetch('http://localhost:9/');`,
  'a bare fetch': `export const x = fetch('http://localhost:9/');`,
  'a WebSocket': `export const x = new WebSocket('ws://localhost:9/');`,
  'a Worker': `export const x = new Worker('w.js');`,
  'a banned name as a string key': `const o: Record<string, (a: string) => void> = {}; o['spawn']('x');`,
  'the constructor reached with a string key': `export const x = ((): unknown => 1)['constructor']('return 1');`,
  'dlopen': `export const x = dlopen;`,
};

const BAD: Record<string, string> = {
  'a static import of apps/desktop': `import { ENGINE_CALLS } from '../../../apps/desktop/shared/engine/types.js';`,
  'a static import of a type': `import type { Answer } from "../../../apps/desktop/shared/engine/types.js";`,
  'a multi-line static import': `import {\n  A,\n  B,\n} from '../../../apps/desktop/main/engine-ipc.js';`,
  'a bare import': `import '../../../apps/desktop/main/main.js';`,
  'an export-from': `export { ENGINE_CALLS } from '../../../apps/desktop/shared/engine/types.js';`,
  'an export-star-from': `export * from '../../../apps/desktop/shared/real/types.js';`,
  'an export type from': `export type { Answer } from '../../../apps/desktop/shared/engine/types.js';`,
  'a dynamic import': `const m = await import('../../../apps/desktop/shared/engine/types.js');`,
  'a dynamic import with double quotes': `const m = await import("../../../apps/desktop/main/main.js");`,
  'a require': `const m = require('../../../apps/desktop/main/main.js');`,
  'createRequire': `import { createRequire } from 'node:module'; const r = createRequire(import.meta.url);`,
  'electron': `import { app } from 'electron';`,
  'electron with the node prefix': `import { app } from 'node:electron';`,
  'an electron subpath': `import x from 'electron/main';`,
  'a require of electron': `const { app } = require('electron');`,
  'a dynamic import of electron': `await import('electron');`,
  'net': `import net from 'node:net';`,
  'net without the prefix': `import net from 'net';`,
  'http': `import { createServer } from 'http';`,
  'https': `import https from 'node:https';`,
  'dgram': `import dgram from 'node:dgram';`,
  'child_process': `import { spawn } from 'node:child_process';`,
  'a computed dynamic import': `const m = await import(name);`,
  'a computed require': `const m = require('../../../' + 'apps/desktop/main/main.js');`,
  'a template dynamic import': 'const m = await import(`../../../apps/desktop/${name}.js`);',
  'a relative path out of the package': `import { x } from '../../harness-bundle/src/index.js';`,
  'a package from outside': `import { x } from 'jose';`,
  'node:module': `import { builtinModules } from 'node:module';`,
  'module without the prefix': `import Module from 'module';`,
  'node:process': `import process from 'node:process';`,
  'process without the prefix': `import { argv } from 'process';`,
  'a dynamic import of node:module': `const m = await import('node:module');`,
};
const CLEAN_SOURCE = `export interface Row { readonly name: string; readonly count: number }
export const rows: readonly Row[] = Object.freeze([{ name: 'a', count: 1 }]);
export function find(name: string): Row | undefined { return rows.find(r => r.name === name); }
// import M from 'node:module'; process.binding('x'); eval('1'); new Function('x'); globalThis.fetch('x')
export const words = "process.binding eval Function globalThis fetch";`;

const GOOD: Record<string, string> = {
  'a relative import inside the package': `import { x } from './calls.js';`,
  'a node built-in that opens nothing': `import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto';`,
  'a type import inside the package': `import type { Answer } from './types.js';`,
  'a comment that names electron': `// import { app } from 'electron';\n/* require('electron') */ export const A = 1;`,
  'a string that names apps/desktop': `export const WHERE = "import x from '../../../apps/desktop/main/main.js'"; export const B = \`from 'electron'\`;`,
  'a regular expression that names a module': `export const R = /from 'electron'/; export const S = /import\\('net'\\)/;`,
  'a word that holds the name of a load': `const important = 1; const requireAll = 2; const fromage = 3; export { important, requireAll, fromage };`,
};

test('the check fails every way to reach apps/desktop, electron, a port or a program (negative self-tests)', () => {
  for (const [name, source] of Object.entries(BAD)) {
    assert.notDeepEqual(importProblems(`${PACKAGE}/src/x.ts`, source), [], name);
  }
});

test('the check passes imports inside the package, harmless built-ins, and text that only looks like an import (positive self-tests)', () => {
  for (const [name, source] of Object.entries(GOOD)) {
    assert.deepEqual(importProblems(`${PACKAGE}/src/x.ts`, source), [], name);
  }
});

test('the banned names find every way round an import, one negative sample for each (negative self-tests)', () => {
  const found = nameProblems(Object.fromEntries(Object.values(BYPASS).map((source, i) => [`bypass-${i}.ts`, source])));
  const imports = Object.entries(BYPASS).map(([name, source], i) => [name, [...found[`bypass-${i}.ts`]!, ...importProblems(`${PACKAGE}/src/bypass-${i}.ts`, source)]] as const);
  for (const [name, problems] of imports) assert.notDeepEqual(problems, [], name);
  // Each form is caught by its own rule, not only by the module ban, so the rules do not hide behind each other.
  const own = (key: string): string[] => found[`bypass-${Object.keys(BYPASS).indexOf(key)}.ts`]!;
  assert.match(own('a built-in module reached through process').join('\n'), /process/);
  assert.match(own('a native binding reached through process').join('\n'), /binding/);
  assert.match(own('the main module read with a string key').join('\n'), /process/);
  assert.match(own('eval').join('\n'), /eval/);
  assert.match(own('a Function constructor').join('\n'), /Function/);
  assert.match(own('fetch on globalThis').join('\n'), /globalThis/);
  assert.match(own('a banned name as a string key').join('\n'), /spawn/);
  assert.match(own('the constructor reached with a string key').join('\n'), /constructor/);
});

test('the banned names pass plain source, and text that only names a banned word (positive self-test)', () => {
  const found = nameProblems({ 'clean.ts': CLEAN_SOURCE });
  assert.deepEqual(found['clean.ts'], []);
  assert.ok(BANNED_NAME.test('writeFileSync') && BANNED_EXACT.test('process'), 'the rules of the static check are the ones in force');
});

test('a source that does not parse is a problem, never a clean file', () => {
  assert.match(nameProblems({ 'broken.ts': 'export const = ;' })['broken.ts']!.join('\n'), /does not parse/);
});

test('a test of the package may start the golden check as a child, and the source of the package may not', () => {
  const spawn = `import { spawnSync } from 'node:child_process';`;
  assert.deepEqual(importProblems(`${PACKAGE}/test/golden.test.mjs`, spawn), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/src/x.ts`, spawn), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/scripts/x.mjs`, spawn), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { createServer } from 'node:http';`), []);
});

test('a relative path is judged from the folder of the file that holds it', () => {
  assert.deepEqual(importProblems(`${PACKAGE}/src/x.ts`, `import { a } from '../test/y.js';`), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/src/x.ts`, `import { a } from '../../x.js';`), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { a } from '../../../apps/cli/src/main.js';`), []);
  assert.deepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { a } from '../../../dist/packages/engine-api/src/index.js';`), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { a } from '../../../dist/packages/harness-bundle/src/index.js';`), []);
});
