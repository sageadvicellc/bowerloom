// The write boundary: where the viewer may write, and everything it refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import * as boundaryModule from '../main/boundary.js';
import { BoundaryError, SENTINEL_NAME, SENTINEL_TEXT, assertAppWritable, createBoundary, widenWriteRoots } from '../main/boundary.js';
import { DESKTOP, tempDir } from './support.js';
import type { TestContext } from 'node:test';

function sandbox(t: TestContext, name = 'Test Sandbox'): { root: string; home: string; b: ReturnType<typeof createBoundary> } {
  const home = tempDir(t), root = join(home, name); mkdirSync(root); writeFileSync(join(root, SENTINEL_NAME), SENTINEL_TEXT);
  return { root, home, b: createBoundary({ roots: [root], protectedPaths: [join(home, 'Real Work')], home }) };
}
const refused = (code: string) => (e: unknown) => e instanceof BoundaryError && e.code === code;

test('a path inside the sandbox may be written, existing or new; the root itself, its parent, and a folder with a longer name may not', t => {
  const { root, home, b } = sandbox(t); mkdirSync(join(root, 'a', 'b'), { recursive: true });
  assert.equal(b.assertWritable(join(root, 'a', 'b', 'file.txt')), join(root, 'a', 'b', 'file.txt')); assert.equal(b.assertWritable(join(root, 'new', 'deep', 'x')), join(root, 'new', 'deep', 'x'));
  for (const bad of [root, home, dirname(home), `${root}-evil/x`, join(home, 'Test Sandbox2', 'x'), join(home, 'Real Work', 'x'), '/etc/passwd', '/']) assert.throws(() => b.assertWritable(bad), refused('OUTSIDE'), bad);
});

test('"..", encoded "..", doubly encoded "..", NUL, relative paths and odd types are refused', t => {
  const { root, b } = sandbox(t);
  for (const bad of [`${root}/../x`, `${root}/a/../../x`, `${root}/%2e%2e/x`, `${root}/%2E%2E/x`, `${root}/%252e%252e/x`, `${root}/a%2f..%2fx`, `${root}/x\0y`, 'relative/path', '', `${root}/%zz`, 42, null, undefined, {}, [root], 'a'.repeat(5000)]) assert.throws(() => b.assertWritable(bad), (e: unknown) => e instanceof BoundaryError, String(bad));
});

test('a link anywhere below the root is refused: a link to a file, to a folder inside, or to a place outside', t => {
  const { root, home, b } = sandbox(t); const outside = join(home, 'elsewhere'); mkdirSync(outside); writeFileSync(join(outside, 'f'), 'x'); mkdirSync(join(root, 'real'));
  symlinkSync(outside, join(root, 'out-link')); symlinkSync(join(root, 'real'), join(root, 'in-link')); symlinkSync(join(outside, 'f'), join(root, 'file-link'));
  for (const bad of [join(root, 'out-link'), join(root, 'out-link', 'x'), join(root, 'in-link', 'x'), join(root, 'file-link'), join(root, 'real', '..', 'file-link')]) assert.throws(() => b.assertWritable(bad), (e: unknown) => e instanceof BoundaryError, bad);
  assert.throws(() => b.assertWritable(join(root, 'out-link', 'deeper', 'x')), refused('LINK'));
  assert.equal(b.assertWritable(join(root, 'real', 'ok')), join(root, 'real', 'ok'));
});

test('a root is refused unless it carries the viewer\'s mark, has Sandbox in its name, and is nowhere near real work', t => {
  const home = tempDir(t); mkdirSync(join(home, 'Real Work'));
  const make = (name: string, mark: string | null) => { const r = join(home, name); mkdirSync(r, { recursive: true }); if (mark !== null) writeFileSync(join(r, SENTINEL_NAME), mark); return r; };
  const check = (root: string, protectedPaths: string[] = [join(home, 'Real Work')]) => createBoundary({ roots: [root], protectedPaths, home }).checkRoot(root);
  assert.equal(typeof check(make('Good Sandbox', SENTINEL_TEXT)), 'string');
  assert.throws(() => check(make('No Mark Sandbox', null)), refused('NO_SENTINEL')); assert.throws(() => check(make('Wrong Mark Sandbox', 'something else\n')), refused('NO_SENTINEL'));
  assert.throws(() => check(make('Playground', SENTINEL_TEXT)), refused('ROOT_NAME'));
  assert.throws(() => check(join(home, 'Real Work')), refused('ROOT_NAME'));
  const real = make('Real Sandbox', SENTINEL_TEXT); mkdirSync(join(real, '.bowerloom')); assert.throws(() => check(real), refused('ROOT_IS_REAL'));
  const inReal = join(home, 'Real Work', 'Inner Sandbox'); mkdirSync(inReal); writeFileSync(join(inReal, SENTINEL_NAME), SENTINEL_TEXT); assert.throws(() => check(inReal), refused('ROOT_IS_REAL'));
  const holdsReal = make('Holder Sandbox', SENTINEL_TEXT); assert.throws(() => check(holdsReal, [join(holdsReal, 'work')]), refused('ROOT_IS_REAL').bind(null) as never);
  assert.throws(() => check(join(home, 'Gone Sandbox')), refused('NO_ROOT'));
  const linked = join(home, 'Link Sandbox'); symlinkSync(make('Target Sandbox', SENTINEL_TEXT), linked); assert.throws(() => check(linked), refused('ROOT_NOT_FOLDER'));
  const sentinelLink = make('Mark Link Sandbox', null); writeFileSync(join(home, 'mark'), SENTINEL_TEXT); symlinkSync(join(home, 'mark'), join(sentinelLink, SENTINEL_NAME)); assert.throws(() => check(sentinelLink), refused('NO_SENTINEL'));
});

