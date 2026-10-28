// 0.7 files (definition spec 8 rule 6, 11, 12 check 7, decision 12): old skills.json and bowerloom.json read through
// step 0's mapping and stay byte for byte unchanged; 0.7 skills in .bowerloom/skills become definition skills in
// place; 0.7 managed copies become definition skills with their source recorded. No 0.7 file is changed or deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition } from '../../../dist/packages/harness-definition/src/index.js';
import { applyAdoption, planAdoption } from '../../../dist/packages/adoption/src/index.js';
import { code, item, json, project, sha, skill, snapshot } from './fixture.mjs';

const OLD_MANIFEST = json({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }] });
const OLD_CONFIG = json({ format: 'bowerloom/project/v1beta1', harnesses: ['claude'], skills: [{ id: 'house-style', source: 'store' }], prompts: [], teams: [] });

function unchanged(before, after, keep) {
  for (const k of Object.keys(before)) if (keep(k)) assert.equal(after[k], before[k], `${k} changed`);
}

test('check 7: old skills.json and bowerloom.json read through the old-form mapping and stay byte for byte unchanged', async t => {
  const p = project(t, {
    '.bowerloom/skills.json': OLD_MANIFEST,
    '.bowerloom/bowerloom.json': OLD_CONFIG,
    '.bowerloom/skills/house-style/SKILL.md': skill('house-style'),
    'AGENTS.md': '# Demo\n',
  });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input());
  assert.deepEqual(plan.engines.map(e => [e.id, e.detected]), [['claude-code', true], ['codex', true]]);
  assert.deepEqual(plan.read.filter(r => r.path.endsWith('.json')).map(r => [r.path, r.sha256]), [
    ['.bowerloom/bowerloom.json', sha(OLD_CONFIG)], ['.bowerloom/skills.json', sha(OLD_MANIFEST)],
  ]);
  await applyAdoption(p.input(), plan.revision);
  const after = snapshot(p.dir);
  unchanged(before, after, () => true);
  assert.equal(fs.readFileSync(path.join(p.def, 'skills.json'), 'utf8'), OLD_MANIFEST);
  assert.equal(fs.readFileSync(path.join(p.def, 'bowerloom.json'), 'utf8'), OLD_CONFIG);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.definition.entries.skills.map(s => s.id), ['house-style']);
  assert.equal(plan.files.some(f => f.path.startsWith('skills/')), false, 'a 0.7 skill already in place is not written again');
  assert.equal(item(plan, 'skills', 'house-style').places[0].kind, 'authored-0.7');
});

test('a 0.7 file that does not parse is listed, its engines are not used, and it stays unchanged', t => {
  const p = project(t, { '.bowerloom/skills.json': '{ not json', 'AGENTS.md': '# Demo\n' });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input());
  assert.match(plan.unmapped.find(u => u.path === '.bowerloom/skills.json').reason, /stays unchanged/);
  assert.deepEqual(snapshot(p.dir), before);
});

test('a 0.7 skill in .bowerloom/skills that the definition cannot carry refuses adoption, since adoption never changes it in place', t => {
  const p = project(t, { '.bowerloom/skills/house-style/SKILL.md': skill('house-style', 'allowed-tools: Read\n') });
  assert.throws(() => planAdoption(p.input({ engines: [{ id: 'claude-code' }] })), code('ADOPTION_LEGACY_SKILL'));
  const q = project(t, { '.bowerloom/skills/notes.txt': 'x\n' });
  assert.throws(() => planAdoption(q.input({ engines: [{ id: 'claude-code' }] })), code('ADOPTION_LEGACY_SKILL'));
  // A hidden file or a link inside a 0.7 skill makes the real folder fail to load, so the plan refuses it too.
  const h = project(t, { '.bowerloom/skills/house-style/SKILL.md': skill('house-style'), '.bowerloom/skills/house-style/.notes': 'x\n' });
  assert.throws(() => planAdoption(h.input({ engines: [{ id: 'claude-code' }] })), code('ADOPTION_LEGACY_SKILL'));
  const l = project(t, { '.bowerloom/skills/house-style/SKILL.md': skill('house-style'), '.bowerloom/skills/house-style/linked.md': { link: 'SKILL.md' } });
  assert.throws(() => planAdoption(l.input({ engines: [{ id: 'claude-code' }] })), code('ADOPTION_LEGACY_SKILL'));
});

test('an empty .gitkeep in .bowerloom/skills is metadata, as the loader reads it', t => {
  const p = project(t, { '.bowerloom/skills/.gitkeep': '', '.bowerloom/skills/house-style/SKILL.md': skill('house-style') });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
});

