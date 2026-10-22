import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { STORE_BRIEF, storeBrief } from '../../../dist/packages/project-config/src/brief.js';
import { startupInternals } from '../../../dist/packages/startup/src/index.js';
import { scaffoldTeam } from '../../../dist/packages/startup/src/scaffold.js';

const digestOf = files => /Brief\s+sha256:([a-f0-9]{64})/.exec(files.find(f => f.path.endsWith('/team.yaml')).text)?.[1];

test('storeBrief defaults the profile to engineer and keeps a given profile', () => {
  assert.equal(storeBrief(undefined).profile, 'engineer');
  assert.equal(storeBrief('founder').profile, 'founder');
  assert.equal(storeBrief('research').teamName, 'Store team');
  assert.ok(Object.isFrozen(STORE_BRIEF));
  assert.deepEqual(storeBrief('founder'), { ...STORE_BRIEF, profile: 'founder' });
  assert.equal(Object.isFrozen(storeBrief('founder')), false, 'a caller may not mutate the shared constant through the result');
  storeBrief('founder').goal = 'changed';
  assert.equal(STORE_BRIEF.goal, 'A team kept in the Bowerloom store. A project that selects it sets its own goal.');
});

test('startup normalize accepts the same fields with a safe target and returns them unchanged', () => {
  const brief = storeBrief('research');
  const out = startupInternals.normalize({ mode: 'new', targetDir: path.join(os.tmpdir(), 'bowerloom-brief-safe'), brief });
  assert.deepEqual(out.brief, brief);
});

test('scaffoldTeam from the store brief writes only under teams/<id>/ and compiles the same twice', () => {
  const a = scaffoldTeam(storeBrief('research'), 'x', 'x'), b = scaffoldTeam(storeBrief('research'), 'x', 'x');
  assert.ok(a.files.length > 0);
  assert.ok(a.files.every(f => f.path.startsWith('teams/x/')));
  assert.equal(a.compiled.candidateRevision, b.compiled.candidateRevision);
  assert.match(a.compiled.candidateRevision, /^sha256:[a-f0-9]{64}$/);
});

test('the brief digest changes with the profile and with the team id, and not with the machine', () => {
  const research = digestOf(scaffoldTeam(storeBrief('research'), 'x', 'x').files);
  assert.match(research, /^[a-f0-9]{64}$/);
  assert.notEqual(research, digestOf(scaffoldTeam(storeBrief('founder'), 'x', 'x').files));
  assert.notEqual(research, digestOf(scaffoldTeam(storeBrief('research'), 'y', 'y').files));
  assert.equal(research, digestOf(scaffoldTeam(storeBrief('research'), 'x', 'x').files));
});
