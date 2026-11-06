// The app ships its own icon: the S4-G3 mascot on a cream tile. electron-builder reads build/icon.icns for macOS and build/icon.png for the other systems.
// tools/render-app-icon.mjs draws both from design/app-icon.html, so these tests check that the drawn files are there and well formed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const build = (name: string): Buffer => readFileSync(join(DESKTOP, 'build', name));

test('the icon PNG is a 1024 px square with clear corners', () => {
  const png = build('icon.png');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG file');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]);
  assert.equal(png[25], 6, 'RGBA, so the corners outside the tile are clear');
});

test('the icns file holds every macOS size, up to 1024 px', () => {
  const icns = build('icon.icns');
  assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length, 'the header length matches the file');
  const types = new Set<string>();
  for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) types.add(icns.subarray(at, at + 4).toString('latin1'));
  // ic04 to ic10 are the 16 to 1024 px images, and ic11 to ic14 their @2x forms.
  for (const type of ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']) assert.ok(types.has(type), `${type} is there: ${[...types].join(', ')}`);
});

test('the icon is drawn from the website mascot on a cream tile', () => {
  const design = readFileSync(join(DESKTOP, 'design', 'app-icon.html'), 'utf8');
  const tool = readFileSync(join(DESKTOP, 'tools', 'render-app-icon.mjs'), 'utf8');
  assert.match(tool, /landing\/public\/brand\/rose-conservatory\/s4-g3-icon\.svg/, 'the mascot is the website copy');
  assert.match(design, /\.tile \{[^}]*background: radial-gradient\(circle at 30% 20%, #FFF9F4, #F6EEE8 55%, #EFD9D6\)/, 'a cream tile');
  assert.match(design, /\.leaf \{[^}]*background: #B9C6A0/, 'a sage strip');
});
