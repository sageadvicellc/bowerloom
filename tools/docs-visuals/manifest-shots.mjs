#!/usr/bin/env node
/** Writes the `shots` half of apps/docs/src/visuals/manifest.json from plan.json and the size of each light WebP file. The `terminals` half is kept. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const manifestPath = join(root, 'apps', 'docs', 'src', 'visuals', 'manifest.json');
const plan = JSON.parse(readFileSync(new URL('./plan.json', import.meta.url), 'utf8'));

/** The width and height of a WebP file, read from its header (VP8, VP8L, or VP8X). */
function webpSize(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`${file}: not a WebP file`);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') { const v = b.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) }; }
  if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  throw new Error(`${file}: unknown WebP kind ${kind}`);
}

const shots = {};
for (const entry of plan.filter(e => e.kind === 'shot')) {
  const light = join(root, 'apps', 'docs', 'public', 'visuals', `${entry.id}-light.webp`);
  const dark = join(root, 'apps', 'docs', 'public', 'visuals', `${entry.id}-dark.webp`);
  for (const file of [light, dark]) if (!existsSync(file)) throw new Error(`Missing picture: ${file}`);
  const size = webpSize(light), other = webpSize(dark);
  if (size.width !== other.width || size.height !== other.height) throw new Error(`${entry.id}: the light and dark pictures differ in size`);
  shots[entry.id] = { alt: entry.alt, caption: entry.caption, ...size };
}
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
mkdirSync(dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify({ shots, terminals: old.terminals ?? {} }, null, 2)}\n`);
console.log(`Wrote ${Object.keys(shots).length} shots.`);
