// Which names of node:fs each file may import. tests/writers.test.ts reads names in the text; this file reads the import itself, so an alias (`import { writeFile as put }`),
// a namespace (`import * as fs`), a default import, a `require` and a dynamic `import()` cannot hide a writer. Each file has the exact set of fs names it imports, by the name the
// module exports (the local alias does not matter). A new name in a file, or a new file that imports fs, fails here until a person has looked at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';
import { importsOf, plainJs, tokenize } from './fixtures-real/static-check.js';

const FS_MODULE = /^(?:node:)?fs(?:\/promises)?$/;

/**
 * The names a source imports from node:fs and node:fs/promises, by exported name, and the forms that name no member (namespace, default, `export ... from`, effect import,
 * require, dynamic import, getBuiltinModule). The source is first turned into plain JavaScript, then read with the tokenizer of tests/fixtures-real/static-check.ts, which knows
 * strings, template literals, comments and regular expressions, so a word in a string or a comment neither hides an import nor makes one up.
 */
export function fsImports(js: string): { names: string[]; opaque: string[] } {
  const tokens = tokenize(js), names: string[] = [], opaque: string[] = [];
  for (const imp of importsOf(tokens)) {
    if (!FS_MODULE.test(imp.from)) continue;
    const at = tokens.find(t => t.pos === imp.pos)!, exported = at.text === 'export';
    if (!exported && imp.members.length === 0 && tokens[tokens.indexOf(at) + 1]?.type === 'str') { opaque.push('import for effects'); continue; }
    for (const member of imp.members) {
      if (member === '*') opaque.push(exported ? 'export * from' : 'import * as');
      else if (member === 'default') opaque.push(exported ? 'export default from' : 'import default');
      else names.push(member);
    }
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!, next = tokens[i + 1], arg = tokens[i + 2];
    if (t.type !== 'id') continue;
    const prev = tokens[i - 1];
    const literal = arg !== undefined && (arg.type === 'str' || arg.type === 'tpl') && FS_MODULE.test(arg.text);
    if (t.text === 'require' && next?.text === '(' && literal) opaque.push('require');
    else if (t.text === 'import' && next?.text === '(' && literal) opaque.push('import()');
    else if (t.text === 'getBuiltinModule' && prev?.text !== 'function') opaque.push('getBuiltinModule');
    else if (t.text === 'createRequire' || t.text === 'binding' && prev?.text === '.' && tokens[i - 2]?.text === 'process' || t.text === 'dlopen' && prev?.text === '.' && tokens[i - 2]?.text === 'process') opaque.push('a way around the import');
  }
  return { names: [...new Set(names)].sort(), opaque: [...new Set(opaque)] };
}

const FS_ALLOWED: Readonly<Record<string, readonly string[]>> = {
  'main/diagnostics-dialogs.ts': ['writeFileSync'],
  'main/engine-bundle-work.ts': ['lstatSync', 'readdirSync', 'unlinkSync'],
  'main/engine-bundle.ts': ['realpathSync', 'statSync'],
  'main/engine-save.ts': ['lstatSync', 'readdirSync'],
  'main/engine-service.ts': ['lstatSync', 'readFileSync', 'realpathSync'],
  'main/extension-loader.ts': ['closeSync', 'fstatSync', 'lstatSync', 'openSync', 'readSync', 'readdirSync', 'realpathSync', 'statSync'],
  'main/kit.ts': ['lstatSync', 'readFileSync', 'readdirSync'],
  'main/main.ts': ['readFile'],
  'main/notes-report.ts': ['closeSync', 'constants', 'fchmodSync', 'fstatSync', 'lstatSync', 'mkdtempSync', 'openSync', 'readSync', 'realpathSync', 'rmSync', 'writeSync'],
  'main/real-fs.ts': ['closeSync', 'constants', 'fstatSync', 'lstatSync', 'opendirSync', 'openSync', 'readSync', 'realpathSync', 'statSync'],
  'main/scan-cache.ts': ['chmodSync', 'closeSync', 'constants', 'fstatSync', 'fsyncSync', 'lstatSync', 'mkdirSync', 'openSync', 'readSync', 'readdirSync', 'renameSync', 'rmSync', 'unlinkSync', 'writeSync'],
  'main/safe.ts': ['lstatSync', 'realpathSync'],
  'main/temp-data.mjs': ['chmodSync', 'existsSync', 'lstatSync', 'mkdtempSync', 'realpathSync', 'rmSync'],
};

