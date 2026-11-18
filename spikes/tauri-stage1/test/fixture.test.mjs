// The generated scan fixtures. The real repo holds no large realistic input for the scan, so the payload baseline uses a generated folder
// whose size follows the reader's own limits. These tests hold the generator to the counts it promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeScanFixture, SHAPES } from '../src/fixture.mjs';

const temp = t => { const dir = mkdtempSync(join(tmpdir(), 'stage1-fixture-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

test('1. a fixture holds the number of projects, skills and bytes it was asked for', t => {
  const root = temp(t);
  const made = makeScanFixture(root, { projects: 3, skills: 4, fileBytes: 500 });
  assert.equal(made.projects, 3);
  assert.equal(made.skillFiles, 12);
  const project = join(made.picked, 'project-001', '.claude', 'skills');
  assert.equal(readdirSync(project).length, 4);
  const file = join(project, readdirSync(project)[0], 'SKILL.md');
  assert.ok(statSync(file).size >= 500 && statSync(file).size < 560, `size ${statSync(file).size}`);
  assert.match(readFileSync(file, 'utf8'), /^---\nname: /);
});

test('2. the same options make the same bytes', t => {
  const a = makeScanFixture(temp(t), { projects: 2, skills: 2, fileBytes: 300 });
  const b = makeScanFixture(temp(t), { projects: 2, skills: 2, fileBytes: 300 });
  const read = made => readFileSync(join(made.picked, 'project-002', '.claude', 'skills', 'skill-002', 'SKILL.md'), 'utf8');
  assert.equal(read(a), read(b));
});

test('3. the named shapes stay inside the reader limits (199 projects, 10,000 files, 20 MiB read)', () => {
  assert.ok(SHAPES.length >= 3);
  for (const shape of SHAPES) {
    assert.ok(shape.projects <= 199, `${shape.name}: projects`);
    assert.ok(shape.projects * shape.skills <= 10000, `${shape.name}: files`);
    assert.ok(shape.projects * shape.skills * shape.fileBytes <= 20 * 1024 * 1024, `${shape.name}: bytes read`);
    assert.ok(shape.fileBytes <= 2 * 1024 * 1024, `${shape.name}: one file`);
    assert.equal(typeof shape.why, 'string');
  }
});
