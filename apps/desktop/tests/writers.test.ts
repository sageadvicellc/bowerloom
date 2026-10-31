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

test('the app\'s source writes a file in only two modules of main: the usage summary the person saves, and the private copy of a tidy-up report', () => {
  const all = [...sourceFiles('main'), ...sourceFiles('shared'), ...sourceFiles('preload'), ...sourceFiles('renderer')];
  const writers = all.filter(f => WRITE.test(read(f)) || (/^renderer\//.test(f) && /node:fs/.test(readFileSync(join(DESKTOP, f), 'utf8')))).sort();
  assert.deepEqual(writers, ['main/diagnostics-dialogs.ts', 'main/notes-report.ts']);
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