/** Every source file that can hold code, of any extension a bundler reads. Declaration files (`.d.ts`, `.d.mts`, `.d.cts`) hold types only, so they are left out. */
const CODE = /\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/, DECLARATION = /\.d\.(?:ts|mts|cts)$/;

function sourcesUnder(dir: string): string[] {
  return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile() && CODE.test(e.name) && !DECLARATION.test(e.name))
    .map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length + 1), e.name))
    .sort();
}

const ROOTS = ['main', 'shared', 'preload', 'renderer'];

test('each file of main, shared, preload and the page imports exactly the node:fs names listed for it, by the name the module exports', () => {
  const files = ROOTS.flatMap(sourcesUnder);
  const plain = plainJs(Object.fromEntries(files.map(file => [file, readFileSync(join(DESKTOP, file), 'utf8')])), DESKTOP);
  const found: Record<string, string[]> = {};
  for (const file of files) {
    const one = plain[file]!;
    assert.equal(one.error, undefined, `${file} does not parse, so it cannot be checked: ${one.error}`);
    const { names, opaque } = fsImports(one.js ?? '');
    assert.deepEqual(opaque, [], `${file} loads node:fs in a form that names no member`);
    if (names.length > 0) found[file] = names;
  }
  assert.deepEqual(found, Object.fromEntries(Object.entries(FS_ALLOWED).map(([file, names]) => [file, [...names].sort()])));
});

test('the files that can create, change or remove a file are the four listed, and each uses only the write names listed for it', () => {
  const WRITES = new Set(['writeFileSync', 'writeSync', 'fchmodSync', 'chmodSync', 'mkdtempSync', 'rmSync']);
  const writers = Object.entries(FS_ALLOWED).filter(([, names]) => names.some(name => WRITES.has(name))).map(([file, names]) => [file, names.filter(name => WRITES.has(name))]);
  assert.deepEqual(writers, [
    ['main/diagnostics-dialogs.ts', ['writeFileSync']],
    ['main/notes-report.ts', ['fchmodSync', 'mkdtempSync', 'rmSync', 'writeSync']],
    ['main/scan-cache.ts', ['chmodSync', 'rmSync', 'writeSync']],
    ['main/temp-data.mjs', ['chmodSync', 'mkdtempSync', 'rmSync']],
  ]);
  // openSync can create a file when it is given the right flags: the extension loader opens the string flag 'r' only (tests/extensions-loader.test.ts), only the report copy and the saved read pass O_CREAT (tests/writers.test.ts holds their flags), and the reader passes read flags only (tests/real-static.test.ts holds the flags).
  assert.deepEqual(Object.entries(FS_ALLOWED).filter(([, names]) => names.includes('openSync')).map(([file]) => file), ['main/extension-loader.ts', 'main/notes-report.ts', 'main/real-fs.ts', 'main/scan-cache.ts']);
  const reader = plainJs({ 'main/real-fs.ts': readFileSync(join(DESKTOP, 'main', 'real-fs.ts'), 'utf8') }, DESKTOP)['main/real-fs.ts']!;
  assert.equal(reader.error, undefined, reader.error);
  assert.deepEqual(tokenize(reader.js ?? '').filter(t => t.type === 'id' && /^O_(?:CREAT|WRONLY|RDWR|APPEND|TRUNC)$/.test(t.text)).map(t => t.text), [], 'the reader opens for reading only');
});

/** The same reading as the test above, on one source text: the names and the opaque forms. */
const read = (source: string, name = 'sample.ts'): { names: string[]; opaque: string[] } => {
  const one = plainJs({ [name]: source }, DESKTOP)[name]!;
  assert.equal(one.error, undefined, one.error);
  return fsImports(one.js ?? '');
};

