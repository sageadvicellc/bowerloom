// 0.7 files (definition spec 8 rule 6, 11, 12 check 7, decision 12): old skills.json and bowerloom.json read through
// step 0's mapping and stay byte for byte unchanged; 0.7 skills in .bowerloom/skills become definition skills in
// place; 0.7 managed copies become definition skills with their source recorded. No 0.7 file is changed or deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadDefinition, skillContentHash } from '../../../dist/packages/harness-definition/src/index.js';
import { applyPortable, applyPortableRemoval, planPortable, planPortableRemoval } from '../../../dist/packages/project-sync/src/index.js';
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
  await applyAdoption(p.input(), plan.revision, plan.approvalsRequired);
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
/** The hex of the skill content hash of a folder that holds TIDY as SKILL.md only. */
const TIDY_HASH = skillContentHash('tidy', [{ path: 'skills/tidy/SKILL.md', bytes: Buffer.from(TIDY) }]).slice('sha256:'.length);
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
  assert.deepEqual(tidy.source, { name: 'example-tidy-skill', marketplace: 'https://registry.npmjs.org', version: '1.2.3', claimed: true });
  assert.deepEqual(plan.managed, [{
    catalog: '.bowerloom/managed/catalog/tidy.json', kind: 'skill', id: 'tidy', skill: 'tidy',
    source: { name: 'example-tidy-skill', marketplace: 'https://registry.npmjs.org', version: '1.2.3', claimed: true },
    copies: ['.agents/skills/tidy', '.bowerloom/managed/skills/tidy', '.claude/skills/tidy'], reason: 'Converted into the definition skill tidy.',
  }]);
  await applyAdoption(p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] }), plan.revision, plan.approvalsRequired);
  unchanged(before, snapshot(p.dir), () => true);
  const r = loadDefinition(p.def);
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  // Step 3 contract: the claimed source and the durable record of the conversion are in sources.json.
  assert.deepEqual(r.definition.sources, [{ name: 'example-tidy-skill', marketplace: 'https://registry.npmjs.org', version: '1.2.3', claimed: true, items: [{ part: 'skills', id: 'tidy' }] }]);
  const from = { kind: '0.7-managed', path: '.bowerloom/managed/skills/tidy', sha256: TIDY_HASH };
  assert.deepEqual(r.definition.adopted, [{ part: 'skills', id: 'tidy', adoptedFrom: from }]);
  assert.deepEqual(tidy.adoptedFrom, from);
  assert.equal(r.definition.entries.skills[0].contentHash, `sha256:${TIDY_HASH}`, 'an unchanged copy has the content hash of the definition skill');
  assert.equal(r.definition.harness.parts.plugins, 'sources.json');
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

test('review item K2: a managed copy kept under another id gets no adoptedFrom record, since the record names the copy of its own id', t => {
  const p = project(t, {
    '.bowerloom/managed/catalog/tidy.json': catalog({ harnesses: ['claude'] }),
    '.bowerloom/managed/skills/tidy/SKILL.md': TIDY,
    '.claude/skills/tidy/SKILL.md': TIDY.replace('Tidy the imports.', 'Tidy the imports, edited by hand.'),
  });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }], choices: { 'skills/tidy': { rename: { '.bowerloom/managed/skills/tidy': 'tidy-old' } } } }));
  assert.deepEqual(plan.problems, []);
  assert.equal(item(plan, 'skills', 'tidy-old').adoptedFrom, undefined);
  assert.equal(item(plan, 'skills', 'tidy').adoptedFrom, undefined);
});