test('the home folder, a folder that holds the home folder, and the top of the disk are never a sandbox', t => {
  const home = tempDir(t); writeFileSync(join(home, SENTINEL_NAME), SENTINEL_TEXT);
  assert.throws(() => createBoundary({ roots: [home], home }).checkRoot(home), refused('ROOT_TOO_BROAD'));
  const holder = tempDir(t); mkdirSync(join(holder, 'me')); writeFileSync(join(holder, SENTINEL_NAME), SENTINEL_TEXT);
  assert.throws(() => createBoundary({ roots: [holder], home: join(holder, 'me') }).checkRoot(holder), refused('ROOT_TOO_BROAD'));
  assert.throws(() => createBoundary({ roots: ['/'], home }).checkRoot('/'), (e: unknown) => e instanceof BoundaryError);
  assert.throws(() => createBoundary({ roots: [home], home }).assertWritable(join(home, 'x')), refused('ROOT_TOO_BROAD'));
});

test('a root without its mark allows no write at all, and the allowed roots cannot be changed', t => {
  const { root, b } = sandbox(t); assert.ok(Object.isFrozen(b.roots)); assert.throws(() => { (b.roots as string[]).push('/'); }, TypeError);
  const nomark = tempDir(t); const nb = createBoundary({ roots: [join(nomark, 'X Sandbox')], home: nomark }); mkdirSync(join(nomark, 'X Sandbox'));
  assert.throws(() => nb.assertWritable(join(nomark, 'X Sandbox', 'f')), refused('OUTSIDE'));
  assert.ok(root);
});

test('nothing exported can widen the allowed places, the settings file cannot, and the one stub refuses', () => {
  const names = Object.keys(boundaryModule); for (const name of names) assert.doesNotMatch(name, /^(add|set|push|register|allow|extend)\w*Root/i, name);
  assert.throws(() => widenWriteRoots(), (e: unknown) => e instanceof BoundaryError && e.code === 'NOT_IMPLEMENTED');
  const sources = ['main/controller.ts', 'main/main.ts', 'preload/preload.ts', 'shared/channels.ts'].map(f => readFileSync(join(DESKTOP, f), 'utf8')).join('\n');
  assert.doesNotMatch(sources, /widenWriteRoots|writeRoots|SANDBOX_DIR\s*=/, 'no message from the window and no setting reaches the allow-list');
  assert.match(readFileSync(join(DESKTOP, 'README.md'), 'utf8'), /Widening the places the viewer may write/);
});

test('the sandbox folder is one constant beside Sage Advice, and only an environment variable read at load can change it', () => {
  assert.equal(boundaryModule.SANDBOX_DIR, process.env.BOWERLOOM_VIEWER_SANDBOX ?? join(homedir(), 'Sage Advice Sandbox'));
  assert.match(readFileSync(join(DESKTOP, 'main', 'boundary.ts'), 'utf8'), /export const SANDBOX_DIR: string = sandboxDirFor\(\{ env: process\.env, home: homedir\(\), packaged: isPackagedRuntime\(\) \}\);/);
  assert.match(readFileSync(join(DESKTOP, 'main', 'boundary.ts'), 'utf8'), /export const SANDBOX_NAME = 'Sage Advice Sandbox';/);
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
  const allowed = Object.keys(WRITERS).concat(['main/sandbox.ts', 'main/sketches.ts', 'main/diagnostics-dialogs.ts']);
  for (const w of writers) assert.ok(allowed.includes(w), `${w} writes a file but is not in the list`);
  for (const [file, need] of Object.entries(WRITERS)) assert.match(strip(readFileSync(join(DESKTOP, file), 'utf8')), need, `${file} must ask the boundary before it writes`);
  for (const file of ['main/sandbox.ts', 'main/sketches.ts']) { try { assert.match(strip(readFileSync(join(DESKTOP, file), 'utf8')), /assert(App)?Writable\(/, file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  const saves = strip(readFileSync(join(DESKTOP, 'main/diagnostics-dialogs.ts'), 'utf8'));
  assert.match(saves, /deps\.showSave\([\s\S]*\(deps\.writeFile \?\? writePrivate\)\(picked\.filePath,/, 'the summary goes only where the save dialog said');
  assert.match(saves, /writeFileSync\(path, text, \{ mode: 0o600 \}\)/, 'and a new file is for its owner only');
  assert.equal((saves.match(/writeFileSync\(/g) ?? []).length, 1, 'one write call');
  assert.equal(all.some(f => f.startsWith('main/boundary')), true);
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
