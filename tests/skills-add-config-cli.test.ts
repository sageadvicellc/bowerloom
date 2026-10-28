// Spec 06, 3.8 rule 9 and decision 12, through the real binary: skills add (no --global) in a folder that holds only
// bowerloom.json makes .bowerloom, adds the skills.json entry and the { id, source: "project" } entry in one plan.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { world, run, approve, errorCode, project, network, NETWORK, EMPTY_CONFIG } from './support/config-cli.js';
import type { World } from './support/config-cli.js';

const fixtures = fileURLToPath(new URL('../../packages/skill-manifest/test/fixtures/', import.meta.url));
const SPEC = 'npm:@synthetic/db-skills@0.0.1:skills/synthetic-db/collections', ID = 'synthetic-db-collections';
const npm = (w: World) => network(w, {
  'https://registry.npmjs.org/@synthetic/db-skills/0.0.1': join(fixtures, 'npm-db-skills', 'metadata.json'),
  'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz': join(fixtures, 'npm-db-skills', 'archive.tgz'),
}).env;
const config = (dir: string) => JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')) as { skills: unknown[] };

test('rule 9: the plan in a config-only folder creates .bowerloom and lists both entries, and writes nothing', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  const r = run(dir, ['skills', 'add', SPEC], npm(w), NETWORK);
  assert.equal(r.status, 3, r.stderr + r.stdout);
  assert.match(r.stdout, /^Create \.bowerloom, the folder of this project's items\. Commit the files this writes there\.$/m);
  assert.match(r.stdout, new RegExp(`^bowerloom\\.json adds: skill ${ID} \\(project\\)$`, 'm'));
  assert.equal(existsSync(join(dir, '.bowerloom')), false);
  assert.deepEqual(config(dir).skills, []);
});

test('rule 9: approving makes .bowerloom with mode 0755, the skills.json entry, and the config entry', t => {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG), env = npm(w);
  const { applied } = approve(dir, ['skills', 'add', SPEC], env, NETWORK);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.equal(statSync(join(dir, '.bowerloom')).mode & 0o777, 0o755);
  assert.deepEqual((JSON.parse(readFileSync(join(dir, '.bowerloom/skills.json'), 'utf8')) as { skills: { id: string }[] }).skills.map(s => s.id), [ID]);
  assert.deepEqual(config(dir).skills, [{ id: ID, source: 'project' }]);
});

test('rule 9: an id the config lists from the store refuses CONFIG_DUPLICATE_ID and writes nothing', t => {
  const w = world(t), dir = project(w, 'app', { ...EMPTY_CONFIG, skills: [{ id: ID, source: 'store' }] });
  const r = run(dir, ['skills', 'add', SPEC, '--json'], npm(w), NETWORK);
  assert.equal(errorCode(r.stderr), 'CONFIG_DUPLICATE_ID'); assert.equal(existsSync(join(dir, '.bowerloom')), false);
});

test('rule 9: a config at its skill limit refuses CONFIG_LIMIT and writes nothing', t => {
  const w = world(t), dir = project(w, 'app', { ...EMPTY_CONFIG, skills: Array.from({ length: 128 }, (_, i) => ({ id: `s-${String(i).padStart(3, '0')}`, source: 'project' })) });
  const r = run(dir, ['skills', 'add', SPEC, '--json'], npm(w), NETWORK);
  assert.equal(errorCode(r.stderr), 'CONFIG_LIMIT'); assert.equal(existsSync(join(dir, '.bowerloom')), false);
});

// Review of e1bbce9, CR2: skills add writes bowerloom.json back in the form it was read in.
for (const oldForm of [true, false]) test(`CR2. skills add keeps the ${oldForm ? 'old' : 'current'} form of bowerloom.json`, t => {
  const w = world(t), start = oldForm ? EMPTY_CONFIG : { format: 'bowerloom/project/v1beta1', engines: ['claude-code', 'codex'], skills: [], prompts: [], teams: [] };
  const dir = project(w, 'app', start), env = npm(w);
  const { applied } = approve(dir, ['skills', 'add', SPEC], env, NETWORK);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const raw = JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')) as { engines?: string[]; harnesses?: string[]; skills: unknown[] };
  assert.deepEqual(oldForm ? raw.harnesses : raw.engines, oldForm ? ['claude', 'codex'] : ['claude-code', 'codex']);
  assert.equal(oldForm ? raw.engines : raw.harnesses, undefined);
  assert.deepEqual(raw.skills, [{ id: ID, source: 'project' }]);
});
