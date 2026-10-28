// Teams and relay spec, section 9 and decisions 4 and 5: adoption of a 0.7 team by copy. Acceptance check 4 of section 11.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTeamAdoption, loadTeam, planTeamAdoption } from '../../../dist/packages/team/src/index.js';
import { CREW_RELAY, CREW_YAML, cleanup, emptyTarget, makeCrew, snapshot } from './fixture.mjs';

const ACK = ['owner-permissions'];

test.after(cleanup);

const ANSWERS = Object.freeze({
  harness: 'demo',
  members: { lead: { engine: 'claude-code', model: 'model-a' }, maker: { engine: 'codex', model: 'model-b', folder: 'wt/maker' } },
});
const inPlace = (answers = ANSWERS, crew = {}) => {
  const { project, folder } = makeCrew(crew);
  return { project, folder, input: { source: folder, target: folder, answers, acknowledged: ACK } };
};
const ids = plan => plan.questions.map(q => q.id).sort();
const codes = plan => plan.problems.map(p => p.code);

// ---- check 4 ------------------------------------------------------------------------------------------------------------

test('check 4: a plan asks for an engine per owner, never guesses one, and leaves the 0.7 bytes unchanged', () => {
  const { folder } = makeCrew();
  const before = snapshot(folder);
  const plan = planTeamAdoption({ source: folder, target: folder });
  assert.deepEqual(snapshot(folder), before, 'a plan reads only');
  assert.equal(plan.ready, false);
  assert.equal(plan.team, null);
  assert.deepEqual(ids(plan), ['engine:lead', 'engine:maker', 'harness', 'model:lead', 'model:maker']);
  const engine = plan.questions.find(q => q.id === 'engine:lead');
  assert.equal(engine.kind, 'engine');
  assert.equal(engine.owner, 'lead');
  assert.deepEqual(engine.choices, ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness']);
  assert.equal(engine.default, undefined, 'no engine is offered as a default');
  // The model question names the 0.7 model class as context and asks for an explicit model.
  const model = plan.questions.find(q => q.id === 'model:lead');
  assert.equal(model.modelClass, 'reasoning');
  assert.match(model.ask, /explicit model/);
});

test('check 4: a model answer alone does not settle the engine', () => {
  const { folder } = makeCrew();
  const plan = planTeamAdoption({ source: folder, target: folder, acknowledged: ACK, answers: { harness: 'demo', members: { lead: { model: 'model-a' }, maker: { model: 'model-b' } } } });
  assert.equal(plan.ready, false);
  assert.deepEqual(ids(plan), ['engine:lead', 'engine:maker']);
});

test('check 4: apply in place writes team.json and the kept copy, and the 0.7 files keep every byte', () => {
  const { folder, input } = inPlace();
  const before = snapshot(folder);
  const plan = planTeamAdoption(input);
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
  assert.deepEqual(plan.writes.map(w => w.path), ['x-crew-v0.7/team.yaml', 'x-crew-v0.7/prompts/lead.md', 'x-crew-v0.7/prompts/maker.md', 'team.json']);
  const r = applyTeamAdoption(input, plan.revision);
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = snapshot(folder);
  for (const [rel, bytes] of Object.entries(before)) assert.equal(after[rel], bytes, `${rel} changed`);
  assert.deepEqual(Object.keys(after).filter(k => !(k in before)).sort(), ['team.json', 'x-crew-v0.7/prompts/lead.md', 'x-crew-v0.7/prompts/maker.md', 'x-crew-v0.7/team.yaml']);
  assert.equal(fs.readFileSync(path.join(folder, 'x-crew-v0.7/team.yaml'), 'utf8'), CREW_YAML);
  const loaded = loadTeam(folder);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.problems));
  assert.equal(loaded.team.revision, plan.teamRevision);
});

// ---- what the adopted team holds ---------------------------------------------------------------------------------------

