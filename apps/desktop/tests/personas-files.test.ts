// The persona tool never writes inside the repository (so it can never touch the tracked files in apps/desktop/e2e), writes only through
// one module, and refuses an --out or state folder that sits in the repository. No window is started here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DESKTOP, tempDir } from './support.js';

interface FilesModule {
  REPO_ROOT: string; DESKTOP: string;
  assertWritable(path: string, repo?: string): void;
  isInsideRepo(path: string, repo?: string): boolean;
  ensureDir(path: string, repo?: string): void;
  writeText(path: string, text: string, o?: { repo?: string }): void;
  writeBytes(path: string, bytes: Uint8Array, repo?: string): void;
  appendText(path: string, text: string, repo?: string): void;
  removeOwnFile(path: string): boolean;
}
const files = async (): Promise<FilesModule> => await import(join(DESKTOP, 'tools', 'personas', 'files.mjs')) as FilesModule;
const TOOL = join(DESKTOP, 'tools', 'personas');

test('the repository root is found from the tool folder, and apps/desktop/e2e is inside it', async () => {
  const f = await files();
  assert.equal(f.DESKTOP, DESKTOP);
  assert.equal(f.REPO_ROOT, resolve(DESKTOP, '..', '..'), 'the root is two folders above apps/desktop');
  assert.ok(existsSync(join(f.REPO_ROOT, 'apps', 'desktop', 'package.json')));
  assert.equal(f.isInsideRepo(join(DESKTOP, 'e2e', 'harness-page.ts')), true);
});

test('a write inside the repository, or at a relative path, is refused', async t => {
  const f = await files();
  for (const bad of [join(DESKTOP, 'e2e', 'new.png'), join(DESKTOP, 'e2e'), join(f.REPO_ROOT, 'x.txt'), join(DESKTOP, 'tools', 'personas', 'transcript.txt'), join(DESKTOP, 'not-yet', 'deep', 'file.png'), f.REPO_ROOT]) {
    assert.throws(() => f.assertWritable(bad), /never writes inside the repository/, bad);
    assert.throws(() => f.writeText(bad, 'x'), /never writes inside the repository/, bad);
    assert.throws(() => f.writeBytes(bad, new Uint8Array([1])), /never writes inside the repository/, bad);
    assert.throws(() => f.appendText(bad, 'x'), /never writes inside the repository/, bad);
    assert.throws(() => f.ensureDir(bad), /never writes inside the repository/, bad);
  }
  for (const bad of ['', 'relative/path.png', './x', '../x']) assert.throws(() => f.assertWritable(bad), /absolute path/, bad);
  assert.equal(existsSync(join(DESKTOP, 'not-yet')), false, 'the refused write made no folder');
  const dir = tempDir(t);
  assert.doesNotThrow(() => f.assertWritable(join(dir, 'a', 'b.png')));
  f.ensureDir(join(dir, 'out'));
  f.writeBytes(join(dir, 'out', 'a.png'), new Uint8Array([137, 80]));
  f.appendText(join(dir, 'out', 'a.txt'), 'one\n');
  f.appendText(join(dir, 'out', 'a.txt'), 'two\n');
  assert.equal(readFileSync(join(dir, 'out', 'a.txt'), 'utf8'), 'one\ntwo\n');
  assert.deepEqual([...readFileSync(join(dir, 'out', 'a.png'))], [137, 80]);
});

test('a link in the temporary folder that leads into the repository does not hide the repository', async t => {
  const f = await files();
  const dir = tempDir(t);
  symlinkSync(join(DESKTOP, 'e2e'), join(dir, 'sneaky'));
  assert.throws(() => f.assertWritable(join(dir, 'sneaky', 'x.png')), /never writes inside the repository/);
  assert.throws(() => f.writeBytes(join(dir, 'sneaky', 'x.png'), new Uint8Array([1])), /never writes inside the repository/);
  assert.equal(existsSync(join(DESKTOP, 'e2e', 'x.png')), false);
});

test('only a file that the tool wrote itself can be removed by it', async t => {
  const f = await files();
  const dir = tempDir(t);
  f.writeText(join(dir, 'state.json'), '{}');
  assert.equal(f.removeOwnFile(join(dir, 'state.json')), true);
  assert.equal(existsSync(join(dir, 'state.json')), false);
  f.writeText(join(dir, 'later.json'), '{}');
  mkdirSync(join(dir, 'keep'));
  assert.equal(f.removeOwnFile(join(dir, 'other-file.json')), false, 'a path that was never written is left alone');
  assert.equal(f.removeOwnFile(join(dir, 'keep')), false);
  assert.equal(f.removeOwnFile(join(dir, 'state.json')), false, 'a second removal does nothing');
  assert.equal(existsSync(join(dir, 'later.json')), true);
});

