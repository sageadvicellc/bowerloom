import '../../../dist/tests/support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { denyNetwork } from './support/fixtures.mjs';
import { npmCollections, gitVerificationLoop, privateFolder } from './support/expected.mjs';
import { parseManifest, serializeManifest, MANIFEST_FORMAT } from '../../../dist/packages/skill-manifest/src/schema.js';
import { toNpmRequest, toGitRequest } from '../../../dist/packages/skill-manifest/src/requests.js';
import { parseSkillSpec } from '../../../dist/packages/skill-manifest/src/spec.js';
import { planNpmAcquisition } from '../../../dist/packages/skill-sources/src/npm.js';
import { planGitAcquisition } from '../../../dist/packages/skill-sources/src/git.js';
import { observeSkillCacheRoot } from '../../../dist/packages/skill-sources/src/cache.js';

const network = denyNetwork();
test.after(() => assert.deepEqual(network, [], 'no test in this file touches the network'));
const code = expected => error => error?.code === expected && error.message.length > 0 && !/PRIVATE|synthetic-owner/.test(error.message);

function sample() {
  return {
    format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'],
    skills: [
      { id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } },
      { id: 'synthetic-db-collections', teams: ['first-team'], ...npmCollections() },
      { id: 'verification-loop', ...gitVerificationLoop() },
    ],
  };
}
// The canonical bytes: fixed key order, entries sorted by id, 2-space indent and a final newline.
const canonical = m => JSON.stringify(m, null, 2) + '\n';
const bytes = value => Buffer.from(typeof value === 'string' ? value : canonical(value));
const parsing = mutate => { const m = sample(); mutate(m); return () => parseManifest(bytes(m)); };

test('the canonical sample parses, and serialize after parse gives the same bytes', () => {
  const text = canonical(sample()), m = parseManifest(Buffer.from(text));
  assert.equal(MANIFEST_FORMAT, 'bowerloom/skills/v1beta1');
  assert.equal(m.skills.length, 3); assert.deepEqual(m.harnesses, ['claude', 'codex']);
  assert.equal(serializeManifest(m), text);
  assert.equal(serializeManifest(parseManifest(Buffer.from(serializeManifest(m)))), text);
  assert.ok(Object.isFrozen(m) && Object.isFrozen(m.skills[1].files[0]));
});

