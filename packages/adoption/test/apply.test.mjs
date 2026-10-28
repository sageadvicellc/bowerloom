// Apply writes by copy and creates files only. When anything fails part way, it removes what it wrote, never a file
// it did not write, and refuses with a clear code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { applyAdoptionWith } from '../../../dist/packages/adoption/src/apply.js';
import { INSTRUCTIONS, code, project, skill, snapshot } from './fixture.mjs';

const TWO = [{ id: 'claude-code' }, { id: 'codex' }];
const files = { 'AGENTS.md': INSTRUCTIONS, '.claude/skills/review/SKILL.md': skill('review'), '.claude/skills/review/references/notes.md': 'Notes.\n' };

test('a file that appears where apply writes is never overwritten; apply removes what it wrote and refuses', async t => {
  const p = project(t, files);
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input({ engines: TWO }));
  const target = '.bowerloom/skills/review/SKILL.md';
  await assert.rejects(applyAdoptionWith(p.input({ engines: TWO }), plan.revision, new AbortController().signal, {
    beforeWrite: rel => { if (rel === target) fs.writeFileSync(path.join(p.dir, rel), 'a person wrote this\n'); },
  }), code('ADOPTION_STALE_APPROVAL'));
  assert.equal(fs.readFileSync(path.join(p.dir, target), 'utf8'), 'a person wrote this\n');
  const after = snapshot(p.dir);
  assert.deepEqual(Object.keys(after).filter(k => k.startsWith('.bowerloom')).sort(), ['.bowerloom/', '.bowerloom/skills/', '.bowerloom/skills/review/', target],
    'only the person\'s file and the folders that hold it remain');
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v);
});

test('a folder swapped for a link before a write is refused, not followed; apply removes what it wrote', async t => {
  const p = project(t, files);
  const outside = path.join(p.base, 'outside');
  fs.mkdirSync(outside);
  const plan = planAdoption(p.input({ engines: TWO }));
  await assert.rejects(applyAdoptionWith(p.input({ engines: TWO }), plan.revision, new AbortController().signal, {
    beforeWrite: rel => {
      if (rel !== '.bowerloom/skills/review/SKILL.md') return;
      const dir = path.join(p.dir, '.bowerloom/skills/review');
      fs.rmSync(dir, { recursive: true }); fs.symlinkSync(outside, dir);
    },
  }), code('ADOPTION_PATH_UNSAFE'));
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written through the link');
  assert.equal(fs.existsSync(path.join(p.dir, '.bowerloom/harness.json')), false);
});

test('an aborted signal stops apply before it writes', async t => {
  const p = project(t, files);
  const plan = planAdoption(p.input({ engines: TWO }));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(applyAdoptionWith(p.input({ engines: TWO }), plan.revision, ac.signal, {}), e => typeof e?.code === 'string');
  assert.equal(fs.existsSync(p.def), false);
});