test('no file of the tool writes except files.mjs, and no screenshot call takes a path of its own', () => {
  const WRITE_API = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|symlink|symlinkSync|link|linkSync|truncate|truncateSync|chmod|chmodSync|utimes|open|openSync)\s*\(/;
  const sources = readdirSync(TOOL).filter(name => name.endsWith('.mjs'));
  assert.ok(sources.includes('files.mjs') && sources.includes('drive.mjs') && sources.includes('app.mjs'));
  for (const name of sources) {
    const code = readFileSync(join(TOOL, name), 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (name === 'files.mjs') { assert.match(code, WRITE_API, 'the guarded module is where the writes are'); continue; }
    assert.doesNotMatch(code, WRITE_API, `${name} must write only through files.mjs`);
    assert.doesNotMatch(code, /screenshot\(\s*\{[^}]*\bpath\s*:/, `${name} must not give a screenshot a path`);
    assert.doesNotMatch(code, /node:child_process|child_process/, `${name} starts no process`);
    assert.doesNotMatch(code, /\bfetch\(|node:https|node:net\b|node:dns|WebSocket/, `${name} makes no outside network call`);
  }
});

test('the only modules that use the repository folders for reading are the driver pieces, and they name no repo file to a persona', () => {
  const app = readFileSync(join(TOOL, 'app.mjs'), 'utf8');
  assert.match(app, /scale: 'css'/);
  assert.match(app, /writeBytes\(file, await page\.screenshot\(/, 'a screenshot is bytes handed to the guarded writer');
  assert.match(app, /join\(outDir, `look-/, 'every screenshot lands in the out folder');
  const protocol = readFileSync(join(TOOL, 'protocol.mjs'), 'utf8');
  assert.doesNotMatch(protocol, /evaluate|innerHTML|readFile/);
});

test('serve refuses an --out folder inside the repository, and a state folder inside it, before any window opens', t => {
  const run = (args: string[], env: Record<string, string>): { status: number | null; stderr: string; stdout: string } => {
    const r = spawnSync(process.execPath, [join(TOOL, 'drive.mjs'), ...args], { encoding: 'utf8', timeout: 20000, env: { ...process.env, ...env } });
    return { status: r.status, stderr: r.stderr, stdout: r.stdout };
  };
  const dir = tempDir(t);
  const env = { BOWERLOOM_PERSONAS_DIR: dir };
  const inShots = run(['serve', '--id', 'guard', '--out', join(DESKTOP, 'e2e', 'persona-run')], env);
  assert.equal(inShots.status, 1);
  assert.match(inShots.stderr, /never writes inside the repository/);
  assert.equal(inShots.stdout.includes('READY'), false);
  assert.equal(existsSync(join(DESKTOP, 'e2e', 'persona-run')), false);
  const inRepo = run(['serve', '--id', 'guard', '--out', join(DESKTOP, '..', '..', 'persona-out')], env);
  assert.equal(inRepo.status, 1);
  assert.match(inRepo.stderr, /never writes inside the repository/);
  const stateInRepo = run(['serve', '--id', 'guard'], { BOWERLOOM_PERSONAS_DIR: join(DESKTOP, 'personas-state') });
  assert.equal(stateInRepo.status, 1);
  assert.match(stateInRepo.stderr, /never writes inside the repository/);
  assert.equal(existsSync(join(DESKTOP, 'personas-state')), false);
});

test('serve and the other commands report problems as one plain line with no stack', t => {
  const dir = tempDir(t);
  const env = { ...process.env, BOWERLOOM_PERSONAS_DIR: dir };
  const none = spawnSync(process.execPath, [join(TOOL, 'drive.mjs'), '--id', 'nobody', 'look'], { encoding: 'utf8', timeout: 20000, env });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /No session is running for the id "nobody"\. Start one with: node tools\/personas\/drive\.mjs serve --id nobody/);
  const unknown = spawnSync(process.execPath, [join(TOOL, 'drive.mjs'), '--id', 'nobody', 'evaluate', '1+1'], { encoding: 'utf8', timeout: 20000, env });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /I do not know "evaluate"/);
  assert.doesNotMatch(none.stderr + unknown.stderr, /\n\s+at /);
  const help = spawnSync(process.execPath, [join(TOOL, 'drive.mjs'), 'help'], { encoding: 'utf8', timeout: 20000, env });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Run look first/);
});