test('a git source is recorded by repository and commit; a local source records only the conversion', async t => {
  const git = { kind: 'git', host: 'github.com', repository: 'example/skills', commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
  const p = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog({ source: git, harnesses: ['claude'] }), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const plan = planAdoption(p.input({ engines: [{ id: 'claude-code' }] }));
  assert.deepEqual(item(plan, 'skills', 'tidy').source, { name: 'example/skills', marketplace: 'github.com', version: 'a'.repeat(40), claimed: true });
  const q = project(t, { '.bowerloom/managed/catalog/tidy.json': catalog({ source: { kind: 'local', path: 'skills/tidy' }, harnesses: ['claude'] }), '.bowerloom/managed/skills/tidy/SKILL.md': TIDY });
  const local = planAdoption(q.input({ engines: [{ id: 'claude-code' }] }));
  assert.equal(item(local, 'skills', 'tidy').source, undefined);
  assert.match(local.managed[0].reason, /local/);
  // A local source records no source, but the conversion itself is still recorded.
  assert.deepEqual(item(local, 'skills', 'tidy').adoptedFrom, { kind: '0.7-managed', path: '.bowerloom/managed/skills/tidy', sha256: TIDY_HASH });
  await applyAdoption(q.input({ engines: [{ id: 'claude-code' }] }), local.revision, local.approvalsRequired);
  const d = loadDefinition(q.def).definition;
  assert.deepEqual([d.sources, d.adopted.map(a => a.id)], [[], ['tidy']]);
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
  assert.deepEqual(item(plan, 'skills', 'tidy').adoptedFrom, { kind: '0.7-managed', path: '.bowerloom-skills/skills/tidy', sha256: TIDY_HASH });
  await applyAdoption(p.input({ engines: [{ id: 'claude-code' }] }), plan.revision, plan.approvalsRequired);
  unchanged(before, snapshot(p.dir), () => true);
});

/** A project with one 0.7 managed copy of tidy, projected to Claude Code and Codex, adopted. */
async function adoptedTidy(t, extra = {}) {
  const p = project(t, {
    '.bowerloom/managed/catalog/tidy.json': catalog(),
    '.bowerloom/managed/skills/tidy/SKILL.md': TIDY,
    '.claude/skills/tidy/SKILL.md': TIDY,
    '.agents/skills/tidy/SKILL.md': TIDY,
    ...extra,
  });
  const input = p.input({ engines: [{ id: 'claude-code' }, { id: 'codex' }] });
  const plan = planAdoption(input);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const portable = { projectDir: p.dir, definitionFolder: p.def, stateDir: path.join(p.base, 'state', 'portable') };
  return { p, portable };
}

test('after adoption, the portable projection takes a folder held by a 0.7 managed copy that sources.json records, as a replace; removal restores the 0.7 copy', async t => {
  const { p, portable } = await adoptedTidy(t);
  const before = snapshot(p.dir);
  const plan = planPortable(portable);
  const skillChanges = plan.changes.filter(c => c.path.endsWith('tidy/SKILL.md'));
  assert.deepEqual(skillChanges.map(c => [c.path, c.action, c.original?.sha256]), [
    ['.agents/skills/tidy/SKILL.md', 'replace', sha(TIDY)], ['.claude/skills/tidy/SKILL.md', 'replace', sha(TIDY)],
  ]);
  await applyPortable(portable, plan.revision);
  const removal = planPortableRemoval(portable);
  assert.deepEqual(removal.changes.filter(c => c.path.endsWith('tidy/SKILL.md')).map(c => c.action), ['restore', 'restore']);
  await applyPortableRemoval(portable, removal.revision);
  for (const rel of ['.claude/skills/tidy/SKILL.md', '.agents/skills/tidy/SKILL.md', '.bowerloom/managed/skills/tidy/SKILL.md']) {
    assert.equal(fs.readFileSync(path.join(p.dir, rel), 'utf8'), TIDY, rel);
    assert.equal(snapshot(p.dir)[rel].split(' ')[0], before[rel].split(' ')[0], rel);
  }
});

test('a 0.7 managed folder whose content no longer matches sources.json keeps PORTABLE_MANAGED_COPY', async t => {
  const { p, portable } = await adoptedTidy(t);
  fs.writeFileSync(path.join(p.dir, '.claude/skills/tidy/SKILL.md'), TIDY.replace('Tidy the imports.', 'Tidy the imports, edited after adoption.'));
  assert.throws(() => planPortable(portable), e => e.code === 'PORTABLE_MANAGED_COPY' && e.message.includes('.claude/skills/tidy'));
  // A file added to the copy changes its hash too.
  const q = await adoptedTidy(t);
  fs.writeFileSync(path.join(q.p.dir, '.agents/skills/tidy/extra.md'), 'Extra.\n');
  assert.throws(() => planPortable(q.portable), e => e.code === 'PORTABLE_MANAGED_COPY' && e.message.includes('.agents/skills/tidy'));
});

test('a matching 0.7 folder that holds a file the definition skill no longer has keeps PORTABLE_MANAGED_COPY', async t => {
  const { p, portable } = await adoptedTidy(t, {
    '.bowerloom/managed/skills/tidy/notes.md': 'Notes.\n', '.claude/skills/tidy/notes.md': 'Notes.\n', '.agents/skills/tidy/notes.md': 'Notes.\n',
  });
  fs.rmSync(path.join(p.def, 'skills/tidy/notes.md'));
  assert.throws(() => planPortable(portable), e => e.code === 'PORTABLE_MANAGED_COPY');
});

test('without the sources.json record, a 0.7 managed folder is taken over while it holds the planned bytes, and refuses once they change', async t => {
  const { p, portable } = await adoptedTidy(t);
  const file = path.join(p.def, 'sources.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, json({ sources: value.sources }));
  const before = snapshot(p.dir);
  const plan = planPortable(portable);
  assert.deepEqual(plan.changes.filter(c => c.path.endsWith('tidy/SKILL.md')).map(c => c.action), ['take-over', 'take-over'], 'same bytes: nothing is written');
  await applyPortable(portable, plan.revision);
  for (const rel of ['.claude/skills/tidy/SKILL.md', '.agents/skills/tidy/SKILL.md']) assert.equal(snapshot(p.dir)[rel], before[rel], rel);
  // Changed bytes still refuse.
  const q = await adoptedTidy(t);
  const rec = path.join(q.p.def, 'sources.json');
  fs.writeFileSync(rec, json({ sources: JSON.parse(fs.readFileSync(rec, 'utf8')).sources }));
  fs.writeFileSync(path.join(q.p.dir, '.claude/skills/tidy/SKILL.md'), TIDY + 'Edited.\n');
  assert.throws(() => planPortable(q.portable), e => e.code === 'PORTABLE_MANAGED_COPY');
});
