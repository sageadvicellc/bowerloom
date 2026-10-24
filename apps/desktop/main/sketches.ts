/**
 * Sketches: drawings of a harness (teams, helpers, skills, prompts and the threads between them) that the person makes on the map.
 * A sketch is a plain file in the viewer's own folder. It is only a drawing: it changes no Bowerloom file, and nothing reads it back as setup.
 * Every write is checked by the write boundary, and a sketch is checked strictly when it is saved and when it is loaded.
 */
import { closeSync, constants, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { Sketch, SketchSummary } from '../shared/types.js';
import { assertAppWritable } from './boundary.js';

export const SKETCH_LIMITS = Object.freeze({ nodes: 200, edges: 400, files: 100, bytes: 256 * 1024, name: 48 });
const KINDS = new Set(['team', 'agent', 'skill', 'prompt']);
const NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/;
const FOLDER = 'sketches';

export class SketchError extends Error {}
const fail = (text: string): never => { throw new SketchError(text); };

export const isSketchName = (name: unknown): name is string => typeof name === 'string' && NAME.test(name) && !name.endsWith(' ');
const fileOf = (dir: string, name: string): string => join(dir, FOLDER, `${name.replace(/ /g, '_')}.json`);

/** A sketch from untrusted data: exact shape, kinds from a short list, numbers that are numbers, edges between nodes that exist. */
export function parseSketch(value: unknown): Sketch {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('That is not a sketch.');
  const v = value as Record<string, unknown>;
  if (!isSketchName(v.name)) return fail('A sketch needs a name of letters, numbers, spaces, - or _, up to 48 characters.');
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges) || v.nodes.length > SKETCH_LIMITS.nodes || v.edges.length > SKETCH_LIMITS.edges) return fail('The sketch is too big.');
  const ids = new Set<string>();
  const nodes = v.nodes.map((n): Sketch['nodes'][number] => {
    const o = n as Record<string, unknown>;
    if (n === null || typeof n !== 'object' || typeof o.id !== 'string' || o.id.length > 120 || typeof o.label !== 'string' || o.label.length > 120 || !KINDS.has(o.kind as string) || typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y) || Math.abs(o.x) > 1e6 || Math.abs(o.y) > 1e6 || ids.has(o.id)) return fail('A node in the sketch is not valid.');
    ids.add(o.id);
    return { id: o.id, kind: o.kind as Sketch['nodes'][number]['kind'], label: o.label, x: o.x, y: o.y };
  });
  const edges = v.edges.map((e): Sketch['edges'][number] => {
    const o = e as Record<string, unknown>;
    if (e === null || typeof e !== 'object' || typeof o.from !== 'string' || typeof o.to !== 'string' || !ids.has(o.from) || !ids.has(o.to) || o.from === o.to) return fail('A thread in the sketch is not valid.');
    return { from: o.from, to: o.to };
  });
  return { version: 1, name: v.name, nodes, edges };
}

export function listSketches(dir: string): SketchSummary[] {
  const folder = join(dir, FOLDER);
  let names: string[]; try { names = readdirSync(folder); } catch { return []; }
  const out: SketchSummary[] = [];
  for (const file of names.filter(n => n.endsWith('.json')).slice(0, SKETCH_LIMITS.files)) {
    try { const sketch = readSketchFile(join(folder, file)); out.push({ name: sketch.name, nodes: sketch.nodes.length, edges: sketch.edges.length }); } catch { /* a damaged file is left out of the list */ }
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : 1));
}

function readSketchFile(path: string): Sketch {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > SKETCH_LIMITS.bytes) return fail('That sketch file cannot be used.');
  let value: unknown; try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { return fail('That sketch file is damaged.'); }
  return parseSketch(value);
}

export function loadSketch(dir: string, name: unknown): Sketch {
  if (!isSketchName(name)) return fail('That is not a sketch name.');
  return readSketchFile(assertAppWritable(dir, fileOf(dir, name)));
}

export function saveSketch(dir: string, value: unknown): SketchSummary {
  const sketch = parseSketch(value);
  const file = assertAppWritable(dir, fileOf(dir, sketch.name)), folder = assertAppWritable(dir, join(dir, FOLDER));
  const existing = listSketches(dir); if (existing.length >= SKETCH_LIMITS.files && !existing.some(s => s.name === sketch.name)) return fail('There are too many sketches. Delete one first.');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const temp = assertAppWritable(dir, `${file}.tmp`);
  rmSync(temp, { force: true });
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { const data = Buffer.from(`${JSON.stringify(sketch)}\n`); let at = 0; while (at < data.length) at += writeSync(fd, data, at); } finally { closeSync(fd); }
  renameSync(temp, file);
  return { name: sketch.name, nodes: sketch.nodes.length, edges: sketch.edges.length };
}

export function deleteSketch(dir: string, name: unknown): void {
  if (!isSketchName(name)) return fail('That is not a sketch name.');
  rmSync(assertAppWritable(dir, fileOf(dir, name)), { force: true });
}