const TIDY = skill('tidy', '', 'Tidy the imports.\n', 'Tidies imports.');
const catalog = (extra = {}) => json({
  format: 'bowerloom/managed-catalog/v1beta2', policy: 'bowerloom/managed-items/v1beta2', item: { kind: 'skill', id: 'tidy' },
  source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: 'example-tidy-skill', version: '1.2.3' },
  skill: { id: 'tidy', name: 'tidy', sourceRoot: 'skills/tidy' }, license: null, references: [], inventory: [], harnesses: ['claude', 'codex'],
  surfaces: [{ id: 'canonical', path: '.bowerloom/managed/skills/tidy' }, { id: 'projection-claude', path: '.claude/skills/tidy' }, { id: 'projection-codex', path: '.agents/skills/tidy' }, { id: 'catalog', path: '.bowerloom/managed/catalog/tidy.json' }],
  executionAuthorized: false, ...extra,
});

test('a 0.7 managed copy becomes a definition skill with its source recorded; no 0.7 file is changed or deleted', async t => {
  const p = project(t, {
    '.bowerloom/managed/catalog/tidy.json': catalog(),
    '.bowerloom/managed/skills/tidy/SKILL.md': TIDY,
    '.bowerloom/managed/.gitignore': '*\n',
    '.claude/skills/tidy/SKILL.md': TIDY,
    '.agents/skills/tidy/SKILL.md': TIDY,
  });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }));
  assert.equal(plan.ready, true);
  const tidy = item(plan, 'skills', 'tidy');
  assert.deepEqual(tidy.places.map(x => [x.path, x.kind]), [['.agents/skills/tidy', 'engine'], ['.bowerloom/managed/skills/tidy', 'managed-0.7'], ['.claude/skills/tidy', 'engine']]);
  assert.deepEqual(tidy.source, { name: 'example-tidy-skill', marketplace: 'https://registry.npmjs.org', version: '1.2.3' });
  assert.deepEqual(plan.managed, [{
    catalog: '.bowerloom/managed/catalog/tidy.json', kind: 'skill', id: 'tidy', skill: 'tidy',
    source: { name: 'example-tidy-skill', marketplace: 'https://registry.npmjs.org', version: '1.2.3' },
    copies: ['.agents/skills/tidy', '.bowerloom/managed/skills/tidy', '.claude/skills/tidy'], reason: 'Converted into the definition skill tidy.',
  }]);
  await applyAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }), plan.revision);
  unchanged(before, snapshot(p.dir), () => true);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.definition.sources, [{ name: 'example-tidy-skill', marketplace: 'https://registry.npmjs.org', version: '1.2.3', items: [{ part: 'skills', id: 'tidy' }] }]);
});

test('a managed copy that drifted from its projection is shown side by side, not picked', t => {
  const p = project(t, {
    '.bowerloom/managed/catalog/tidy.json': catalog({ harnesses: ['claude'] }),
    '.bowerloom/managed/skills/tidy/SKILL.md': TIDY,
    '.claude/skills/tidy/SKILL.md': TIDY.replace('Tidy the imports.', 'Tidy the imports, edited by hand.'),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.conflicts.map(c => [c.key, c.variants.map(v => v.key)]), [['skills/tidy', ['.bowerloom/managed/skills/tidy', '.claude/skills/tidy']]]);
  assert.equal(plan.managed[0].skill, null);
  assert.match(plan.managed[0].reason, /conflict/);
});

test('a git source is recorded by repository and commit; a local source is recorded in the plan only', t => {
  const git = { kind: 'git', host: 'github.com', repository: 'example/skills', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const p = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog({ source: git, harnesses: ['claude'] }), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.deepEqual(item(plan, 'skills', 'tidy').source, { name: 'example/skills', marketplace: 'github.com', version: 'a'.repeat(40) });
  const q = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog({ source: { kind: 'local', path: 'skills/tidy' }, harnesses: ['claude'] }), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const local = planAdoption(q.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(item(local, 'skills', 'tidy').source, undefined);
  assert.match(local.managed[0].reason, /local/);
});

test('the 0.7 v1 namespace .bowerloom-skills converts the same way and stays in place', async t => {
  const p = project(t, {
    '.bowerloom-skills/catalog.json': json({ format: 'bowerloom/observed-managed-skill-catalog/v1beta1', operationKey: 'c'.repeat(64), policy: 'x', source: { kind: 'npm', registry: 'https://registry.npmjs.org', package: 'example-tidy-skill', version: '1.2.3' }, skill: { name: 'tidy', sourceRoot: 'skills/tidy' }, license: null, references: [], inventory: [], harness: 'claude', executionAuthorized: false }),
    '.bowerloom-skills/skills/tidy/SKILL.md': TIDY,
    '.claude/skills/tidy/SKILL.md': TIDY,
  });
  const before = snapshot(p.dir);
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(plan.managed[0].skill, 'tidy');
  assert.deepEqual(item(plan, 'skills', 'tidy').places.map(x => x.path), ['.bowerloom-skills/skills/tidy', '.claude/skills/tidy']);
  await applyAdoption(p.input({ engines: [{ id: 'claude-code' }] }), plan.revision);
  unchanged(before, snapshot(p.dir), () => true);
});

test.todo('project-sync lane: after adoption, the portable projection takes a skill folder whose 0.7 managed copy the definition records (plan.managed), instead of refusing PORTABLE_MANAGED_COPY');
