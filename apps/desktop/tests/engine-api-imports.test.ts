// The import graph of packages/engine-api: nothing in it reaches apps/desktop, Electron, another package, or a Node module that opens a port or starts a program.
// The files are read with the tokenizer of the static check of the reader (tests/fixtures-real/static-check.ts), which knows strings, comments, template literals and
// regular expressions, so the text of a string or a comment can neither hide an import nor make one up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { DESKTOP } from './support.js';
import { tokenize } from './fixtures-real/static-check.js';

const ROOT = join(DESKTOP, '..', '..');
const PACKAGE = 'packages/engine-api';
/** The package's tests load its compiled copy, which the root build makes here. It is the package itself. */
const BUILT = 'dist/packages/engine-api';

/** Node modules the package may not load: they open a port, reach a host, start a program or a thread, or read the app's own process. */
const BANNED_MODULES = /^(?:node:)?(?:net|http|https|http2|dgram|dns|dns\/promises|tls|child_process|worker_threads|cluster|inspector|repl|vm|wasi)$/;

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
    else if (BANNED_MODULES.test(spec)) problems.push(`${file}: ${how} loads a module that opens a port or starts a program: ${spec}`);
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

function filesOf(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...filesOf(rel));
    else if (/\.(?:ts|mjs|js|cjs|mts|cts)$/.test(name)) out.push(rel);
  }
  return out.sort();
}

test('no file of packages/engine-api reaches apps/desktop, electron, a port or a program, however it loads', () => {
  const files = filesOf(PACKAGE);
  assert.ok(files.some(f => f.startsWith(`${PACKAGE}/src/`)), 'the scan sees the source');
  assert.ok(files.some(f => f.startsWith(`${PACKAGE}/test/`)) && files.some(f => f.startsWith(`${PACKAGE}/scripts/`)), 'the scan sees the tests and the scripts');
  const problems = files.flatMap(f => importProblems(f, readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(problems, []);
  assert.equal(relative(ROOT, join(ROOT, PACKAGE)).split(sep).join('/'), PACKAGE);
});

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
};
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

test('a relative path is judged from the folder of the file that holds it', () => {
  assert.deepEqual(importProblems(`${PACKAGE}/src/x.ts`, `import { a } from '../test/y.js';`), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/src/x.ts`, `import { a } from '../../x.js';`), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { a } from '../../../apps/cli/src/main.js';`), []);
  assert.deepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { a } from '../../../dist/packages/engine-api/src/index.js';`), []);
  assert.notDeepEqual(importProblems(`${PACKAGE}/test/x.mjs`, `import { a } from '../../../dist/packages/harness-bundle/src/index.js';`), []);
});
