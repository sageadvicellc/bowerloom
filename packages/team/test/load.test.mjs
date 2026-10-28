// Teams and relay spec, sections 4, 5.1, 8, and 9; acceptance checks 1, 2, 3, 5, and 6 of section 11.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { entryHash } from '../../../dist/packages/harness-definition/src/index.js';
import { RELAY_MAP_FORMAT, TEAM_FORMAT, loadTeam } from '../../../dist/packages/team/src/index.js';
import {
  CREW_YAML, NOW, approval, cleanup, codes, json, loaded, makeTeam, member, relayMap, route, rule, snapshot, teamFile, withRelay,
} from './fixture.mjs';

test.after(cleanup);

const ok = (files, options = {}) => {
  const { folder } = makeTeam(files);
  const r = loadTeam(folder, options);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.team;
};
const refused = (files, code, options = {}) => {
  const { folder } = makeTeam(files);
  const r = loadTeam(folder, options);
  assert.equal(r.ok, false, `expected ${code}`);
  assert.ok(codes(r).includes(code), `expected ${code}, got ${JSON.stringify(r.problems)}`);
  for (const p of r.problems) {
    assert.equal(typeof p.path, 'string');
    assert.ok(typeof p.message === 'string' && p.message.length > 0);
  }
  return r.problems;
};
const only = team => ({ 'team.json': json(team) });

test('the format names are the ones of the spec and the 0.7 relay map', () => {
  assert.equal(TEAM_FORMAT, 'bowerloom/team/v1beta1');
  assert.equal(RELAY_MAP_FORMAT, 'trellis/relay-map/v0.7-alpha');
});

