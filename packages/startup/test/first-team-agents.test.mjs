// Spec 01a, section 10.4: teams/first-team/agents is a user area; the startup record claims no content of it.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { planStartup, applyStartup, inspectStartup, planStartupRevision } from '../../../dist/packages/startup/src/index.js';
import { authoringVerifier, manifestVerifier } from '../../../dist/packages/project-authoring/src/index.js';

async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-first-team-agents-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  return { dir, parent, bowerloom: join(dir, '.bowerloom'), input };
}
const agent = role => `---\nname: ${role}\ndescription: ${role} helps.\n---\nBody.\n`;
function place(p, entry, text) {
  const dir = join(p.bowerloom, 'teams/first-team/agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 }); fs.writeFileSync(join(dir, entry), text, { mode: 0o644 }); fs.chmodSync(join(dir, entry), 0o644);
}
const owners = p => [authoringVerifier(p.dir), manifestVerifier(p.dir)];
function tree(dir) {
  const out = {};
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String).sort()) { const s = fs.lstatSync(join(dir, rel)); out[rel] = s.isFile() ? createHash('sha256').update(fs.readFileSync(join(dir, rel))).digest('hex') : s.isSymbolicLink() ? 'link' : 'dir'; }
  return JSON.stringify(out);
}

test('without owners, an agents folder in first-team is no drift and the project stays spec ready', async t => {
  const p = await project(t); place(p, 'helper.md', agent('helper'));
  const result = await inspectStartup(p.dir), bare = await inspectStartup((await project(t)).dir);
  assert.deepEqual(result.drift, []); assert.equal(result.specReady, true); assert.equal(result.status, bare.status);
});

test('with owners, the folder is verified, and a bad file is owner-refused with AGENT_INVALID', async t => {
  const p = await project(t); place(p, 'helper.md', agent('helper'));
  const ok = await inspectStartup(p.dir, { owners: owners(p) });
  assert.deepEqual(ok.drift, []); assert.deepEqual(ok.owned, [{ path: '.bowerloom/teams/first-team/agents', owner: 'authoring', state: 'verified' }]);
  place(p, 'bad.md', 'not an agent');
  const bad = await inspectStartup(p.dir, { owners: owners(p) });
  assert.deepEqual(bad.drift, [{ path: '.bowerloom/teams/first-team/agents', kind: 'owner-refused', code: 'AGENT_INVALID' }]);
});

test('a link at teams/first-team/agents is unsafe with owners and unexpected without', async t => {
  const p = await project(t); fs.mkdirSync(join(p.dir, 'elsewhere')); fs.symlinkSync(join(p.dir, 'elsewhere'), join(p.bowerloom, 'teams/first-team/agents'));
  assert.deepEqual((await inspectStartup(p.dir, { owners: owners(p) })).drift, [{ path: '.bowerloom/teams/first-team/agents', kind: 'unsafe' }]);
  assert.deepEqual((await inspectStartup(p.dir)).drift, [{ path: '.bowerloom/teams/first-team/agents', kind: 'unexpected' }]);
});

test('a neighbor folder in first-team is still unexpected', async t => {
  const p = await project(t); place(p, 'helper.md', agent('helper')); fs.mkdirSync(join(p.bowerloom, 'teams/first-team/extra'));
  assert.deepEqual((await inspectStartup(p.dir)).drift, [{ path: '.bowerloom/teams/first-team/extra', kind: 'unexpected' }]);
  assert.deepEqual((await inspectStartup(p.dir, { owners: owners(p) })).drift, [{ path: '.bowerloom/teams/first-team/extra', kind: 'unexpected' }]);
});

test('the agents folder is one entry for the 256-entry counter', async t => {
  const p = await project(t);
  for (let i = 0; i < 100; i++) place(p, `agent-${String(i).padStart(3, '0')}.md`, agent(`agent-${String(i).padStart(3, '0')}`));
  const result = await inspectStartup(p.dir); assert.deepEqual(result.drift, []);
});

test('revise plan on such a project refuses and writes nothing: REVISION_DRIFT for a private folder, a private-folder refusal for a hand-made one', async t => {
  const p = await project(t); place(p, 'helper.md', agent('helper')); const before = tree(p.dir), brief = { ...p.input.brief, goal: 'A new goal for the studio kit.' };
  // A folder made with mkdir is mode 0755, and the revision inventory asks for private folders first.
  await assert.rejects(planStartupRevision({ targetDir: p.dir, brief }), e => e.code === 'REVISION_PRIVATE_DIRECTORY_REQUIRED');
  assert.equal(tree(p.dir), before);
  // A private folder is one the receipt does not list, so the inventory refuses it as drift, as it does for created content.
  fs.chmodSync(join(p.bowerloom, 'teams/first-team/agents'), 0o700); const second = tree(p.dir);
  await assert.rejects(planStartupRevision({ targetDir: p.dir, brief }), e => e.code === 'REVISION_DRIFT');
  assert.equal(tree(p.dir), second);
});
