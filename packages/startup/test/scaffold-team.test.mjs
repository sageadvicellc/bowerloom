import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { scaffold, scaffoldTeam, FIRST_TEAM_ID, TEAM_PATH } from '../../../dist/packages/startup/src/scaffold.js';
import { compileCrew } from '../../../dist/packages/crew/src/index.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const brief = profile => ({ projectName: 'Golden studio', goal: 'Prepare a fictional onboarding kit for an independent design studio.', assistantName: 'Personal assistant', teamName: 'First team', reviewMode: 'milestones', profile });

// sha256 of JSON.stringify(scaffold(brief).files) and of JSON.stringify(...compiled), recorded from a build of commit
// cc117ac (packages/startup, contracts and crew at cc117ac, compiled with this repo's tsc). M2 extracts scaffoldTeam;
// scaffold() must keep every byte, so an installed project's receipt still validates.
const GOLDEN = {
  engineer: { files: '7710a5e254b2f05cfa3e293d3267b064f5065c2dad2797e4b2581bedc5c13197', compiled: '3aa12c0c81f3047c8ff01d403e5b52d1683388553b06ec8526a1cc9cbdd70698' },
  founder: { files: 'e42e43dfa42462f6d104f5cb9d9330c3e4a490ef0f6dc4df3dea7528dc85c07c', compiled: '2be8740d069756a125b68e4ecf9e1ae2b084bb4d260d1294777edfd44420a017' },
  research: { files: 'de67c32f115bc9c3a1496fe32b4481b7595bc1a4fece60ccec7d6758b74fb5fe', compiled: '9f11ede37abbf52e8dbd87aa6a8b0529f864808dedc0f518209583c51882817b' },
};

test('scaffold() bytes for all three profiles equal the golden hashes recorded at cc117ac', () => {
  for (const [profile, golden] of Object.entries(GOLDEN)) {
    const r = scaffold(brief(profile));
    assert.equal(r.files.length, 20, profile);
    assert.equal(sha(JSON.stringify(r.files)), golden.files, `${profile} files`);
    assert.equal(sha(JSON.stringify(r.compiled)), golden.compiled, `${profile} compiled`);
  }
});

test('scaffoldTeam with first-team gives exactly the team scaffold() writes', () => {
  for (const profile of Object.keys(GOLDEN)) {
    const whole = scaffold(brief(profile)), team = scaffoldTeam(brief(profile), FIRST_TEAM_ID, 'First team');
    assert.deepEqual(team.files, whole.files.filter(f => f.path.startsWith('teams/first-team/')), profile);
    assert.deepEqual(team.compiled, whole.compiled, profile);
  }
  assert.equal(FIRST_TEAM_ID, 'first-team'); assert.equal(TEAM_PATH, 'teams/first-team/team.yaml');
});

test('a new team id compiles, under its own folder, with its display name and profile', async t => {
  const team = scaffoldTeam(brief('research'), 'research-desk', 'Research desk');
  assert.ok(team.files.every(f => f.path.startsWith('teams/research-desk/')), JSON.stringify(team.files.map(f => f.path)));
  assert.equal(team.files.length, 10);
  for (const f of team.files) { assert.equal(f.sha256, sha(f.text)); assert.equal(f.bytes, Buffer.byteLength(f.text)); }
  assert.equal(team.compiled.definition.id, 'research-desk');
  assert.match(team.compiled.definition.description, /^Research desk: /);
  assert.equal(JSON.parse(team.files.find(f => f.path.endsWith('assets/brief.json')).text).teamName, 'Research desk');
  // Written to disk, the team compiles to the same plan.
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-scaffold-team-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const f of team.files) { fs.mkdirSync(dirname(join(root, f.path)), { recursive: true }); fs.writeFileSync(join(root, f.path), f.text); }
  assert.deepEqual(await compileCrew(join(root, 'teams/research-desk/team.yaml')), team.compiled);
  // Another profile gives other prompts.
  assert.notDeepEqual(scaffoldTeam(brief('engineer'), 'research-desk', 'Research desk').files, team.files);
});

test('scaffoldTeam refuses an id that is not a plain id, and an empty display name', () => {
  for (const id of ['', 'Bad', 'a b', '../x', 'x/y', '-x', 'x-', 'a--b', 'x'.repeat(65), 7]) assert.throws(() => scaffoldTeam(brief('engineer'), id, 'Name'), String(id));
  assert.throws(() => scaffoldTeam(brief('engineer'), 'ok', '  '));
});
