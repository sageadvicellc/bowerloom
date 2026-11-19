// Gate 1 Part C, packaged installers on macOS: the ad-hoc signed dmg and zip install to a path with spaces and non-ASCII characters, and the child starts.
// Needs `npm run package` first (it builds the dmg and the zip in app/release). No Apple account and no notarization are involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { APP_DIR, DESKTOP, launch, tempDir } from './support.mjs';

const RELEASE = join(APP_DIR, 'release');
const NAME = 'Bowerloom Spike';
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const built = () => join(RELEASE, arch === 'arm64' ? 'mac-arm64' : 'mac', `${NAME}.app`);
const files = ext => (existsSync(RELEASE) ? readdirSync(RELEASE).filter(f => f.endsWith(ext) && f.includes(arch)) : []);
const exeOf = app => join(app, 'Contents', 'MacOS', NAME);
const WEIRD = 'Ünïcode Späce ✓ dir';

async function childStarts(t, app) {
  const started = launch(t, 'ping', {}, { exe: exeOf(app), packaged: true });
  const end = await started.ended;
  const r = started.result();
  assert.ok(r, `no result (exit ${end.code} ${end.signal}): ${started.stderr().slice(0, 400)}`);
  assert.equal(r.pong, true);
  assert.equal(r.childIsNotMain, true);
  assert.equal(end.code, 0);
  return r;
}

test('P1. the build made 1 dmg and 1 zip for this machine, and the app', () => {
  assert.equal(files('.dmg').length, 1, `dmg files: ${files('.dmg')}`);
  assert.equal(files('.zip').length, 1, `zip files: ${files('.zip')}`);
  assert.ok(existsSync(built()), `app at ${built()}`);
});

test('P2. the fuses are as promised: runAsNode and enableNodeOptionsEnvironmentVariable are off (tools/check-fuses.mjs exits 0)', () => {
  const run = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'check-fuses.mjs'), exeOf(built())], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /Fuses are as promised\./);
});

test('P3. the app is ad-hoc signed, with no hardened runtime and no team', () => {
  const run = spawnSync('codesign', ['-dv', '--verbose=2', built()], { encoding: 'utf8' });
  const text = `${run.stdout}${run.stderr}`;
  assert.match(text, /Signature=adhoc/);
  assert.match(text, /TeamIdentifier=not set/);
  assert.doesNotMatch(text, /flags=0x[0-9a-f]+\(.*runtime/);
});

test('P4. the zip installs to a path with spaces and non-ASCII characters and the child starts', { timeout: 120000 }, async t => {
  const zip = files('.zip')[0];
  assert.ok(zip);
  const target = join(tempDir(t, 'stage1-zip-'), WEIRD);
  mkdirSync(target, { recursive: true });
  execFileSync('ditto', ['-x', '-k', join(RELEASE, zip), target]);
  const app = join(target, `${NAME}.app`);
  assert.ok(existsSync(app));
  const r = await childStarts(t, app);
  assert.match(r.execPath, /Ünïcode Späce ✓ dir/);
});

test('P5. the dmg installs to a path with spaces and non-ASCII characters and the child starts', { timeout: 120000 }, async t => {
  const dmg = files('.dmg')[0];
  assert.ok(dmg);
  const base = tempDir(t, 'stage1-dmg-');
  const mount = join(base, 'mount');
  mkdirSync(mount);
  execFileSync('hdiutil', ['attach', join(RELEASE, dmg), '-nobrowse', '-readonly', '-noverify', '-mountpoint', mount], { stdio: 'ignore' });
  const target = join(base, WEIRD);
  try {
    mkdirSync(target, { recursive: true });
    execFileSync('ditto', [join(mount, `${NAME}.app`), join(target, `${NAME}.app`)]);
  } finally {
    execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' });
  }
  const app = join(target, `${NAME}.app`);
  assert.ok(existsSync(app));
  const r = await childStarts(t, app);
  assert.match(r.execPath, /Ünïcode Späce ✓ dir/);
});
