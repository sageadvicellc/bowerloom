// The write boundary: where the viewer may write, and everything it refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as boundaryModule from '../main/boundary.js';
import { BoundaryError, assertAppWritable } from '../main/boundary.js';
import { DESKTOP, tempDir } from './support.js';

const refused = (code: string) => (e: unknown) => e instanceof BoundaryError && e.code === code;

test('nothing exported can widen the allowed folder: the module offers one checker and the error type', () => {
  assert.deepEqual(Object.keys(boundaryModule).sort(), ['BoundaryError', 'assertAppWritable']);
  const sources = ['main/controller.ts', 'main/main.ts', 'preload/preload.ts', 'shared/channels.ts'].map(f => readFileSync(join(DESKTOP, f), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /widenWriteRoots|writeRoots/, 'no message from the window and no setting reaches the allow-list');
});

test('"..", encoded "..", doubly encoded "..", NUL, relative paths and odd types are refused', t => {
  const app = tempDir(t);
  for (const bad of [`${app}/../x`, `${app}/a/../../x`, `${app}/%2e%2e/x`, `${app}/%2E%2E/x`, `${app}/%252e%252e/x`, `${app}/a%2f..%2fx`, `${app}/x\0y`, 'relative/path', '', `${app}/%zz`, 42, null, undefined, {}, [app], 'a'.repeat(5000)]) assert.throws(() => assertAppWritable(app, bad), (e: unknown) => e instanceof BoundaryError, String(bad).slice(0, 40));
  assert.throws(() => assertAppWritable(app, `${app}/%2e%2e/x`), refused('TRAVERSAL'));
  mkdirSync(join(app, 'ok')); assert.equal(assertAppWritable(app, join(app, 'ok', 'new', 'deep', 'x')), join(app, 'ok', 'new', 'deep', 'x'));
});

test('the viewer\'s own files: inside its own folder, never through a link, never with ".."', t => {
  const app = tempDir(t); mkdirSync(join(app, 'sketches')); const outside = tempDir(t); symlinkSync(outside, join(app, 'linked'));
  assert.equal(assertAppWritable(app, join(app, 'viewer-settings.json')), join(app, 'viewer-settings.json')); assert.equal(assertAppWritable(app, join(app, 'sketches', 'a.json')), join(app, 'sketches', 'a.json'));
  for (const bad of [join(app, '..', 'x'), `${app}/%2e%2e/x`, outside, join(app, 'linked', 'x'), `${app}-evil/x`, 'relative', app.slice(0, -1)]) assert.throws(() => assertAppWritable(app, bad), (e: unknown) => e instanceof BoundaryError, bad);
  const linkedApp = join(tempDir(t), 'app-link'); symlinkSync(app, linkedApp); assert.throws(() => assertAppWritable(linkedApp, join(linkedApp, 'f')), refused('LINK'));
});

// Every write the viewer can make, in one list. A file outside the list that writes, or a listed file that does not ask the boundary first, fails.
const WRITE = /\b(writeFileSync|writeFile|mkdirSync|mkdir|rmSync|rm|cpSync|cp|chmodSync|chmod|renameSync|rename|unlinkSync|unlink|appendFileSync|appendFile|copyFileSync|copyFile|symlinkSync|symlink|truncateSync|rmdirSync|utimesSync|createWriteStream|openSync)\s*\(/;
const WRITERS: Record<string, RegExp> = { 'main/config.ts': /assertAppWritable\(/, 'main/sample.ts': /assertAppWritable\(/ };
const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
function sourceFiles(dir: string): string[] { return readdirSync(join(DESKTOP, dir), { recursive: true, withFileTypes: true }).filter(e => e.isFile() && /\.tsx?$/.test(e.name)).map(e => join(dir, (e as unknown as { parentPath: string }).parentPath.slice(join(DESKTOP, dir).length), e.name).replace(/\\/g, '/')); }

test('the viewer\'s source writes a file in only a short list of modules, and each asks the boundary first', () => {
  const all = [...sourceFiles('main'), ...sourceFiles('shared'), ...sourceFiles('preload'), ...sourceFiles('renderer')];
  const writers = all.filter(f => WRITE.test(strip(readFileSync(join(DESKTOP, f), 'utf8'))) || (/^renderer\//.test(f) && /node:fs/.test(readFileSync(join(DESKTOP, f), 'utf8')))).sort();
  // The usage summary is the one file the person names: main writes it only to the path the native save dialog returned, for its owner only.
  const allowed = Object.keys(WRITERS).concat(['main/sketches.ts', 'main/diagnostics-dialogs.ts', 'main/notes-report.ts']);
  for (const w of writers) assert.ok(allowed.includes(w), `${w} writes a file but is not in the list`);
  for (const [file, need] of Object.entries(WRITERS)) assert.match(strip(readFileSync(join(DESKTOP, file), 'utf8')), need, `${file} must ask the boundary before it writes`);
  assert.match(strip(readFileSync(join(DESKTOP, 'main/sketches.ts'), 'utf8')), /assertAppWritable\(/, 'main/sketches.ts');
  const saves = strip(readFileSync(join(DESKTOP, 'main/diagnostics-dialogs.ts'), 'utf8'));
  assert.match(saves, /deps\.showSave\([\s\S]*\(deps\.writeFile \?\? writePrivate\)\(picked\.filePath,/, 'the summary goes only where the save dialog said');
  assert.match(saves, /writeFileSync\(path, text, \{ mode: 0o600 \}\)/, 'and a new file is for its owner only');
  assert.equal((saves.match(/writeFileSync\(/g) ?? []).length, 1, 'one write call');
  assert.equal(all.some(f => f.startsWith('main/boundary')), true);
  // The private copy of a tidy-up report is written only into a fresh folder main makes itself (mkdtemp, never a path from elsewhere), as one new file that
  // follows no link, and only the folders main made are removed.
  const copies = strip(readFileSync(join(DESKTOP, 'main/notes-report.ts'), 'utf8'));
  assert.equal((copies.match(/mkdtempSync\(/g) ?? []).length, 1);
  assert.match(copies, /const dir = mkdtempSync\(join\(root\(\), REPORT_COPY_PREFIX\)\);\s*made\.push\(dir\);/);
  assert.match(copies, /openSync\(path, constants\.O_WRONLY \| constants\.O_CREAT \| constants\.O_EXCL \| constants\.O_NOFOLLOW, 0o600\)/);
  assert.match(copies, /for \(const dir of made\.splice\(0\)\) \{\s*try \{ rmSync\(dir,/);
  assert.equal((copies.match(/rmSync\(/g) ?? []).length, 1);
  assert.doesNotMatch(copies, /\b(writeFileSync|renameSync|unlinkSync|copyFileSync|cpSync|symlinkSync|chmodSync)\b/);
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