test('serialize is canonical: entries by id, files by path, fixed key order, whatever order the input had', () => {
  const m = sample(); m.skills.reverse(); m.skills[1].files.reverse(); m.skills[1].references.reverse();
  const reordered = { skills: m.skills, harnesses: m.harnesses, format: m.format };
  const shuffled = JSON.stringify(reordered, (key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
  assert.equal(serializeManifest(parseManifest(Buffer.from(shuffled))), canonical(sample()));
});

test('ranges, tags, latest, partial versions, branches and short or upper-case SHAs are not exact pins', () => {
  for (const version of ['^0.0.1', '~0.0.1', 'latest', '1.2', '1', 'v0.0.1', '>=0.0.1', '0.0.1 || 0.0.2', '*', 'x', '0.0.x', '01.0.0', '0.0.1+build', 'next']) {
    assert.throws(parsing(m => { m.skills[1].source.version = version; }), code('MANIFEST_PIN_NOT_EXACT'), version);
  }
  for (const commit of ['main', 'v1.0.0', 'c0ffee0', 'C0FFEE00C0FFEE00C0FFEE00C0FFEE00C0FFEE00', 'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee0', 'HEAD', 'refs/heads/main']) {
    assert.throws(parsing(m => { m.skills[2].source.commit = commit; }), code('MANIFEST_PIN_NOT_EXACT'), commit);
  }
  assert.throws(parsing(m => { m.skills[2].source.tree = 'abc123'; }), code('MANIFEST_PIN_NOT_EXACT'));
  assert.throws(parsing(m => { m.skills[2].source.pathTrees[0] = 'main'; }), code('MANIFEST_PIN_NOT_EXACT'));
  // A prerelease version is exact.
  assert.doesNotThrow(() => parseManifest(Buffer.from(canonical(sample()).replace('"version": "0.0.1"', '"version": "0.0.1-beta.2"'))));
});

test('duplicate keys, unknown keys, bad encodings and wrong shapes are invalid', () => {
  const text = canonical(sample());
  assert.throws(() => parseManifest(Buffer.from(text.replace('"id": "house-style",', '"id": "house-style", "id": "house-style",'))), code('MANIFEST_INVALID'));
  assert.throws(() => parseManifest(Buffer.from(text.replace('"harnesses"', '"harnesses": ["codex"], "harnesses"'))), code('MANIFEST_INVALID'));
  for (const mutate of [m => { m.extra = 1; }, m => { m.skills[0].note = 'x'; }, m => { m.skills[1].source.archiveSha256 = 'a'.repeat(64); }, m => { m.skills[1].skill.id = 'x'; }, m => { m.skills[1].files[0].mode = 420; }, m => { m.skills[1].license.origin = 'included'; }, m => { m.format = 'bowerloom/skills/v1beta2'; }]) {
    assert.throws(parsing(mutate), code('MANIFEST_INVALID'));
  }
  for (const raw of ['﻿' + text, '', 'null', '[]', '{}', text.slice(0, -10)]) assert.throws(() => parseManifest(Buffer.from(raw)), code('MANIFEST_INVALID'));
  assert.throws(() => parseManifest(Buffer.concat([Buffer.from(text.slice(0, 20)), Buffer.from([0xc3, 0x28]), Buffer.from(text.slice(20))])), code('MANIFEST_INVALID'));
  assert.throws(() => parseManifest('not a buffer'), code('MANIFEST_INVALID'));
});

test('harnesses are a sorted, unique, non-empty subset of claude and codex', () => {
  for (const harnesses of [[], ['codex', 'claude'], ['claude', 'claude'], ['cursor'], 'claude']) assert.throws(parsing(m => { m.harnesses = harnesses; }), code('MANIFEST_INVALID'), JSON.stringify(harnesses));
  for (const harnesses of [['claude'], ['codex']]) assert.equal(parseManifest(bytes({ ...sample(), harnesses })).harnesses.length, 1);
});

test('ids are unique, well formed, at most 64 characters, and not reserved', () => {
  assert.throws(parsing(m => { m.skills[0].id = 'synthetic-db-collections'; m.skills[0].source.path = 'skills/synthetic-db-collections'; }), code('MANIFEST_DUPLICATE_ID'));
  for (const id of ['personal-assistant', 'prompt-review', 'Upper', 'a--b', '-a', 'a_b', 'a'.repeat(65), '']) {
    assert.throws(parsing(m => { m.skills[0].id = id; m.skills[0].source.path = `skills/${id}`; }), code('MANIFEST_INVALID'), id);
  }
  assert.doesNotThrow(parsing(m => { m.skills[0].id = 'a'.repeat(64); m.skills[0].source.path = `skills/${'a'.repeat(64)}`; }));
});

test('teams are optional; when present they are unique team ids', () => {
  assert.equal(parseManifest(bytes(sample())).skills[0].teams, undefined);
  for (const teams of [[], ['first-team', 'first-team'], ['Bad Team'], 'first-team']) assert.throws(parsing(m => { m.skills[1].teams = teams; }), code('MANIFEST_INVALID'), JSON.stringify(teams));
  assert.deepEqual(parseManifest(bytes((() => { const m = sample(); m.skills[1].teams = ['writers', 'first-team']; return m; })())).skills[1].teams, ['first-team', 'writers']);
});

test('only MIT and Apache-2.0 are accepted', () => {
  for (const spdx of ['GPL-3.0', 'GPL-3.0-only', 'BSD-3-Clause', 'ISC', 'MIT OR GPL-3.0', 'mit', 'UNLICENSED']) assert.throws(parsing(m => { m.skills[1].license.spdx = spdx; }), code('MANIFEST_LICENSE_UNSUPPORTED'), spdx);
  assert.throws(parsing(m => { m.skills[2].license.spdx = 'AGPL-3.0'; }), code('MANIFEST_LICENSE_UNSUPPORTED'));
});

test('absolute paths, traversal, hidden segments and a local path other than skills/<id> are invalid', () => {
  for (const mutate of [
    m => { m.skills[1].skill.sourceRoot = '/skills/synthetic-db/collections'; },
    m => { m.skills[1].files[1].path = '../SKILL.md'; },
    m => { m.skills[1].files[1].sourcePath = 'skills/synthetic-db/collections/../../SKILL.md'; },
    m => { m.skills[1].files[1].path = '/etc/passwd'; },
    m => { m.skills[1].license.files = ['/LICENSE']; },
    m => { m.skills[1].references[0].to = '../outside.md'; },
    m => { m.skills[1].skill.sourceRoot = '.claude/skills/x'; },
    m => { m.skills[0].source.path = 'skills/other'; },
    m => { m.skills[0].source.path = '/abs/skills/house-style'; },
    m => { m.skills[0].source.path = 'skills/../skills/house-style'; },
    m => { m.skills[0].skill = { name: 'house-style', sourceRoot: 'skills/house-style' }; },
    m => { m.skills[0].files = []; },
    m => { m.skills[1].source.registry = 'https://registry.example.com'; },
    m => { m.skills[2].source.host = 'gitlab.com'; },
    m => { m.skills[2].source.repository = 'Synthetic-Owner/skills-repo'; },
    m => { m.skills[2].source.pathTrees = m.skills[2].source.pathTrees.slice(1); },
    m => { m.skills[1].files[1].sha256 = 'abc'; },
    m => { m.skills[1].files[1].bytes = 0; },
    m => { m.skills[1].skill.name = 'Bad Name'; },
  ]) assert.throws(parsing(mutate), code('MANIFEST_INVALID'), mutate.toString());
});

test('at most 32 skills and 1 MiB', () => {
  const many = n => { const m = sample(); m.skills = Array.from({ length: n }, (_, i) => ({ id: `local-${String(i).padStart(2, '0')}`, source: { kind: 'local', path: `skills/local-${String(i).padStart(2, '0')}` } })); return m; };
  assert.equal(parseManifest(bytes(many(32))).skills.length, 32);
  assert.equal(parseManifest(bytes(many(0))).skills.length, 0);
  assert.throws(() => parseManifest(bytes(many(33))), code('MANIFEST_LIMIT'));
  assert.throws(() => parseManifest(Buffer.concat([bytes(sample()), Buffer.alloc(1024 * 1024, 0x20)])), code('MANIFEST_LIMIT'));
});

test('each pinned entry maps onto a request the existing acquisition planners accept', t => {
  const binding = observeSkillCacheRoot(privateFolder(t), 'a'.repeat(32), 12582912);
  const m = parseManifest(bytes(sample()));
  const npm = toNpmRequest(m.skills[1]);
  assert.equal(npm.declaredLicense, 'MIT'); assert.equal(npm.license.origin, 'included'); assert.deepEqual(npm.skill, { id: 'synthetic-db-collections', name: 'synthetic-db-collections', sourceRoot: 'skills/synthetic-db/collections' });
  assert.ok(npm.files.every(f => f.mode === 420)); assert.equal('registry' in npm, false); assert.equal('kind' in npm, false); assert.equal('teams' in npm, false);
  const npmPlan = planNpmAcquisition(npm, binding);
  assert.equal(npmPlan.metadataUrl, 'https://registry.npmjs.org/@synthetic/db-skills/0.0.1');
  assert.equal(npmPlan.archiveUrl, 'https://registry.npmjs.org/@synthetic/db-skills/-/db-skills-0.0.1.tgz');
  const git = toGitRequest(m.skills[2]);
  assert.equal(git.declaredLicense, 'MIT'); assert.equal('host' in git, false); assert.equal(git.skill.id, 'verification-loop');
  const gitPlan = planGitAcquisition(git, binding);
  assert.equal(gitPlan.metadataUrl, `https://api.github.com/repos/synthetic-owner/skills-repo/git/commits/${m.skills[2].source.commit}`);
  // The entry id, not the skill name, becomes skill.id.
  const renamed = parseManifest(bytes((() => { const s = sample(); s.skills[1].id = 'collections'; return s; })()));
  assert.deepEqual(toNpmRequest(renamed.skills.find(e => e.id === 'collections')).skill, { id: 'collections', name: 'synthetic-db-collections', sourceRoot: 'skills/synthetic-db/collections' });
  assert.throws(() => toNpmRequest(m.skills[2]), code('MANIFEST_INVALID')); assert.throws(() => toGitRequest(m.skills[0]), code('MANIFEST_INVALID'));
});

test('a license outside the skill folder maps faithfully: npm only in the skill folder\'s parent chain, Git only beside a walked tree', t => {
  const binding = observeSkillCacheRoot(privateFolder(t), 'b'.repeat(32), 12582912);
  const m = sample();
  assert.equal(m.skills[1].files[0].sourcePath, 'LICENSE');
  assert.doesNotThrow(() => planNpmAcquisition(toNpmRequest(parseManifest(bytes(m)).skills[1]), binding));
  // npm: a license in a folder that is not above the skill is refused (review M3 finding 2), as for Git.
  const npmOff = sample(); npmOff.skills[1].files[0].sourcePath = 'docs/LICENSE';
  assert.throws(() => parseManifest(bytes(npmOff)), code('MANIFEST_INVALID'));
  // Git: a license beside the skill's own path is accepted by the parser; one in an unrelated folder is not.
  const off = sample(); off.skills[2].files[0].sourcePath = 'docs/LICENSE';
  assert.throws(() => parseManifest(bytes(off)), code('MANIFEST_INVALID'));
});

test('skill specs: npm takes a path the same shape as GitHub, and a scoped package is unambiguous', () => {
  assert.deepEqual(parseSkillSpec('npm:@tanstack/db-skills@0.0.1:skills/tanstack-db/collections'), { kind: 'npm', package: '@tanstack/db-skills', version: '0.0.1', path: 'skills/tanstack-db/collections' });
  assert.deepEqual(parseSkillSpec('npm:db-skills@1.4.2-beta.1:skills/report'), { kind: 'npm', package: 'db-skills', version: '1.4.2-beta.1', path: 'skills/report' });
  assert.deepEqual(parseSkillSpec('github:affaan-m/ecc@ef648e01ef648e01ef648e01ef648e01ef648e01:skills/verification-loop'), { kind: 'github', repository: 'affaan-m/ecc', commit: 'ef648e01ef648e01ef648e01ef648e01ef648e01', path: 'skills/verification-loop' });
  for (const spec of ['npm:@tanstack/db-skills@^0.0.1:skills/x', 'npm:@tanstack/db-skills@latest:skills/x', 'npm:@tanstack/db-skills@~0.0.1:skills/x', 'npm:db-skills@1.2:skills/x', 'npm:db-skills@:skills/x', 'npm:db-skills@>=1.0.0:skills/x', 'npm:db-skills@v1.0.0:skills/x',
    'github:o/r@main:skills/x', 'github:o/r@v1.0.0:skills/x', 'github:o/r@c0ffee0:skills/x', 'github:o/r@C0FFEE00C0FFEE00C0FFEE00C0FFEE00C0FFEE00:skills/x', 'github:o/r@:skills/x']) {
    assert.throws(() => parseSkillSpec(spec), code('MANIFEST_PIN_NOT_EXACT'), spec);
  }
  for (const spec of ['npm:@tanstack/db-skills@0.0.1', 'npm:@tanstack/db-skills@0.0.1:', 'github:o/r@' + 'a'.repeat(40), 'github:o/r@' + 'a'.repeat(40) + ':',
    'npm:@tanstack/db-skills', 'npm:@tanstack@0.0.1:skills/x', 'npm:@/db@0.0.1:skills/x', 'npm:@a/b/c@0.0.1:skills/x', 'npm:Upper@0.0.1:skills/x', 'npm:a@0.0.1:skills/x:y', 'npm:a@0.0.1:../x', 'npm:a@0.0.1:/abs', 'npm:a@0.0.1:skills//x', 'npm:a@0.0.1:skills/.hidden',
    'npm:a@0.0.1:skills/x/', 'npm:a@0.0.1:' + Array(10).fill('d').join('/'), 'github:o@' + 'a'.repeat(40) + ':skills/x', 'github:o/r/x@' + 'a'.repeat(40) + ':skills/x', 'github:Owner/r@' + 'a'.repeat(40) + ':skills/x', 'github:o/r.git@' + 'a'.repeat(40) + ':skills/x',
    'pypi:x@1.0.0:skills/x', 'git:o/r@' + 'a'.repeat(40) + ':skills/x', 'https://github.com/o/r', 'NPM:a@0.0.1:skills/x', ' npm:a@0.0.1:skills/x', 'npm:a@0.0.1:skills/x\n', '', 'npm:a@0.0.1:skills/‮x', 'x'.repeat(2000)]) {
    assert.throws(() => parseSkillSpec(spec), code('SKILLS_ADD_SPEC_INVALID'), JSON.stringify(spec));
  }
  assert.throws(() => parseSkillSpec(42), code('SKILLS_ADD_SPEC_INVALID'));
});
