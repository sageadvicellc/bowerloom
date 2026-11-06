import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dockFolder, dockIconFile, followAppearance } from '../main/dock-icon.js';
import { DESKTOP } from './support.js';

test('the Dock pair comes from Resources/dock in the app and from build/dock in a checkout', () => {
  assert.equal(dockFolder({ packaged: true, resourcesPath: '/App/Contents/Resources', appRoot: '/x/dist' }), '/App/Contents/Resources/dock');
  assert.equal(dockFolder({ packaged: false, resourcesPath: '/unused', appRoot: '/repo/apps/desktop/dist' }), '/repo/apps/desktop/build/dock');
  assert.equal(dockIconFile('/d', false), '/d/icon-light.png');
  assert.equal(dockIconFile('/d', true), '/d/icon-dark.png');
  const pkg = JSON.parse(readFileSync(join(DESKTOP, 'package.json'), 'utf8')) as { build: { extraResources: { from: string; to: string }[] } };
  assert.ok(pkg.build.extraResources.some(entry => entry.from === 'build/dock' && entry.to === 'dock'), 'electron-builder ships build/dock as Resources/dock');
  for (const tone of ['light', 'dark']) assert.ok(existsSync(join(DESKTOP, 'build', 'dock', `icon-${tone}.png`)), tone);
});

test('the Dock icon follows the system appearance, now and on every change', () => {
  const set: string[] = [];
  let listener: (() => void) | undefined;
  const theme = { shouldUseDarkColors: false, on: (_event: 'updated', fn: () => void) => { listener = fn; } };
  followAppearance({ dock: { setIcon: (image: never) => { set.push((image as unknown as { path: string }).path); } }, theme, folder: '/d', load: path => ({ path, isEmpty: () => false }) });
  assert.deepEqual(set, ['/d/icon-light.png'], 'light at start');
  theme.shouldUseDarkColors = true; listener?.();
  assert.deepEqual(set, ['/d/icon-light.png', '/d/icon-dark.png'], 'dark after the system turns dark');
});

test('an icon that does not load is reported and leaves the Dock alone, and no Dock means nothing to do', () => {
  const told: string[] = [], set: unknown[] = [];
  followAppearance({ dock: { setIcon: image => { set.push(image); } }, theme: { shouldUseDarkColors: true, on: () => undefined }, folder: '/d', load: () => ({ isEmpty: () => true }), tell: message => { told.push(message); } });
  assert.deepEqual(set, []);
  assert.deepEqual(told, ['Bowerloom could not load its Dock icon: /d/icon-dark.png']);
  assert.doesNotThrow(() => followAppearance({ dock: undefined, theme: { shouldUseDarkColors: false, on: () => { throw new Error('not called'); } }, folder: '/d', load: () => { throw new Error('not called'); } }));
});