test('the adopted team keeps modelClass and the 0.7 tasks, outputs, and acceptance in x-crew-v0.7', () => {
  const plan = planTeamAdoption(inPlace().input);
  const team = plan.team;
  assert.equal(team.id, 'demo-crew');
  assert.equal(team.harness, 'demo');
  assert.equal(team.routes, 'maps/relay.json');
  assert.deepEqual(team.limits, { activeMembers: 2 });
  assert.deepEqual(team.members.map(m => [m.id, m.engine, m.model, m.folder]), [['lead', 'claude-code', 'model-a', '.'], ['maker', 'codex', 'model-b', 'wt/maker']]);
  assert.deepEqual(team.members.map(m => m.extensions['x-crew-v0.7'].modelClass), ['reasoning', 'economy']);
  assert.equal(team.members[0].purpose, 'Plans the change');
  const crew = team.extensions['x-crew-v0.7'];
  assert.deepEqual(crew.tasks.map(t => t.id), ['plan', 'build']);
  assert.deepEqual(crew.tasks[0].outputs, { doc: { kind: 'artifact', mediaType: 'text/markdown' } });
  assert.deepEqual(crew.tasks[1].acceptance, ['The build matches the plan.']);
  assert.equal(crew.format, 'trellis/crew/v0.7-alpha');
  assert.equal(crew.budget.maxActiveWorkers, 2);
});

test('the plan lists the defaults it chose for a person to see; answers replace them', () => {
  const plan = planTeamAdoption(inPlace().input);
  const lead = plan.defaults.filter(d => d.member === 'lead').map(d => [d.field, d.value]);
  assert.deepEqual(lead, [['folder', '.'], ['start', 'manual'], ['inbox', 'hold'], ['reports_to', 'human'], ['purpose', 'Plans the change']]);
  assert.ok(plan.defaults.every(d => d.field !== 'engine' && d.field !== 'model'));
  const answered = planTeamAdoption(inPlace({ ...ANSWERS, members: { ...ANSWERS.members, lead: { ...ANSWERS.members.lead, start: 'headless', inbox: 'accept' } } }).input);
  assert.deepEqual(answered.team.members[0].start, 'headless');
  assert.deepEqual(answered.defaults.filter(d => d.member === 'lead').map(d => d.field), ['folder', 'reports_to', 'purpose']);
});

test('a 0.7 team with no relay map adopts with no routes', () => {
  const plan = planTeamAdoption(inPlace(ANSWERS, { relay: null }).input);
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
  assert.equal(plan.team.routes, undefined);
});

test('apply to another folder copies the relay map byte for byte', () => {
  const { folder } = makeCrew();
  const before = snapshot(folder);
  const { target } = emptyTarget();
  const input = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  const plan = planTeamAdoption(input);
  assert.deepEqual(plan.writes.map(w => [w.path, w.kind]), [
    ['x-crew-v0.7/team.yaml', 'copy'], ['x-crew-v0.7/prompts/lead.md', 'copy'], ['x-crew-v0.7/prompts/maker.md', 'copy'], ['maps/relay.json', 'copy'], ['team.json', 'new'],
  ]);
  assert.equal(applyTeamAdoption(input, plan.revision).ok, true);
  assert.deepEqual(snapshot(folder), before);
  assert.equal(fs.readFileSync(path.join(target, 'maps/relay.json'), 'utf8'), CREW_RELAY);
  assert.equal(loadTeam(target).ok, true);
});

// ---- refusals --------------------------------------------------------------------------------------------------------------

test('apply refuses a plan that is not ready or not current, and writes nothing', () => {
  const { folder } = makeCrew();
  const before = snapshot(folder);
  const notReady = applyTeamAdoption({ source: folder, target: folder }, planTeamAdoption({ source: folder, target: folder }).revision);
  assert.equal(notReady.ok, false);
  assert.ok(notReady.problems.some(p => p.code === 'TEAM_ADOPT_NOT_READY'));
  const input = { source: folder, target: folder, answers: ANSWERS, acknowledged: ACK };
  const stale = applyTeamAdoption(input, planTeamAdoption({ ...input, answers: { ...ANSWERS, harness: 'other' } }).revision);
  assert.equal(stale.ok, false);
  assert.ok(stale.problems.some(p => p.code === 'TEAM_ADOPT_REVISION'));
  assert.deepEqual(snapshot(folder), before);
});

test('a write that fails part way removes what adoption wrote and keeps the 0.7 bytes', () => {
  const { folder, input } = inPlace();
  const before = snapshot(folder);
  const plan = planTeamAdoption(input);
  const r = applyTeamAdoption(input, plan.revision, { afterWrite: rel => { if (rel === 'x-crew-v0.7/team.yaml') throw new Error('synthetic failure'); } });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => p.code === 'TEAM_ADOPT_WRITE_FAILED'));
  assert.deepEqual(snapshot(folder), before);
  assert.equal(fs.existsSync(path.join(folder, 'x-crew-v0.7')), false);
});

