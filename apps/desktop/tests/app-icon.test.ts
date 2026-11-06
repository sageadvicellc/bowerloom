// The app ships its own icon: the S4-G3 mascot on a cream tile with an embossed burgundy stroke, and a dark twin, slate with a pink stroke, for the Dock. electron-builder reads build/icon.icns for macOS and build/icon.png for the other systems.
// tools/render-app-icon.mjs draws both from design/app-icon.html, so these tests check that the drawn files are there and well formed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const build = (name: string): Buffer => readFileSync(join(DESKTOP, 'build', name));

test('the icon PNG is a 1024 px square with clear corners', () => {
  const png = build('icon.png');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'a PNG file');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]);
  assert.equal(png[25], 6, 'RGBA');
  assert.equal(png[24], 8, '8 bits per channel');
  // The first pixel of the first row is stored as is under every PNG filter, so its alpha byte can be read straight from the inflated data.
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const len = png.readUInt32BE(at), type = png.subarray(at + 4, at + 8).toString('latin1');
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const pixels = inflateSync(Buffer.concat(idat));
  assert.equal(pixels[1 + 3], 0, 'the top left corner is clear');
});

test('the icns file holds every macOS size, up to 1024 px', () => {
  const icns = build('icon.icns');
  assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length, 'the header length matches the file');
  const types = new Set<string>();
  const widths = new Map<string, number>();
  for (let at = 8; at < icns.length;) {
    const len = icns.readUInt32BE(at + 4);
    assert.ok(len >= 8 && at + len <= icns.length, `chunk at ${at} has a sane length: ${len}`);
    const type = icns.subarray(at, at + 4).toString('latin1'), body = icns.subarray(at + 8, at + len);
    types.add(type);
    if (body.subarray(1, 4).toString('latin1') === 'PNG') widths.set(type, body.readUInt32BE(16));
    at += len;
  }
  // ic04 to ic10 are the 16 to 1024 px images, and ic11 to ic14 their @2x forms.
  for (const type of ['ic04', 'ic05', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']) assert.ok(types.has(type), `${type} is there: ${[...types].join(', ')}`);
  // The PNG chunks hold the pixel size their type names.
  for (const [type, px] of [['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]] as const) assert.equal(widths.get(type), px, type);
});

test('the icons are drawn from the website mascots: cream with a burgundy stroke, and slate with a pink stroke', () => {
  const design = readFileSync(join(DESKTOP, 'design', 'app-icon.html'), 'utf8');
  const tool = readFileSync(join(DESKTOP, 'tools', 'render-app-icon.mjs'), 'utf8');
  assert.match(tool, /landing\/public\/brand\/rose-conservatory/, 'the mascots are the website copies');
  assert.match(tool, /'s4-g3-icon\.svg'/); assert.match(tool, /'s4-g3-icon-dark\.svg'/);
  assert.match(design, /:root \{ --face: radial-gradient\(circle at 30% 22%, #FFFCF8, #F6EEE8 55%, #EDDCD6\); --stroke-hi: #A9707C; --stroke: #80515B;/, 'light: cream face, burgundy stroke');
  assert.match(design, /:root\.dark \{ --face: radial-gradient\(circle at 30% 22%, #3F3A43, #2B292F 58%, #1F1E23\); --stroke-hi: #F7D3DC; --stroke: #E8B3BF;/, 'dark: slate face, pink stroke');
  assert.doesNotMatch(design, /\.leaf/, 'the stroke replaced the bottom strip');
});

test('the Dock pair are 1024 px with clear corners, and differ', () => {
  const light = build('dock/icon-light.png'), dark = build('dock/icon-dark.png');
  for (const png of [light, dark]) { assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 1024]); assert.equal(png[25], 6); }
  assert.ok(!light.equals(dark), 'the dark icon is its own picture');
  assert.ok(light.equals(build('icon.png')), 'the bundle icon is the light one');
});
