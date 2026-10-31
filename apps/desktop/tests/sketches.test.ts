// Sketch rules: file names that never collide, next ids that never repeat, and the threads that are allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadSketch, parseSketch, saveSketch, sketchFileName } from '../main/sketches.js';
import { canThread, nextSketchId, threadWord } from '../shared/sketchrules.js';
import { tempDir } from './support.js';

const base = { version: 1, nodes: [{ id: 'sk-1', kind: 'team', label: 'T', x: 0, y: 0 }], edges: [] as { from: string; to: string }[] };

test('names that differ in a space, an underscore or a letter case are different files', () => {
  const names = ['My harness', 'My_harness', 'my harness', 'MY HARNESS', 'My-harness', 'My  harness'];
  assert.equal(new Set(names.map(sketchFileName).map(n => n.toLowerCase())).size, names.length, 'no two collide, even where case is ignored');
  assert.match(sketchFileName('My harness'), /^[a-z0-9_-]+\.json$/);
});

test('"My harness" and "My_harness" are saved side by side and each opens its own', t => {
  const dir = tempDir(t);
  saveSketch(dir, { ...base, name: 'My harness', nodes: [{ ...base.nodes[0]!, label: 'space' }] }); saveSketch(dir, { ...base, name: 'My_harness', nodes: [{ ...base.nodes[0]!, label: 'under' }] });
  assert.equal(readdirSync(join(dir, 'sketches')).length, 2); assert.equal(loadSketch(dir, 'My harness').nodes[0]!.label, 'space'); assert.equal(loadSketch(dir, 'My_harness').nodes[0]!.label, 'under');
  assert.equal(existsSync(join(dir, 'sketches', 'my_5fharness.json')), false, 'a lower-case twin is not mixed up either');
});

test('a sketch with a repeated node id, a repeated thread, or a thread the rules do not allow is refused', () => {
  const two = [{ id: 'a', kind: 'team', label: 'T', x: 0, y: 0 }, { id: 'b', kind: 'agent', label: 'A', x: 1, y: 1 }, { id: 'c', kind: 'skill', label: 'S', x: 2, y: 2 }];
  assert.throws(() => parseSketch({ ...base, name: 'x', nodes: [two[0], two[0]] }), /node/);
  assert.throws(() => parseSketch({ ...base, name: 'x', nodes: two, edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'b' }] }), /thread/);
  assert.throws(() => parseSketch({ ...base, name: 'x', nodes: two, edges: [{ from: 'a', to: 'c' }] }), /thread/, 'a team does not thread to a skill');
  assert.throws(() => parseSketch({ ...base, name: 'x', nodes: two, edges: [{ from: 'c', to: 'a' }] }), /thread/);
  assert.equal(parseSketch({ ...base, name: 'x', nodes: two, edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] }).edges.length, 2);
});

test('the next id is one more than the largest in use, so a loaded sketch never gets a duplicate', () => {
  assert.equal(nextSketchId([]), 'sk-1'); assert.equal(nextSketchId(['sk-1', 'sk-2']), 'sk-3'); assert.equal(nextSketchId(['sk-7', 'sk-2']), 'sk-8'); assert.equal(nextSketchId(['a', 'b']), 'sk-1');
  assert.equal(nextSketchId(['sk-3', 'sk-01', 'sk-x']), 'sk-4');
});

test('a team owns a helper and a helper uses a skill or a prompt, in the map\'s words', () => {
  assert.ok(canThread('team', 'agent') && canThread('agent', 'skill') && canThread('agent', 'prompt'));
  assert.ok(!canThread('team', 'skill') && !canThread('skill', 'agent') && !canThread('agent', 'team') && !canThread('prompt', 'skill'));
  assert.equal(threadWord('team'), 'owns'); assert.equal(threadWord('agent'), 'uses');
});