test('a target that already holds a team is refused', () => {
  const { folder, input } = inPlace();
  fs.writeFileSync(path.join(folder, 'team.json'), '{}\n');
  const plan = planTeamAdoption(input);
  assert.equal(plan.ready, false);
  assert.ok(codes(plan).includes('TEAM_ADOPT_EXISTS'));
  const kept = inPlace();
  fs.mkdirSync(path.join(kept.folder, 'x-crew-v0.7'));
  assert.ok(codes(planTeamAdoption(kept.input)).includes('TEAM_ADOPT_EXISTS'));
});

test('the target folder name must be the team id', () => {
  const { folder } = makeCrew();
  const plan = planTeamAdoption({ source: folder, target: emptyTarget('other-name').target, answers: ANSWERS, acknowledged: ACK });
  assert.ok(codes(plan).includes('TEAM_ID_FOLDER'), JSON.stringify(plan.problems));
});

test('answers are checked: unknown owners, engine ids, model classes, and fields', () => {
  const plan = a => planTeamAdoption(inPlace(a).input);
  assert.ok(codes(plan({ ...ANSWERS, members: { ...ANSWERS.members, ghost: { engine: 'pi' } } })).includes('TEAM_ADOPT_UNKNOWN_OWNER'));
  assert.ok(codes(plan({ ...ANSWERS, members: { ...ANSWERS.members, lead: { engine: 'hermes', model: 'model-a' } } })).includes('TEAM_ADOPT_ANSWER'));
  assert.ok(codes(plan({ ...ANSWERS, members: { ...ANSWERS.members, lead: { engine: 'pi', model: 'm', colour: 'blue' } } })).includes('TEAM_ADOPT_ANSWER'));
  assert.ok(codes(plan({ ...ANSWERS, members: { ...ANSWERS.members, lead: { engine: 'claude-code', model: 'reasoning' } } })).includes('TEAM_MODEL_CLASS'));
  const clash = plan({ harness: 'demo', members: { lead: { engine: 'codex', model: 'm' }, maker: { engine: 'codex', model: 'm', harness: 'other' } } });
  assert.equal(clash.ready, false);
  assert.ok(codes(clash).includes('TEAM_FOLDER_HARNESS_CLASH'));
});

test('a 0.7 file with a secret value or a bypass is refused, and no problem repeats the value', () => {
  const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const secret = planTeamAdoption(inPlace(undefined, { yaml: CREW_YAML.replace('Write a short plan.', `Write a plan with ${token}.`) }).input);
  assert.equal(secret.ready, false);
  assert.ok(codes(secret).includes('TEAM_SECRET'));
  assert.ok(!JSON.stringify(secret).includes(token));
  const noAnswers = planTeamAdoption({ ...inPlace(undefined, { yaml: CREW_YAML.replace('Write a short plan.', `Write a plan with ${token}.`) }).input, answers: undefined });
  assert.ok(codes(noAnswers).includes('TEAM_SECRET'), 'the source is scanned before the questions are answered');
  const bypass = planTeamAdoption(inPlace(undefined, { yaml: CREW_YAML.replace('Write a short plan.', 'Write a plan; run with --dangerously-skip-permissions.') }).input);
  assert.ok(codes(bypass).includes('TEAM_BYPASS'));
});

test('a missing or invalid 0.7 file is refused', () => {
  const { folder } = makeCrew();
  fs.rmSync(path.join(folder, 'team.yaml'));
  assert.ok(codes(planTeamAdoption({ source: folder, target: folder, answers: ANSWERS, acknowledged: ACK })).includes('TEAM_ADOPT_SOURCE_MISSING'));
  assert.ok(codes(planTeamAdoption(inPlace(ANSWERS, { yaml: CREW_YAML.replace('format: trellis/crew/v0.7-alpha', 'format: trellis/crew/v0.6') }).input)).includes('TEAM_ADOPT_SOURCE_INVALID'));
  assert.ok(codes(planTeamAdoption(inPlace(ANSWERS, { yaml: 'a: &x 1\nb: *x\n' }).input)).includes('TEAM_ADOPT_SOURCE_INVALID'));
  assert.ok(codes(planTeamAdoption(inPlace(ANSWERS, { relay: '{"format": 1, "format": 2}' }).input)).includes('TEAM_RELAY_INVALID'));
});