test('a valid team loads with its members, its relay map, and a revision; loading writes nothing', () => {
  const { folder } = makeTeam(withRelay());
  const before = snapshot(folder);
  const r = loadTeam(folder);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  assert.deepEqual(snapshot(folder), before);
  const team = r.team;
  assert.equal(team.file.id, 'demo-team');
  assert.deepEqual(team.members.map(m => m.id), ['lead', 'maker']);
  assert.equal(team.relay.format, RELAY_MAP_FORMAT);
  assert.deepEqual(team.relay.participants, ['lead', 'maker']);
  assert.match(team.revision, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(team.files.map(f => f.path), ['maps/relay.json', 'team.json']);
});

test('a team with no relay map loads, and its relay is null', () => {
  const team = ok(only(teamFile()));
  assert.equal(team.relay, null);
});

test('decision 10: a member uses the team harness by default and can override it', () => {
  const team = ok(only(teamFile({ members: [member('lead'), member('maker', { engine: 'codex', harness: 'maker-harness', folder: 'wt/maker' })] })));
  assert.deepEqual(team.members.map(m => [m.id, m.harness, m.harnessFrom]), [['lead', 'demo', 'team'], ['maker', 'maker-harness', 'member']]);
});

test('a member with no harness, in a team with no default harness, is refused', () => {
  const t = teamFile();
  delete t.harness;
  refused(only(t), 'TEAM_MEMBER_NO_HARNESS');
  const withOwn = teamFile({ members: [member('lead', { harness: 'lead-harness' }), member('maker', { engine: 'codex', harness: 'maker-harness', folder: 'wt/maker' })] });
  delete withOwn.harness;
  ok(only(withOwn));
});

test('the revision follows the bytes', () => {
  const a = ok(withRelay());
  const b = ok(withRelay());
  assert.equal(a.revision, b.revision);
  const c = ok(withRelay(teamFile({ routes: 'maps/relay.json', description: 'Another demo team that plans and builds.' })));
  assert.notEqual(a.revision, c.revision);
});

// ---- check 1: a route that names an unknown member ----------------------------------------------------------------

test('check 1: a route that names an unknown member is refused', () => {
  refused(withRelay(undefined, relayMap(['lead', 'maker'], [route('lead', 'ghost')])), 'TEAM_ROUTE_UNKNOWN_MEMBER');
  refused(withRelay(undefined, relayMap(['lead', 'maker'], [route('ghost', 'maker')])), 'TEAM_ROUTE_UNKNOWN_MEMBER');
});

test('the participants of the relay map must equal the members', () => {
  refused(withRelay(undefined, relayMap(['lead'], [])), 'TEAM_RELAY_PARTICIPANTS');
  refused(withRelay(undefined, relayMap(['lead', 'maker', 'ghost'], [])), 'TEAM_RELAY_PARTICIPANTS');
});

test('the relay map keeps the 0.7 format exactly', () => {
  refused(withRelay(undefined, { ...relayMap(), format: 'trellis/relay-map/v0.8' }), 'TEAM_RELAY_INVALID');
  refused(withRelay(undefined, relayMap(['lead', 'maker'], [route('lead', 'maker', { delivery: 'immediate' })])), 'TEAM_RELAY_INVALID');
  refused(withRelay(undefined, { ...relayMap(), extra: true }), 'TEAM_RELAY_INVALID');
  refused({ 'team.json': json(teamFile({ routes: 'maps/relay.json' })), 'maps/relay.json': '{"format": "a", "format": "b"}' }, 'TEAM_RELAY_INVALID');
});

test('routes points at maps/relay.json, and a map with no pointer is not ignored', () => {
  refused(only(teamFile({ routes: 'maps/relay.json' })), 'TEAM_ROUTES_POINTER');
  refused(withRelay(teamFile({ routes: 'maps/other.json' })), 'TEAM_ROUTES_POINTER');
  refused(withRelay(teamFile()), 'TEAM_ROUTES_POINTER');
});

// ---- check 2: a bypass flag or bypassPermissions ------------------------------------------------------------------

test('check 2: bypassPermissions anywhere in team.json is refused', () => {
  refused(only(teamFile({ 'x-notes': { mode: 'bypassPermissions' } })), 'TEAM_BYPASS');
  refused(only(teamFile({ 'x-notes': { bypassPermissions: true } })), 'TEAM_BYPASS');
  refused(only(teamFile({ members: [member('lead', { 'x-crew-v0.7': { mode: 'bypass_permissions' } }), member('maker', { engine: 'codex', folder: 'wt/maker' })] })), 'TEAM_BYPASS');
});

test('check 2: a bypass flag anywhere in the team is refused', () => {
  refused(only(teamFile({ members: [member('lead', { purpose: 'Runs with --dangerously-bypass-approvals-and-sandbox on.' }), member('maker', { engine: 'codex', folder: 'wt/maker' })] })), 'TEAM_BYPASS');
  refused(only(teamFile({ 'x-notes': { args: ['--dangerously-skip-permissions'] } })), 'TEAM_BYPASS');
  refused(only(teamFile({ 'x-notes': { args: ['run', '--yolo'] } })), 'TEAM_BYPASS');
  refused(withRelay(undefined, relayMap(['lead', 'maker'], [route('lead', 'maker', { toTask: 'bypasspermissions' })])), 'TEAM_BYPASS');
  refused({ 'team.json': json(teamFile()), 'x-crew-v0.7/team.yaml': CREW_YAML.replace('Write a short plan.', 'Write a plan with --dangerously-skip-permissions.') }, 'TEAM_BYPASS');
});

// ---- check 3: a secret value ---------------------------------------------------------------------------------------

const FAKE_TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';

test('check 3: a secret value in team.json is refused, and no problem repeats it', () => {
  const problems = refused(only(teamFile({ 'x-notes': { note: `token ${FAKE_TOKEN}` } })), 'TEAM_SECRET');
  assert.ok(!JSON.stringify(problems).includes(FAKE_TOKEN));
  refused(only(teamFile({ 'x-notes': { apiKey: 'plain-literal-value-1234' } })), 'TEAM_SECRET');
});

test('check 3: a secret value in the relay map or in a kept 0.7 file is refused', () => {
  refused({ ...withRelay(), 'x-crew-v0.7/team.yaml': CREW_YAML.replace('Write a short plan.', `Write a plan. password: ${FAKE_TOKEN}`) }, 'TEAM_SECRET');
  const map = relayMap();
  map.routes[0]['x'] = FAKE_TOKEN;
  // An unknown key is refused by the schema too; the scan still names the secret.
  refused(withRelay(undefined, map), 'TEAM_SECRET');
});

test('a reference such as ${NAME} is not a secret value', () => {
  ok(only(teamFile({ 'x-notes': { apiKey: '${DEMO_API_KEY}' } })));
});

// ---- check 5: one engine and one folder, two harnesses ------------------------------------------------------------

test('check 5: two members with the same engine and folder but different harnesses are refused', () => {
  const pair = (a, b) => only(teamFile({ members: [member('lead', { engine: 'codex', ...a }), member('maker', { engine: 'codex', ...b })] }));
  refused(pair({ folder: 'wt/one' }, { folder: 'wt/one', harness: 'other' }), 'TEAM_FOLDER_HARNESS_CLASH');
  // The same folder written another way, or in another letter case, is the same folder.
  refused(pair({ folder: './wt/one' }, { folder: 'wt/one', harness: 'other' }), 'TEAM_FOLDER_HARNESS_CLASH');
  refused(pair({ folder: 'WT/One' }, { folder: 'wt/one', harness: 'other' }), 'TEAM_FOLDER_HARNESS_CLASH');
  refused(pair({ folder: '.', harness: 'one' }, { folder: '.', harness: 'other' }), 'TEAM_FOLDER_HARNESS_CLASH');
  // The same harness is fine; so are other folders, and other engines.
  ok(pair({ folder: 'wt/one' }, { folder: 'wt/one' }));
  ok(pair({ folder: 'wt/one' }, { folder: 'wt/two', harness: 'other' }));
  ok(only(teamFile({ members: [member('lead', { folder: 'wt/one' }), member('maker', { engine: 'codex', folder: 'wt/one', harness: 'other' })] })));
});

test('a member folder is a relative path inside or beside the project', () => {
  ok(only(teamFile({ members: [member('lead'), member('maker', { engine: 'codex', folder: '../demo-maker' })] })));
  for (const folder of ['/abs/path', '~/wt', 'wt\\maker', 'wt/../../x', 'wt//maker', '', 'wt/\u0000x']) {
    refused(only(teamFile({ members: [member('lead'), member('maker', { engine: 'codex', folder })] })), 'TEAM_FOLDER_INVALID');
  }
});

// ---- check 6: an enforced team guardrail the engine cannot carry --------------------------------------------------

const guarded = (engine, extra = {}) => only(teamFile({
  guardrails: { rules: [rule('no-push')] },
  members: [member('lead'), member('maker', { engine, folder: 'wt/maker', ...extra })],
}));

test('check 6: a member whose engine cannot carry an enforced team guardrail is refused', () => {
  const problems = refused(guarded('pi'), 'TEAM_GUARDRAIL_NOT_CARRIED');
  assert.ok(problems.some(p => p.message.includes('"maker"') && p.message.includes('"no-push"')));
  refused(guarded('deepseek-harness'), 'TEAM_GUARDRAIL_NOT_CARRIED');
});

test('check 6: a recorded approval of the loss lets the member load; a changed rule voids it', () => {
  const hash = entryHash(loaded(rule('no-push')));
  ok(guarded('pi'), { approvals: [approval(hash, 'no-push')], now: NOW });
  // An approval of another engine, another result, or another rule does not count.
  refused(guarded('pi'), 'TEAM_GUARDRAIL_NOT_CARRIED', { approvals: [approval(hash, 'no-push', { engine: 'deepseek-harness' })], now: NOW });
  refused(guarded('pi'), 'TEAM_GUARDRAIL_NOT_CARRIED', { approvals: [approval(hash, 'no-push', { result: 'weakened' })], now: NOW });
  const changed = entryHash(loaded(rule('no-push', { pattern: 'git push --force *' })));
  refused(guarded('pi'), 'TEAM_GUARDRAIL_NOT_CARRIED', { approvals: [approval(changed, 'no-push')], now: NOW });
});

test('check 6: an engine that carries the guardrail needs no approval, and an advisory allow needs none', () => {
  ok(guarded('claude-code'));
  ok(only(teamFile({
    guardrails: { rules: [rule('may-read', { action: 'read', pattern: 'docs/**', effect: 'allow', strength: 'advisory' })] },
    members: [member('lead'), member('maker', { engine: 'pi', folder: 'wt/maker' })],
  })));
});

test('an approval record that is not valid is a problem', () => {
  refused(guarded('pi'), 'TEAM_APPROVAL_INVALID', { approvals: [{ part: 'guardrails' }], now: NOW });
});

test('team guardrails use the harness guardrail shape', () => {
  refused(only(teamFile({ guardrails: { rules: [rule('no-push', { effect: 'block' })] } })), 'TEAM_GUARDRAILS_INVALID');
  refused(only(teamFile({ guardrails: { rules: [rule('a'), rule('a')] } })), 'TEAM_GUARDRAILS_INVALID');
  ok(only(teamFile({ guardrails: { rules: [], sandbox: { id: 'box', files: true, network: false } } })));
});

// ---- fields, words, and files ---------------------------------------------------------------------------------------

test('unknown fields are refused; x-<name> blocks are kept; an engine block is engine syntax', () => {
  refused(only(teamFile({ color: 'blue' })), 'TEAM_UNKNOWN_FIELD');
  refused(only(teamFile({ members: [member('lead', { color: 'blue' }), member('maker', { engine: 'codex', folder: 'wt/maker' })] })), 'TEAM_UNKNOWN_FIELD');
  refused(only(teamFile({ 'x-claude-code': { effort: 'high' } })), 'TEAM_ENGINE_SYNTAX');
  refused(only(teamFile({ members: [member('lead', { 'x-codex': { effort: 'high' } }), member('maker', { engine: 'codex', folder: 'wt/maker' })] })), 'TEAM_ENGINE_SYNTAX');
  const team = ok(only(teamFile({ 'x-crew-v0.7': { tasks: [] }, members: [member('lead', { 'x-crew-v0.7': { modelClass: 'standard' } }), member('maker', { engine: 'codex', folder: 'wt/maker' })] })));
  assert.deepEqual(team.file.extensions, { 'x-crew-v0.7': { tasks: [] } });
  assert.deepEqual(team.members[0].extensions, { 'x-crew-v0.7': { modelClass: 'standard' } });
});

test('team.json is strict JSON', () => {
  refused({ 'team.json': '{"format": "a", "format": "b"}' }, 'TEAM_JSON_INVALID');
  refused({ 'team.json': '{"format": "bowerloom/team/v1beta1",}' }, 'TEAM_JSON_INVALID');
  refused({ 'team.json': '[]' }, 'TEAM_INVALID_FIELD');
});

test('the format, the id, and the folder name are checked', () => {
  refused(only(teamFile({ format: 'bowerloom/team/v1' })), 'TEAM_FORMAT');
  refused(only(teamFile({ id: 'Demo_Team' })), 'TEAM_INVALID_ID');
  refused(only(teamFile({ id: 'other-team' })), 'TEAM_ID_FOLDER');
  refused(only(teamFile({ description: 'Two\nlines.' })), 'TEAM_INVALID_FIELD');
});

test('member fields: engine ids, unique ids, words, models, and reports_to', () => {
  const two = (a, b = {}) => only(teamFile({ members: [member('lead', a), member('maker', { engine: 'codex', folder: 'wt/maker', ...b })] }));
  refused(two({ engine: 'hermes' }), 'TEAM_UNKNOWN_ENGINE');
  refused(only(teamFile({ members: [member('lead'), member('lead', { folder: 'wt/x' })] })), 'TEAM_DUPLICATE_MEMBER');
  refused(two({ id: 'Lead' }), 'TEAM_INVALID_ID');
  refused(two({ start: 'daemon' }), 'TEAM_INVALID_FIELD');
  refused(two({ inbox: 'maybe' }), 'TEAM_INVALID_FIELD');
  refused(two({ model: '' }), 'TEAM_INVALID_FIELD');
  refused(two({ model: 'standard' }), 'TEAM_MODEL_CLASS');
  refused(two({ reports_to: 'ghost' }), 'TEAM_REPORTS_TO');
  refused(two({ reports_to: 'lead' }), 'TEAM_REPORTS_TO');
  refused(two({ reports_to: 'maker' }, { reports_to: 'lead' }), 'TEAM_REPORTS_TO');
  refused(only(teamFile({ members: [] })), 'TEAM_INVALID_FIELD');
  const noPurpose = member('lead'); delete noPurpose.purpose;
  refused(only(teamFile({ members: [noPurpose, member('maker', { engine: 'codex', folder: 'wt/maker' })] })), 'TEAM_INVALID_FIELD');
});

test('limits: active members is required; the message and cost caps are checked when present', () => {
  refused(only(teamFile({ limits: {} })), 'TEAM_INVALID_FIELD');
  refused(only(teamFile({ limits: { activeMembers: 0 } })), 'TEAM_INVALID_FIELD');
  refused(only(teamFile({ limits: { activeMembers: 2, messages: { perMember: 0, windowSeconds: 60 } } })), 'TEAM_INVALID_FIELD');
  refused(only(teamFile({ limits: { activeMembers: 2, costUsd: -1 } })), 'TEAM_INVALID_FIELD');
  refused(only(teamFile({ limits: { activeMembers: 2, retries: 3 } })), 'TEAM_UNKNOWN_FIELD');
  const team = ok(only(teamFile({ limits: { activeMembers: 2, messages: { perMember: 20, windowSeconds: 3600 }, costUsd: 5 } })));
  assert.deepEqual(team.file.limits, { activeMembers: 2, messages: { perMember: 20, windowSeconds: 3600 }, costUsd: 5 });
});

test('files: team.json is required, 0.7 names are kept, other names are refused, and links are refused', () => {
  refused({ 'notes.md': 'x\n' }, 'TEAM_FILE_MISSING');
  ok({ 'team.json': json(teamFile()), 'team.yaml': CREW_YAML, 'prompts/lead.md': 'x\n', 'maps/vines.json': '{}\n' });
  refused({ 'team.json': json(teamFile()), 'tem.json': '{}\n' }, 'TEAM_UNKNOWN_FILE');
  refused({ ...withRelay(), 'maps/relay.jsn': '{}\n' }, 'TEAM_UNKNOWN_FILE');
  const { folder } = makeTeam({ 'real.json': json(teamFile()) });
  fs.renameSync(path.join(folder, 'real.json'), path.join(folder, '..', 'real.json'));
  fs.symlinkSync(path.join(folder, '..', 'real.json'), path.join(folder, 'team.json'));
  const r = loadTeam(folder);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('TEAM_FILE_UNSAFE'), JSON.stringify(r));
});
