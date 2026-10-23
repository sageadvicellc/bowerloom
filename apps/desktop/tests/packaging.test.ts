// Packaging and the one-command launch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as Record<string, unknown> & { dependencies: Record<string, string>; devDependencies: Record<string, string>; build: Record<string, unknown>; scripts: Record<string, string> };
const root = JSON.parse(readFileSync(join(DESKTOP, '..', '..', 'package.json'), 'utf8')) as { scripts: Record<string, string>; workspaces: string[] };

test('every dependency is pinned to an exact version', () => {
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(version, /^\d+\.\d+\.\d+$/, `${name}@${version}`);
  for (const name of ['electron', 'electron-builder', 'electron-updater']) assert.ok(name in pkg.dependencies || name in pkg.devDependencies, name);
});

test('the viewer is its own package: the command line package and the root workspaces do not include it', () => {
  assert.ok(!root.workspaces.some(w => w.includes('desktop')), 'not a workspace');
  assert.ok(!JSON.stringify(root).includes('electron'), 'the root package holds no Electron dependency');
  assert.equal(existsSync(join(DESKTOP, 'package-lock.json')), true);
});

test('the build targets are macOS (dmg and zip), Windows (nsis), and Linux (AppImage), with a GitHub feed and no publishing', () => {
  const b = pkg.build as { mac: { target: { target: string }[] }; win: { target: string[] }; linux: { target: string[] }; publish: { provider: string; owner: string; repo: string }; appId: string; extraResources: { from: string; to: string }[] };
  assert.deepEqual(b.mac.target.map(x => x.target).sort(), ['dmg', 'zip']); assert.deepEqual(b.win.target, ['nsis']); assert.deepEqual(b.linux.target, ['AppImage']);
  assert.deepEqual(b.publish, { provider: 'github', owner: 'sageadvicellc', repo: 'bowerloom' });
  assert.ok(b.extraResources.some(r => r.from === 'sample-data' && r.to === 'sample-data'));
  assert.match(pkg.scripts.build!, /--publish never/);
  for (const script of Object.values(pkg.scripts)) assert.doesNotMatch(script, /--publish always|publish onTag|npm publish/);
});

test('the commands: one to open the app, one for sample data, both from the repository root', () => {
  assert.equal(root.scripts.desktop, 'node apps/desktop/tools/run.mjs'); assert.equal(root.scripts['desktop:sample'], 'node apps/desktop/tools/run.mjs --sample-data');
  for (const name of ['desktop:dev', 'desktop:build', 'desktop:test']) assert.ok(root.scripts[name], name);
});

test('the one-command launcher works from another folder: it installs what is missing, builds, and stops before the window with --build-only', () => {
  const r = spawnSync(process.execPath, [join(DESKTOP, 'tools', 'run.mjs'), '--build-only'], { cwd: tmpdir(), encoding: 'utf8', timeout: 240000 });
  assert.equal(r.status, 0, r.stderr + r.stdout); assert.match(r.stdout, /Building the viewer/);
  for (const f of ['dist/main.mjs', 'dist/preload.cjs', 'dist/renderer/app.js', 'dist/renderer/index.html', 'dist/renderer/tokens.css', 'dist/renderer/styles.css']) assert.equal(existsSync(join(DESKTOP, f)), true, f);
});

test('the colors and sizes live in one tokens file', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'styles.css'), 'utf8');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(\s*\d/, 'styles use tokens, not colors');
  assert.match(readFileSync(join(DESKTOP, 'renderer', 'tokens.css'), 'utf8'), /prefers|\[data-theme="dark"\]/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /:focus-visible/);
});