test('the import reader sees an alias, a namespace, a default import, a require and a dynamic import', () => {
  assert.deepEqual(read("import { writeFile as put, readFileSync } from 'node:fs/promises';"), { names: ['readFileSync', 'writeFile'], opaque: [] });
  assert.deepEqual(read("import {\n  rmSync as gone,\n  type Stats,\n} from 'fs';").names, ['rmSync']);
  assert.deepEqual(read("import type { Dirent } from 'node:fs';"), { names: [], opaque: [] });
  assert.deepEqual(read("import * as fs from 'node:fs';").opaque, ['import * as']);
  assert.deepEqual(read("import fs, { lstatSync } from 'node:fs';"), { names: ['lstatSync'], opaque: ['import default'] });
  assert.deepEqual(read("const fs = require('node:fs');").opaque, ['require']);
  assert.deepEqual(read("const fs = await import('node:fs/promises');").opaque, ['import()']);
  assert.deepEqual(read("import 'node:fs';").opaque, ['import for effects']);
  assert.deepEqual(read('const r = createRequire(import.meta.url);').opaque, ['a way around the import']);
  assert.deepEqual(read("// import { writeFile } from 'node:fs'\nconst x = 1;"), { names: [], opaque: [] });
});

test('the import reader sees a re-export from node:fs and process.getBuiltinModule, and is not fooled by text', () => {
  // esbuild writes a named re-export as an import and an export, so the name reaches the list of names; the other forms stay opaque.
  assert.deepEqual(read("export { writeFileSync } from 'node:fs';"), { names: ['writeFileSync'], opaque: [] });
  assert.deepEqual(read("export { rmSync as gone } from 'fs';").names, ['rmSync']);
  assert.deepEqual(read("export * from 'node:fs';").opaque, ['export * from']);
  assert.deepEqual(read("export * from 'node:fs/promises';").opaque, ['export * from']);
  assert.deepEqual(read("export * as fs from 'node:fs';").opaque, ['import * as']);
  assert.deepEqual(read("const fs = process.getBuiltinModule('node:fs');").opaque, ['getBuiltinModule']);
  assert.deepEqual(read("const fs = process.getBuiltinModule('fs/promises'); fs.writeFile;").opaque, ['getBuiltinModule']);
  assert.deepEqual(read("const fs = require(`node:fs`);").opaque, ['require']);
  assert.deepEqual(read("export { x } from './local.js';"), { names: [], opaque: [] });
  assert.deepEqual(read("const text = \"import { writeFile } from 'node:fs'\"; const re = /require\\('fs'\\)/; // import fs from 'fs'"), { names: [], opaque: [] });
  assert.deepEqual(read("/* export * from 'node:fs' */ const t = `import * as fs from 'node:fs'`;"), { names: [], opaque: [] });
});

test('the import reader reads every extension the scan covers, and a file that does not parse is an error, never a clean file', () => {
  for (const [name, source] of [['a.js', "import { rmSync } from 'node:fs';"], ['a.cjs', "const { rmSync } = require('node:fs');"], ['a.mts', "import { rmSync } from 'node:fs'; export const n: number = 1;"], ['a.cts', "import { rmSync } from 'node:fs'; export const n: number = 1;"], ['a.jsx', "import { rmSync } from 'node:fs'; export const el = <div />;"], ['a.tsx', "import { rmSync } from 'node:fs'; export const el = <div />;"], ['a.mjs', "import { rmSync } from 'node:fs';"]] as const) {
    const r = read(source, name);
    assert.ok(r.names.includes('rmSync') || r.opaque.includes('require'), `${name}: ${JSON.stringify(r)}`);
  }
  assert.ok(plainJs({ 'broken.ts': 'import { from' }, DESKTOP)['broken.ts']!.error !== undefined);
  assert.deepEqual(sourcesUnder('main').filter(f => DECLARATION.test(f)), [], 'declaration files hold no code');
  assert.ok(ROOTS.flatMap(sourcesUnder).includes('main/temp-data.mjs'));
});
