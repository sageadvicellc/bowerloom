// Every file the app's own source can write, in one list. The window and the shared code write nothing. In main, two modules write a file, each in one fixed way;
// everything else the app changes goes through the packages (main/engine-service.ts), which tests/security.test.ts holds to one caller.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const WRITE = /\b(writeFileSync|writeFile|mkdirSync|mkdir|rmSync|rm|cpSync|cp|chmodSync|chmod|renameSync|rename|unlinkSync|unlink|appendFileSync|appendFile|copyFileSync|copyFile|symlinkSync|symlink|truncateSync|rmdirSync|utimesSync|createWriteStream|openSync)\s*\(/;
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function sourceFiles(dir: string): string[] { return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length), e.name).replace(/\\/g, '/')); }
const read = (file: string): string => strip(readFileSync(join(DESKTOP, file), 'utf8'));

// The guard for a file that may call openSync once, to read: it returns what is wrong, so the tests below can prove it rejects each hole.
function readOnlyOpenProblems(source: string): string[] {
  const problems: string[] = [];
  const noImport = source.replace(/import\s*\{[^}]*\}\s*from\s*['"]node:fs['"]\s*;?/g, '');
  const calls = [...noImport.matchAll(/\bopenSync\s*\(/g)];
  if (calls.length !== 1) problems.push(`${calls.length} calls of openSync, not one`);
  if ((noImport.match(/\bopenSync\b/g) ?? []).length !== calls.length) problems.push('openSync is used as a value, not only called');
  if (/\bopenSync\s+as\b/.test(source) || /\bas\s+openSync\b/.test(source)) problems.push('openSync is renamed on import');
  if (/\bimport\s+(\*\s+as\s+\w+|\w+)\s*(,\s*\{[^}]*\})?\s*from\s*['"](node:)?fs['"]/.test(source) || /\brequire\s*\(/.test(source)) problems.push('fs is imported as a whole, so openSync could be reached by a property');
  if (/['"`]openSync['"`]/.test(source)) problems.push('openSync is named in a string');
  const flag = noImport.match(/\bopenSync\s*\([^)]*?,\s*(['"`])([^'"`]*)\1/);
  if (flag !== null && flag[2] !== 'r') problems.push(`the open flag is '${flag[2]}', not 'r'`);
  if (calls.length === 1) {
    let depth = 0, end = -1;
    const open = calls[0]!.index! + calls[0]![0].length - 1;
    for (let i = open; i < noImport.length && end < 0; i++) {
      if (noImport[i] === '(') depth++;
      else if (noImport[i] === ')' && --depth === 0) end = i;
    }
    const args = end < 0 ? '' : noImport.slice(open + 1, end).replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
    if (args !== "file, 'r'") problems.push(`the arguments are (${args}), not (file, 'r')`);
  }
  return problems;
}

// The eight names the extension loader may import from node:fs (the same list as FS_ALLOWED['main/extension-loader.ts'] in tests/writers-imports.test.ts, which pins them from the import itself).
const LOADER_FS_NAMES = ['closeSync', 'fstatSync', 'lstatSync', 'openSync', 'readSync', 'readdirSync', 'realpathSync', 'statSync'];
// The full write scan, without the one name the loader may call (openSync, held by readOnlyOpenProblems above).
const WRITE_NO_OPEN = new RegExp(WRITE.source.replace('|openSync', ''));
if (WRITE_NO_OPEN.source === WRITE.source) throw new Error('the loader guard could not take openSync out of the write scan');

// The whole guard for the extension loader, on comment-stripped source: the open call is read-only (above), no other write name is called, no way round the import is used,
// and the names imported from node:fs are exactly the eight. Each problem names the rule that fired.
function loaderProblems(source: string): string[] {
  const problems = readOnlyOpenProblems(source);
  const call = WRITE_NO_OPEN.exec(source);
  if (call !== null) problems.push(`a write name is called: ${call[1]}`);
  if (/['"`](?:node:)?fs\/promises['"`]/.test(source)) problems.push('fs/promises is named');
  if (/\bimport\s*\(/.test(source)) problems.push('a dynamic import( is used');
  if (/\bgetBuiltinModule\b/.test(source)) problems.push('getBuiltinModule is used');
  const imported = new Set<string>();
  for (const m of source.matchAll(/\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"](?:node:)?fs['"]/g)) {
    if (m[1] !== undefined) continue;
    for (const part of m[2]!.split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
      if (name !== '') imported.add(name);
    }
  }
  const extra = [...imported].filter(n => !LOADER_FS_NAMES.includes(n)).sort();
  const missing = LOADER_FS_NAMES.filter(n => !imported.has(n));
  if (extra.length > 0) problems.push(`imports names from node:fs that are not allowed: ${extra.join(', ')}`);
  if (missing.length > 0) problems.push(`no longer imports: ${missing.join(', ')} (update the list here and in tests/writers-imports.test.ts)`);
  return problems;
}

test('the openSync guard accepts the one read call and rejects each way round it', () => {
  const head = "import { closeSync, openSync, readSync } from 'node:fs';\n";
  assert.deepEqual(readOnlyOpenProblems(`${head}const fd = openSync(file, 'r');`), []);
  assert.deepEqual(readOnlyOpenProblems(`${head}const fd = openSync( file ,\n  'r' );`), [], 'whitespace is allowed');
  const holes: Record<string, [string, RegExp]> = {
    'a space before the paren': [`${head}const fd = openSync (tmp, 'w');`, /the open flag is 'w', not 'r'/],
    'a second call': [`${head}openSync(file, 'r'); openSync(file, 'r');`, /2 calls of openSync, not one/],
    'no call': [`${head}readSync(1);`, /0 calls of openSync, not one/],
    'an alias value': [`${head}const o = openSync; o(p, 'w');`, /openSync is used as a value/],
    'a bare reference beside the call': [`${head}const fd = openSync(file, 'r'); list.push(openSync);`, /openSync is used as a value/],
    'a destructured name': [`${head}const { openSync: o } = fs; const fd = openSync(file, 'r'); o(p, 'w');`, /openSync is used as a value/],
    'a renamed import': ["import { openSync as o } from 'node:fs';\no(p, 'w');", /openSync is renamed on import/],
    'a namespace import': ["import * as fs from 'node:fs';\nfs.openSync(p, 'w');", /fs is imported as a whole/],
    'a require': ["const fs = require('node:fs');\nfs['openSync'](p, 'w');", /fs is imported as a whole/],
    'a write flag': [`${head}openSync(file, 'w');`, /the open flag is 'w', not 'r'/],
    'an append flag': [`${head}openSync(file, "a");`, /the open flag is 'a', not 'r'/],
    'a read-write flag': [`${head}openSync(file, 'r+');`, /the open flag is 'r\+', not 'r'/],
    'a write-plus flag': [`${head}openSync(file, 'w+');`, /the open flag is 'w\+', not 'r'/],
    'an append-plus flag': [`${head}openSync(file, 'a+');`, /the open flag is 'a\+', not 'r'/],
    'an exclusive-write flag': [`${head}openSync(file, 'wx');`, /the open flag is 'wx', not 'r'/],
    'an exclusive-append flag': [`${head}openSync(file, 'ax');`, /the open flag is 'ax', not 'r'/],
    'another path name': [`${head}openSync(other, 'r');`, /the arguments are \(other, 'r'\), not \(file, 'r'\)/],
    'a third argument': [`${head}openSync(file, 'r', 0o600);`, /the arguments are \(file, 'r', 0o600\), not \(file, 'r'\)/],
    'a numeric flag': [`${head}openSync(file, 1);`, /the arguments are \(file, 1\), not \(file, 'r'\)/],
    'a nested call in the arguments': [`${head}openSync(join(file), 'r');`, /the arguments are \(join\(file\), 'r'\), not \(file, 'r'\)/],
  };
  for (const [what, [source, rule]] of Object.entries(holes)) {
    const problems = readOnlyOpenProblems(source);
    assert.ok(problems.some(p => rule.test(p)), `${what}: expected ${rule}, got ${JSON.stringify(problems)}`);
  }
});

test('the loader guard accepts the loader\'s own shape and rejects a write name, a new import, fs/promises, a dynamic import and getBuiltinModule, each by its own rule', () => {
  const head = `import { ${LOADER_FS_NAMES.join(', ')} } from 'node:fs';\nimport { join } from 'node:path';\n`;
  const body = "const fd = openSync(file, 'r');\n";
  assert.deepEqual(loaderProblems(head + body), []);
  assert.deepEqual(loaderProblems(`import {\n  ${LOADER_FS_NAMES.join(',\n  ')},\n} from 'node:fs';\n${body}`), [], 'a multi-line import with a trailing comma is the same import');
  assert.deepEqual(loaderProblems(`import type { Stats } from 'node:fs';\n${head}${body}`), [], 'a type-only import names no member');
  const holes: Record<string, [string, string]> = {
    'an import of truncateSync': [`import { ${[...LOADER_FS_NAMES, 'truncateSync'].join(', ')} } from 'node:fs';\n${body}`, 'imports names from node:fs that are not allowed: truncateSync'],
    'an import of open from node:fs': [`import { ${[...LOADER_FS_NAMES, 'open'].join(', ')} } from 'node:fs';\n${body}`, 'imports names from node:fs that are not allowed: open'],
    'an aliased import of a new name': [`import { ${LOADER_FS_NAMES.join(', ')}, writev as harmless } from 'node:fs';\n${body}`, 'imports names from node:fs that are not allowed: writev'],
    'an import of truncateSync from fs': [`${head}import { truncateSync } from 'fs';\n${body}`, 'imports names from node:fs that are not allowed: truncateSync'],
    'an import from node:fs/promises': [`${head}import { writeFile } from 'node:fs/promises';\n${body}`, 'fs/promises is named'],
    'an import from fs/promises': [`${head}import { rm } from "fs/promises";\n${body}`, 'fs/promises is named'],
    'a dynamic import of node:fs': [`${head}${body}const fs = await import('node:fs');\n`, 'a dynamic import( is used'],
    'getBuiltinModule': [`${head}${body}const fs = process.getBuiltinModule('node:fs');\n`, 'getBuiltinModule is used'],
    'a write call of a name that is not imported': [`${head}${body}utimesSync(file, 1, 1);\n`, 'a write name is called: utimesSync'],
    'a rename call': [`${head}${body}renameSync(a, b);\n`, 'a write name is called: renameSync'],
    'a name left out of the import': [`import { ${LOADER_FS_NAMES.filter(n => n !== 'statSync').join(', ')} } from 'node:fs';\n${body}`, 'no longer imports: statSync (update the list here and in tests/writers-imports.test.ts)'],
  };
  // Each sample breaks one rule only, so that rule is the only problem reported.
  for (const [what, [source, problem]] of Object.entries(holes)) assert.deepEqual(loaderProblems(source), [problem], what);
});

test('the app\'s source writes a file in only five modules of main (the extension loader only opens a manifest for reading): the usage summary the person saves, the private copy of a tidy-up report, the undo of the empty harness an import makes, and the saved read in the private state folder', () => {
  const all = [...sourceFiles('main'), ...sourceFiles('shared'), ...sourceFiles('preload'), ...sourceFiles('renderer')];
  const writers = all.filter(f => WRITE.test(read(f)) || (/^renderer\//.test(f) && /node:fs/.test(readFileSync(join(DESKTOP, f), 'utf8')))).sort();
  assert.deepEqual(writers, ['main/diagnostics-dialogs.ts', 'main/engine-bundle-work.ts', 'main/extension-loader.ts', 'main/notes-report.ts', 'main/scan-cache.ts']);
  // The extension loader matches the scan only for its one openSync, which opens a manifest for reading: the string flag 'r', and no name that changes a file.
  const loader = read('main/extension-loader.ts');
  assert.deepEqual(loaderProblems(loader), []);
  assert.doesNotMatch(loader, /\b(writeFileSync|writeFile|mkdirSync|rmSync|renameSync|unlinkSync|copyFileSync|cpSync|symlinkSync|chmodSync|appendFileSync|createWriteStream|O_CREAT|O_WRONLY|O_RDWR|O_APPEND|O_TRUNC)\b/);
  // The work module of export and import (it runs on a worker thread): its one call that changes a file by itself is `unlinkSync`, in the undo of the empty harness it made
  // a moment before, only while the file still holds the bytes it wrote. Every other write goes through the portable file layer and the journaled save of the packages.
  const work = read('main/engine-bundle-work.ts');
  assert.equal((work.match(/\bunlinkSync\(/g) ?? []).length, 1);
  assert.match(work, /if \(placed && now !== null && now\.state\.sha256 === digest && checkAncestors\(projectDir, rel\)\.length === 0\) unlinkSync\(join\(projectDir, rel\)\)/);
  assert.doesNotMatch(work, /\b(writeFileSync|writeFile|mkdirSync|rmSync|renameSync|copyFileSync|cpSync|symlinkSync|chmodSync|appendFileSync)\b/);
  // The usage summary is the one file the person names: main writes it only to the path the native save dialog returned, for its owner only.
  const saves = read('main/diagnostics-dialogs.ts');
  assert.match(saves, /deps\.showSave\([\s\S]*\(deps\.writeFile \?\? writePrivate\)\(picked\.filePath,/, 'the summary goes only where the save dialog said');
  assert.match(saves, /writeFileSync\(path, text, \{ mode: 0o600 \}\)/, 'and a new file is for its owner only');
  assert.equal((saves.match(/writeFileSync\(/g) ?? []).length, 1, 'one write call');
  // The private copy of a tidy-up report is written only into a fresh folder main makes itself (mkdtemp, never a path from elsewhere), as one new file that
  // follows no link, and only the folders main made are removed.
  const copies = read('main/notes-report.ts');
  assert.equal((copies.match(/mkdtempSync\(/g) ?? []).length, 1);
  assert.match(copies, /const dir = mkdtempSync\(join\(root\(\), REPORT_COPY_PREFIX\)\);\s*made\.push\(dir\);/);
  assert.match(copies, /openSync\(path, constants\.O_WRONLY \| constants\.O_CREAT \| constants\.O_EXCL \| constants\.O_NOFOLLOW, 0o600\)/);
  assert.match(copies, /for \(const dir of made\.splice\(0\)\) \{\s*try \{ rmSync\(dir,/);
  assert.equal((copies.match(/rmSync\(/g) ?? []).length, 1);
  assert.doesNotMatch(copies, /\b(writeFileSync|renameSync|unlinkSync|copyFileSync|cpSync|symlinkSync|chmodSync)\b/);
  // The saved read is written only below the private state folder, in a folder that is checked not to be a link, as a new temporary file for its owner only that follows no link,
  // and is renamed over the old file. The only file it removes is the old read itself.
  const kept = read('main/scan-cache.ts');
  assert.match(kept, /export const cacheDir = \(stateRoot: string\): string => join\(stateRoot, FOLDER\)/);
  assert.match(kept, /mkdirSync\(dir, \{ recursive: true, mode: 0o700 \}\)/);
  assert.match(kept, /if \(folder\.isSymbolicLink\(\) \|\| !folder\.isDirectory\(\) \|\| \(uid !== undefined && folder\.uid !== uid\)\) return false;\s*chmodSync\(dir, 0o700\)/);
  assert.match(kept, /openSync\(temp, constants\.O_WRONLY \| constants\.O_CREAT \| constants\.O_EXCL \| constants\.O_NOFOLLOW, 0o600\)/);
  assert.match(kept, /renameSync\(temp, path\)/);
  assert.equal((kept.match(/renameSync\(/g) ?? []).length, 2, 'the new file over the old, and a folder that is not ours moved aside in the state folder');
  assert.equal((kept.match(/unlinkSync\(/g) ?? []).length, 4, 'the old read, the temporary file of a save that failed, a temporary file of ours that a crash left (named by a strict pattern, and only when old), and a link moved aside earlier');
  assert.equal((kept.match(/\brmSync\(/g) ?? []).length, 1, 'one removal of a folder: an older folder this module moved aside, inside the state folder, by an exact name');
  assert.match(kept, /const ASIDE_NAME = \/\^last-read\\\.bad\\\.\[0-9a-f\]\{12\}\$\//);
  assert.match(kept, /rmSync\(join\(deps\.stateRoot, n\), \{ recursive: true, force: true \}\)/);
  assert.match(kept, /const TEMP_NAME = \/\^last-read\\\.\\d\+\\\.\[0-9a-f\]\{12\}\\\.tmp\$\//);
  assert.doesNotMatch(kept, /\b(writeFileSync|copyFileSync|cpSync|symlinkSync|appendFileSync|rmdirSync)\b/);
  assert.doesNotMatch(kept, /homedir|process\.cwd|tmpdir/, 'no path outside the state root');
});

test('the temporary data folder of a made-up launch is made and removed in one plain module, which the launcher shares', () => {
  const writers = sourceFiles('main').filter(f => WRITE.test(read(f)));
  assert.equal(writers.includes('main/temp-data.mjs'), false, 'the module is .mjs, so the source scan above does not see it: it is held here instead');
  const text = strip(readFileSync(join(DESKTOP, 'main', 'temp-data.mjs'), 'utf8'));
  assert.equal((text.match(/mkdtempSync\(/g) ?? []).length, 1, 'one place makes a folder');
  assert.equal((text.match(/rmSync\(/g) ?? []).length, 1, 'one place removes a folder');
  assert.match(text, /if \(!hasPrefix\(basename\(dir\)\)\) return 'refused';/, 'it removes only a folder with one of its prefixes');
  assert.doesNotMatch(text, /\b(writeFileSync|renameSync|unlinkSync|copyFileSync|cpSync|symlinkSync|appendFileSync)\b/);
});

test('in packages/diagnostics only src/log.ts writes a file, and it writes only below the event log folder', () => {
  const dir = join(DESKTOP, '..', '..', 'packages', 'diagnostics', 'src');
  const writers = readdirSync(dir).filter(f => f.endsWith('.ts') && WRITE.test(strip(readFileSync(join(dir, f), 'utf8')))).sort();
  assert.deepEqual(writers, ['log.ts']);
  const log = strip(readFileSync(join(dir, 'log.ts'), 'utf8'));
  // Every path it writes is the event log folder, a file in it, or a temporary file beside the log.
  assert.match(log, /export const eventLogDir = \(stateRoot: string\): string => join\(stateRoot, 'events'\)/);
  assert.match(log, /const dir = eventLogDir\(options\.stateRoot\)/);
  assert.doesNotMatch(log, /homedir|process\.cwd|tmpdir|\.\.\//, 'no path outside the state root');
});
