// Which names of node:fs each file may import. tests/writers.test.ts reads names in the text; this file reads the import itself, so an alias (`import { writeFile as put }`),
// a namespace (`import * as fs`), a default import, a `require` and a dynamic `import()` cannot hide a writer. Each file has the exact set of fs names it imports, by the name the
// module exports (the local alias does not matter). A new name in a file, or a new file that imports fs, fails here until a person has looked at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** The names a source imports from node:fs and node:fs/promises, by exported name, and the forms that name no member (namespace, default, require, dynamic import). */
function fsImports(source: string): { names: string[]; opaque: string[] } {
  const text = strip(source), names: string[] = [], opaque: string[] = [];
  const fsModule = String.raw`['"](?:node:)?fs(?:/promises)?['"]`;
  for (const m of text.matchAll(new RegExp(String.raw`\bimport\s+(type\s+)?([^;'"]*?)\s*from\s*${fsModule}`, 'g'))) {
    if (m[1] !== undefined) continue;
    const clause = m[2]!.trim(), braces = /\{([^}]*)\}/.exec(clause);
    const outside = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (outside !== '') opaque.push(`import ${outside}`);
    if (braces !== null) {
      for (const part of braces[1]!.split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0]!.trim();
        if (name !== '' && !name.startsWith('type ')) names.push(name);
      }
    }
  }
  if (new RegExp(String.raw`\bimport\s*${fsModule}`).test(text)) opaque.push('import for effects');
  if (new RegExp(String.raw`\brequire\s*\(\s*${fsModule}`).test(text)) opaque.push('require');
  if (new RegExp(String.raw`\bimport\s*\(\s*${fsModule}`).test(text)) opaque.push('import()');
  if (/\bprocess\.binding\b|\bcreateRequire\b|\bprocess\.dlopen\b/.test(text)) opaque.push('a way around the import');
  return { names: [...new Set(names)].sort(), opaque };
}

const FS_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'main/diagnostics-dialogs.ts': ['writeFileSync'],
  'main/engine-save.ts': ['lstatSync', 'readdirSync'],
  'main/engine-service.ts': ['lstatSync', 'readFileSync', 'realpathSync'],
  'main/kit.ts': ['lstatSync', 'readFileSync', 'readdirSync'],
  'main/main.ts': ['readFile'],
  'main/notes-report.ts': ['closeSync', 'constants', 'fchmodSync', 'fstatSync', 'lstatSync', 'mkdtempSync', 'openSync', 'readSync', 'realpathSync', 'rmSync', 'writeSync'],
  'main/real-fs.ts': ['closeSync', 'constants', 'fstatSync', 'lstatSync', 'opendirSync', 'openSync', 'readSync', 'realpathSync', 'statSync'],
  'main/safe.ts': ['lstatSync', 'realpathSync'],
  'main/temp-data.mjs': ['chmodSync', 'existsSync', 'lstatSync', 'mkdtempSync', 'realpathSync', 'rmSync'],
};

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && /\.(?:tsx?|mjs)$/.test(e.name))
    .map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length + 1), e.name))
    .sort();
}

test('each file of main, shared, preload and the page imports exactly the node:fs names listed for it, by the name the module exports', () => {
  const found: Record<string, string[]> = {};
  for (const file of [...sourcesUnder('main'), ...sourcesUnder('shared'), ...sourcesUnder('preload'), ...sourcesUnder('renderer')]) {
    const { names, opaque } = fsImports(readFileSync(join(DESKTOP, file), 'utf8'));
    assert.deepEqual(opaque, [], `${file} loads node:fs in a form that names no member`);
    if (names.length > 0) found[file] = names;
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(FS_ALLOWED).map(([file, names]) => [file, [...names].sort()])));
});

test('the files that can create, change or remove a file are the three listed, and each uses only the write names listed for it', () => {
  const WRITES = new Set(['writeFileSync', 'writeSync', 'fchmodSync', 'chmodSync', 'mkdtempSync', 'rmSync']);
  const writers = Object.entries(FS_ALLOWED).filter(([, names]) => names.some(name => WRITES.has(name))).map(([file, names]) => [file, names.filter(name => WRITES.has(name))]);
  assert.deepEqual(writers, [
    ['main/diagnostics-dialogs.ts', ['writeFileSync']],
    ['main/notes-report.ts', ['fchmodSync', 'mkdtempSync', 'rmSync', 'writeSync']],
    ['main/temp-data.mjs', ['chmodSync', 'mkdtempSync', 'rmSync']],
  ]);
  // openSync can create a file when it is given the right flags: only the report copy passes O_CREAT, and the reader passes read flags only (tests/real-static.test.ts holds the flags).
  assert.deepEqual(Object.entries(FS_ALLOWED).filter(([, names]) => names.includes('openSync')).map(([file]) => file), ['main/notes-report.ts', 'main/real-fs.ts']);
  assert.doesNotMatch(strip(readFileSync(join(DESKTOP, 'main', 'real-fs.ts'), 'utf8')), /O_CREAT|O_WRONLY|O_RDWR|O_APPEND|O_TRUNC/, 'the reader opens for reading only');
});

test('the import reader sees an alias, a namespace, a default import, a require and a dynamic import', () => {
  assert.deepEqual(fsImports("import { writeFile as put, readFileSync } from 'node:fs/promises';"), { names: ['readFileSync', 'writeFile'], opaque: [] });
  assert.deepEqual(fsImports("import {\n  rmSync as gone,\n  type Stats,\n} from 'fs';").names, ['rmSync']);
  assert.deepEqual(fsImports("import type { Dirent } from 'node:fs';"), { names: [], opaque: [] });
  assert.deepEqual(fsImports("import * as fs from 'node:fs';").opaque, ['import * as fs']);
  assert.deepEqual(fsImports("import fs, { lstatSync } from 'node:fs';"), { names: ['lstatSync'], opaque: ['import fs'] });
  assert.deepEqual(fsImports("const fs = require('node:fs');").opaque, ['require']);
  assert.deepEqual(fsImports("const fs = await import('node:fs/promises');").opaque, ['import()']);
  assert.deepEqual(fsImports("import 'node:fs';").opaque, ['import for effects']);
  assert.deepEqual(fsImports('const r = createRequire(import.meta.url);').opaque, ['a way around the import']);
  assert.deepEqual(fsImports("// import { writeFile } from 'node:fs'\nconst x = 1;"), { names: [], opaque: [] });
});
