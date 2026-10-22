// Spec 01a, section 10.3: the authoring owner treats a team's agents/ folder as hand-placed user content.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStartup, applyStartup, inspectStartup } from '../../../dist/packages/startup/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate, authoringVerifier, manifestVerifier } from '../../../dist/packages/project-authoring/src/index.js';

const signal = () => new AbortController().signal;
async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-agents-owner-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  const team = { kind: 'team', project: dir, name: 'desk', profile: 'research' };
  await withProjectLock(dir, signal(), async held => applyCreate(team, (await planCreate(team)).revision, held));
  return { dir, bowerloom: join(dir, '.bowerloom') };
}
const agent = (role, extra = '') => `---\nname: ${role}\ndescription: ${role} helps.\n${extra ? extra + '\n' : ''}---\nBody.\n`;
function place(p, team, entry, text, mode = 0o644) {
  const dir = join(p.bowerloom, 'teams', team, 'agents'); fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  const file = join(dir, entry); fs.writeFileSync(file, text, { mode }); fs.chmodSync(file, mode); return file;
}
const verify = (p, path) => authoringVerifier(p.dir).verify(path, 'directory', signal());

test('a registered team with a valid agents folder is verified, not edited', async t => {
  const p = await project(t);
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'verified' });
  place(p, 'desk', 'scribe.md', agent('scribe', 'tools: Read')); place(p, 'desk', 'editor.md', agent('editor'));
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'verified' });
});

test('a bad agent file refuses the team folder with AGENT_INVALID, for each of the three parse codes', async t => {
  const p = await project(t);
  for (const [entry, text] of [['typo.md', agent('typo', 'tool: x')], ['mismatch.md', agent('other')], ['broken.md', 'no frontmatter'], ['Capital.md', agent('Capital')], ['notes.txt', 'x']]) {
    const file = place(p, 'desk', entry, text);
    assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AGENT_INVALID' }, entry); fs.rmSync(file);
  }
  fs.mkdirSync(join(p.bowerloom, 'teams/desk/agents/folder.md')); assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AGENT_INVALID' }); fs.rmdirSync(join(p.bowerloom, 'teams/desk/agents/folder.md'));
  fs.writeFileSync(join(p.dir, 'outside.md'), agent('linked')); fs.symlinkSync(join(p.dir, 'outside.md'), join(p.bowerloom, 'teams/desk/agents/linked.md'));
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AGENT_INVALID' }); fs.unlinkSync(join(p.bowerloom, 'teams/desk/agents/linked.md'));
  place(p, 'desk', 'ok.md', agent('ok')); assert.deepEqual(await verify(p, 'teams/desk'), { result: 'verified' });
  place(p, 'desk', 'bom.md', '\uFEFF' + agent('bom')); assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AGENT_INVALID' });
});

test('an agents folder that is a link, or that others can write, is AUTHORING_UNSAFE_PATH', async t => {
  const p = await project(t); place(p, 'desk', 'scribe.md', agent('scribe'));
  fs.chmodSync(join(p.bowerloom, 'teams/desk/agents'), 0o777);
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
  fs.chmodSync(join(p.bowerloom, 'teams/desk/agents'), 0o755);
  fs.renameSync(join(p.bowerloom, 'teams/desk/agents'), join(p.dir, 'elsewhere')); fs.symlinkSync(join(p.dir, 'elsewhere'), join(p.bowerloom, 'teams/desk/agents'));
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
});

test('agent files do not count toward the 256-entry limit of a team folder', async t => {
  const p = await project(t);
  for (let i = 0; i < 250; i++) place(p, 'desk', `agent-${String(i).padStart(3, '0')}.md`, agent(`agent-${String(i).padStart(3, '0')}`));
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'verified' });
});

test('a change outside agents/ still makes the team edited', async t => {
  const p = await project(t); place(p, 'desk', 'scribe.md', agent('scribe'));
  fs.appendFileSync(join(p.bowerloom, 'teams/desk/team.yaml'), '\n# my note\n');
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'edited' });
  fs.writeFileSync(join(p.bowerloom, 'teams/desk/extra.md'), 'x'); assert.deepEqual(await verify(p, 'teams/desk'), { result: 'edited' });
});

test('the owner claims teams/first-team/agents and verifies it as a team folder', async t => {
  const p = await project(t), owner = authoringVerifier(p.dir);
  assert.equal(owner.claims('teams/first-team/agents', 'directory'), true); assert.equal(owner.claims('teams/first-team/agents', 'file'), false);
  assert.equal(owner.claims('teams/first-team', 'directory'), false); assert.equal(owner.claims('teams/first-team/extra', 'directory'), false); assert.equal(owner.claims('teams/desk/agents', 'directory'), false);
  place(p, 'first-team', 'helper.md', agent('helper'));
  assert.deepEqual(await verify(p, 'teams/first-team/agents'), { result: 'verified' });
  place(p, 'first-team', 'bad.md', 'nope');
  assert.deepEqual(await verify(p, 'teams/first-team/agents'), { result: 'refused', code: 'AGENT_INVALID' });
});

test('inspectStartup with owners names a bad agent file as owner-refused on the team folder', async t => {
  const p = await project(t); place(p, 'desk', 'typo.md', agent('typo', 'tool: x'));
  const result = await inspectStartup(p.dir, { owners: [authoringVerifier(p.dir), manifestVerifier(p.dir)] });
  assert.deepEqual(result.drift, [{ path: '.bowerloom/teams/desk', kind: 'owner-refused', code: 'AGENT_INVALID' }]);
});

test('D1: hidden and editor files in agents/ change nothing', async t => {
  const p = await project(t); place(p, 'desk', 'scribe.md', agent('scribe'));
  for (const name of ['.DS_Store', '.foo.md.swp', 'foo.md~', '.hidden.md']) place(p, 'desk', name, 'junk');
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'verified' });
  place(p, 'first-team', 'helper.md', agent('helper')); place(p, 'first-team', '.DS_Store', 'junk'); place(p, 'first-team', 'helper.md~', 'junk');
  assert.deepEqual(await verify(p, 'teams/first-team/agents'), { result: 'verified' });
});

test('F5: an unsafe agent file is AUTHORING_UNSAFE_PATH, not AGENT_INVALID', async t => {
  const p = await project(t); place(p, 'desk', 'scribe.md', agent('scribe'), 0o664);
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
});

test('S8: an Agents folder is skipped from the edited comparison as agents is', async t => {
  const p = await project(t); place(p, 'desk', 'scribe.md', agent('scribe'));
  fs.renameSync(join(p.bowerloom, 'teams/desk/agents'), join(p.bowerloom, 'teams/desk/Agents-tmp')); fs.renameSync(join(p.bowerloom, 'teams/desk/Agents-tmp'), join(p.bowerloom, 'teams/desk/Agents'));
  assert.deepEqual(await verify(p, 'teams/desk'), { result: 'verified' });
});
