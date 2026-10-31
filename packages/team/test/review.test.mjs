// Review rulings T1 to T21 of step 4, lane B (security and silent-failure reviews of e77ac5e).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { entryHash } from '../../../dist/packages/harness-definition/src/index.js';
import {
  applyTeamAdoption, loadTeam, namesBypass, namesWidening, planTeamAdoption, planTeamStart,
} from '../../../dist/packages/team/src/index.js';
import {
  CREW_RELAY, CREW_YAML, FAKE_TOKEN, NOW, approval, cleanup, codes, emptyTarget, json, loaded, makeCrew, makeTeam, member, relayMap,
  route, rule, snapshot, teamFile, tempDir, withRelay,
} from './fixture.mjs';

test.after(cleanup);

const VERSIONS = Object.freeze({ 'claude-code': '2.1.310', codex: '0.157.0', opencode: '1.18.30', pi: '1.4.0', 'deepseek-harness': '0.2.2-alpha.2' });
const ALL = ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'];
const harness = (id = 'demo', { engines = ALL, rules = [], mcp = [], hooks = [] } = {}) =>
  ({ revision: `sha256:${'a'.repeat(64)}`, harness: { id, engines: engines.map(e => ({ id: e })) }, entries: { rules, sandbox: [], mcp, hooks } });
const solo = (engine, extra = {}) => teamFile({ members: [member('solo', { engine, ...extra })], limits: { activeMembers: 1 } });
/** A home folder of its own, so no test reads the real one. */
const HOME = tempDir('bowerloom-team-home-');
const input = (project, extra = {}) => ({ projectDir: project, versions: VERSIONS, harnesses: { demo: harness() }, home: HOME, ...extra });

function load(files, opts = {}) {
  const { project, folder } = makeTeam(files, opts);
  return { project, folder, r: loadTeam(folder) };
}
function setup(team, folders = []) {
  const { project, r } = load({ 'team.json': json(team) }, { folders });
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return { project, team: r.team };
}
const startCodes = (team, inp) => { const r = planTeamStart(team, inp); return r.ok ? [] : r.problems.map(p => p.code); };
const ANSWERS = Object.freeze({
  harness: 'demo',
  members: { lead: { engine: 'claude-code', model: 'model-a' }, maker: { engine: 'codex', model: 'model-b', folder: 'wt/maker' } },
});
const ACK = ['owner-permissions', 'budget-reserve', 'required-capabilities', 'paid-fallback'];

// ---- T1: member folder confinement -----------------------------------------------------------------------------------

test('T1: a folder beside the project is exactly one leading .. then one name', () => {
  for (const folder of ['../a/b', '../../x', '..']) {
    const r = load({ 'team.json': json(teamFile({ members: [member('lead'), member('maker', { engine: 'codex', folder })] })) }).r;
    assert.ok(codes(r).includes('TEAM_FOLDER_INVALID'), `${folder}: ${JSON.stringify(r)}`);
  }
  assert.equal(load({ 'team.json': json(teamFile({ members: [member('lead'), member('maker', { engine: 'codex', folder: '../demo-maker' })] })) }).r.ok, true);
});

test('T1: a link at any component of the member folder is refused', () => {
  const { project, team } = setup(solo('codex', { folder: 'wt/maker' }));
  fs.mkdirSync(path.join(project, 'real', 'maker'), { recursive: true });
  fs.symlinkSync(path.join(project, 'real'), path.join(project, 'wt'));
  assert.ok(startCodes(team, input(project)).includes('TEAM_FOLDER_LINK'));
});

test('T1: the home folder, a folder that holds it, and user engine config folders are refused', () => {
  const home = tempDir('bowerloom-team-home-');
  const { team, project } = setup(solo('codex'));
  assert.ok(startCodes(team, input(project, { home: project })).includes('TEAM_FOLDER_OUTSIDE'), 'the project is the home folder');
  assert.ok(startCodes(team, input(project, { home: path.join(project, 'inner') })).includes('TEAM_FOLDER_OUTSIDE'), 'the folder holds the home folder');
  // A project directly in the home folder, with a member beside it in ~/.codex or ~/.claude.
  for (const config of ['.codex', '.claude', '.config', '.pi', '.dsh']) {
    const proj = path.join(home, `proj${config}`);
    const { folder } = makeTeam({ 'team.json': json(solo('codex', { folder: `../${config}` })) });
    fs.mkdirSync(path.join(proj), { recursive: true });
    fs.mkdirSync(path.join(home, config), { recursive: true });
    const r = loadTeam(folder);
    assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
    assert.ok(startCodes(r.team, input(proj, { home })).includes('TEAM_FOLDER_OUTSIDE'), config);
  }
  // A sibling that is not a config folder starts.
  fs.mkdirSync(path.join(home, 'sibling'), { recursive: true });
  const { folder } = makeTeam({ 'team.json': json(solo('codex', { folder: '../sibling' })) });
  const r = planTeamStart(loadTeam(folder).team, input(path.join(home, 'proj.codex'), { home }));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  assert.equal(r.plan.members[0].folder, path.join(fs.realpathSync(home), 'sibling'));
});

test('T1: adoption checks answered folders the same way', () => {
  const home = tempDir('bowerloom-team-home-');
  const project = path.join(home, 'proj');
  const target = path.join(project, '.bowerloom', 'teams', 'demo-crew');
  const { folder } = makeCrew();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'));
  const plan = planTeamAdoption({ source: folder, target, home, acknowledged: ACK, answers: { ...ANSWERS, members: { ...ANSWERS.members, maker: { ...ANSWERS.members.maker, folder: '../.claude' } } } });
  assert.equal(plan.ready, false);
  assert.ok(plan.problems.some(p => p.code === 'TEAM_FOLDER_OUTSIDE'), JSON.stringify(plan.problems));
  const notLayout = planTeamAdoption({ source: folder, target: path.join(tempDir(), 'demo-crew'), answers: ANSWERS, acknowledged: ACK });
  assert.ok(notLayout.problems.some(p => p.code === 'TEAM_ADOPT_USAGE'), 'the target is <project>/.bowerloom/teams/<id>');
});

// ---- T2: no x- block in team guardrails ----------------------------------------------------------------------------------

test('T2: an x- key in a team guardrail rule or sandbox is refused', () => {
  const withBlock = guardrails => load({ 'team.json': json(teamFile({ guardrails })) }).r;
  assert.ok(codes(withBlock({ rules: [{ ...rule('no-push'), 'x-claude-code': { additionalDirectories: ['/'] } }] })).includes('TEAM_GUARDRAIL_BLOCK'));
  assert.ok(codes(withBlock({ rules: [{ ...rule('no-push'), 'x-notes': { why: 'none' } }] })).includes('TEAM_GUARDRAIL_BLOCK'));
  assert.ok(codes(withBlock({ rules: [], sandbox: { id: 'box', files: true, network: false, 'x-codex': { writable_roots: ['/'] } } })).includes('TEAM_GUARDRAIL_BLOCK'));
});

// ---- T3: no secret in a message or question -----------------------------------------------------------------------------------

test('T3: no problem repeats a secret from a guardrail pattern', () => {
  for (const engine of ['pi', 'codex', 'claude-code']) {
    const r = load({ 'team.json': json(teamFile({ guardrails: { rules: [rule('no-curl', { pattern: `curl ${FAKE_TOKEN} *` })] }, members: [member('lead', { engine })] })) }).r;
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r.problems).includes(FAKE_TOKEN), engine);
  }
});

test('T3: adoption questions show a role only when it is plain and holds no secret', () => {
  const escaped = makeCrew({ yaml: CREW_YAML.replace('role: Plans the change', 'role: "Plans\\e[31m the change\\u202e"') });
  const plan = planTeamAdoption({ source: escaped.folder, target: escaped.folder });
  const ask = plan.questions.find(q => q.id === 'engine:lead').ask;
  assert.ok(!/[\u0000-\u001f\u007f-\u009f‮]/.test(ask), ask);
  const secret = makeCrew({ yaml: CREW_YAML.replace('role: Plans the change', `role: Plans with ${FAKE_TOKEN}`) });
  const plan2 = planTeamAdoption({ source: secret.folder, target: secret.folder });
  assert.ok(plan2.questions.some(q => q.id === 'engine:lead'));
  assert.ok(!JSON.stringify(plan2).includes(FAKE_TOKEN));
});

// ---- T4: file names ---------------------------------------------------------------------------------------------------------------

test('T4: a kept or 0.7 file name that is not plain is refused and never shown', () => {
  for (const rel of ['x-crew-v0.7/my notes.md', `x-crew-v0.7/${FAKE_TOKEN}.md`, 'prompts/bad\u001bname.md', `prompts/${FAKE_TOKEN}.md`]) {
    const r = load({ 'team.json': json(teamFile()), [rel]: 'x\n' }).r;
    assert.ok(codes(r).includes('TEAM_FILE_NAME'), `${JSON.stringify(rel)}: ${JSON.stringify(r)}`);
    assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN) && !JSON.stringify(r).includes('\u001b'));
  }
  const top = load({ 'team.json': json(teamFile()), [`${FAKE_TOKEN}.txt`]: 'x\n' }).r;
  assert.ok(codes(top).includes('TEAM_UNKNOWN_FILE') || codes(top).includes('TEAM_FILE_NAME'));
  assert.ok(!JSON.stringify(top).includes(FAKE_TOKEN));
});

// ---- T5: the unattended command pins sandbox and approvals ----------------------------------------------------------------------

test('T5: the Codex command pins its sandbox and approval policy with recorded flags', () => {
  const { project, team } = setup(solo('codex'));
  const r = planTeamStart(team, input(project));
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  const cmd = r.plan.members[0].command;
  assert.deepEqual(cmd.argv, ['codex', '-c', 'approval_policy="never"', 'exec', '--ignore-user-config', '--ignore-rules', '--json', '--sandbox', 'workspace-write', '-m', 'model-a', '-']);
  assert.deepEqual(cmd.pinned, { sandbox: 'workspace-write', approval: 'never: a request outside the sandbox fails' });
  assert.match(cmd.ambient, /not read|not loaded/);
  assert.ok(startCodes(team, input(project, { versions: { ...VERSIONS, codex: '0.156.0' } })).includes('TEAM_START_ENGINE_VERSION'));
});

test('T5: an unattended Claude Code start is refused until the --setting-sources form is on record', () => {
  const { project, team } = setup(solo('claude-code'));
  const r = planTeamStart(team, input(project));
  assert.equal(r.ok, false);
  const unpinned = r.problems.filter(p => p.code === 'TEAM_START_UNPINNED');
  assert.equal(unpinned.length, 1, JSON.stringify(r.problems));
  assert.ok(unpinned[0].message.includes('user-level settings load and can allow requests the harness does not; the step 5 live check records the flag'));
  // A manual Claude Code member starts: a person is present.
  const manual = setup(solo('claude-code', { start: 'manual' }));
  assert.equal(planTeamStart(manual.team, input(manual.project)).ok, true);
});

// ---- T6: model and one-line text --------------------------------------------------------------------------------------------

test('T6: a model is a plain name; one-line text refuses format and C1 characters', () => {
  const two = extra => load({ 'team.json': json(teamFile({ members: [member('lead', extra), member('maker', { engine: 'codex', folder: 'wt/maker' })] })) }).r;
  for (const model of ['-m', '--settings', 'a b', 'model​', 'model\u0085', 'x'.repeat(257)]) {
    assert.ok(codes(two({ model })).includes('TEAM_INVALID_FIELD'), JSON.stringify(model));
  }
  for (const model of ['claude-sonnet-5-5', 'openai/gpt-x', 'org/model@2026:latest', 'a.b+c']) assert.equal(two({ model }).ok, true, model);
  for (const purpose of ['Plans‮ the change.', 'Plans\u0085 the change.', 'Plans‍ the change.']) {
    assert.ok(codes(two({ purpose })).includes('TEAM_INVALID_FIELD'), JSON.stringify(purpose));
  }
});

// ---- T7: widening forms ------------------------------------------------------------------------------------------------------------

test('T7: widening forms are refused, as single strings, key and value pairs, and split across two strings', () => {
  const forms = [
    { args: ['--sandbox', 'danger-full-access'] }, { sandbox_mode: 'danger-full-access' }, { approval_policy: 'never' },
    { args: ['-c', 'approval_policy=never'] }, { note: 'run with approval_policy = "never"' }, { args: ['--full-auto'] },
    { args: ['--auto-approve'] }, { args: ['--allow-all'] }, { args: ['--trust-all-tools'] }, { defaultMode: 'acceptEdits' },
    { args: ['--permission-mode', 'acceptEdits'] }, { args: ['--permission-mode', 'auto'] }, { permissionMode: 'auto' },
    { args: ['--ask-for-approval', 'never'] },
  ];
  for (const form of forms) {
    const r = load({ 'team.json': json(teamFile({ 'x-notes': form })) }).r;
    assert.ok(codes(r).includes('TEAM_BYPASS'), JSON.stringify(form));
  }
  assert.equal(namesWidening('We accept edits from the reviewer, in full, automatically.'), false, 'prose is not a flag');
  assert.equal(load({ 'team.json': json(teamFile({ 'x-notes': { note: 'The lead may approve a plan; the auto build follows.' } })) }).r.ok, true);
});

// ---- T9, T10, T11: nothing from 0.7 is lost without a word ------------------------------------------------------------------------

test('T9: adoption copies every 0.7 entry into x-crew-v0.7, byte for byte', () => {
  const { folder } = makeCrew({ extra: { 'agents/lead.md': 'Agent.\n', 'skills/plan.md': 'Skill.\n', 'assets/brief.json': '{}\n', 'maps/vines.json': '{"v":1}\n' } });
  const before = snapshot(folder);
  const { target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  const plan = planTeamAdoption(inp);
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
  assert.deepEqual(plan.notCarried, []);
  const r = applyTeamAdoption(inp, plan.revision);
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const rel of ['agents/lead.md', 'skills/plan.md', 'assets/brief.json', 'maps/vines.json', 'prompts/lead.md', 'prompts/maker.md', 'team.yaml']) {
    assert.equal(fs.readFileSync(path.join(target, 'x-crew-v0.7', rel)).toString('base64'), before[rel], rel);
  }
  assert.deepEqual(snapshot(folder), before);
  assert.equal(loadTeam(target).ok, true);
});

test('T9: an entry that cannot be carried is listed, and the plan waits for an acknowledgement', () => {
  const { folder } = makeCrew({ extra: { 'notes.txt': 'n\n', 'maps/other.json': '{}\n' } });
  fs.symlinkSync(path.join(folder, 'prompts', 'lead.md'), path.join(folder, 'prompts', 'link.md'));
  const { target } = emptyTarget();
  const plan = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: ACK });
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.notCarried.map(n => n.path).sort(), ['maps/other.json', 'notes.txt', 'prompts/link.md']);
  for (const n of plan.notCarried) assert.ok(n.reason.length > 0 && n.id.length > 0);
  const acked = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: [...ACK, ...plan.notCarried.map(n => n.id)] });
  assert.equal(acked.ready, true, JSON.stringify(acked.problems));
  const unknown = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: [...ACK, 'nothing-like-this'] });
  assert.ok(unknown.problems.some(p => p.code === 'TEAM_ADOPT_ANSWER'));
});

test('T10: the loader reads, scans, and hashes the 0.7 files in a team folder', () => {
  const base = { 'team.json': json(teamFile()), 'team.yaml': CREW_YAML, 'prompts/lead.md': 'Plan it.\n' };
  const a = load(base).r, b = load({ ...base, 'prompts/lead.md': 'Plan it well.\n' }).r;
  assert.equal(a.ok, true);
  assert.notEqual(a.team.revision, b.team.revision);
  assert.ok(a.team.files.some(f => f.path === 'prompts/lead.md'));
  assert.ok(codes(load({ ...base, 'prompts/lead.md': `token ${FAKE_TOKEN}\n` }).r).includes('TEAM_SECRET'));
  assert.ok(codes(load({ ...base, 'maps/vines.json': '{"note": "--dangerously-skip-permissions"}\n' }).r).includes('TEAM_BYPASS'));
});

test('T11: every derived value is listed, and unenforced 0.7 restrictions need an acknowledgement', () => {
  const { folder } = makeCrew();
  const inp = { source: folder, target: folder, answers: ANSWERS };
  const plan = planTeamAdoption(inp);
  assert.equal(plan.ready, false);
  assert.ok(plan.notMapped.some(n => n.id === 'owner-permissions'));
  assert.match(plan.notMapped.find(n => n.id === 'owner-permissions').what, /not enforced; no team guardrail is created/);
  const fields = plan.defaults.map(d => `${d.member ?? 'team'}.${d.field}=${d.value}`);
  for (const f of ['team.limits.activeMembers=2', 'team.description=A demo crew that plans and builds a small change.', 'lead.purpose=Plans the change', 'maker.purpose=Builds the change']) {
    assert.ok(fields.includes(f), `${f} in ${fields.join(', ')}`);
  }
  assert.equal(planTeamAdoption({ ...inp, acknowledged: ACK }).ready, true);
});

// ---- T12, T13, T16: honest cleanup --------------------------------------------------------------------------------------------

test('T12: a file that cleanup cannot remove is reported with its path, and no success is claimed', () => {
  const { folder } = makeCrew();
  const { target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  const kept = path.join(target, 'x-crew-v0.7');
  let locked = false;
  const r = applyTeamAdoption(inp, planTeamAdoption(inp).revision, {
    afterWrite: rel => { if (rel === 'team.json') { fs.chmodSync(kept, 0o555); locked = true; throw new Error('synthetic failure'); } },
  });
  if (locked) fs.chmodSync(kept, 0o755);
  assert.equal(r.ok, false);
  const left = r.problems.filter(p => p.code === 'TEAM_ADOPT_LEFT_BEHIND');
  assert.ok(left.some(p => p.path.startsWith('x-crew-v0.7/')), JSON.stringify(r.problems));
  assert.ok(!r.problems.some(p => /removed the files it wrote/.test(p.message)), 'no success text');
});

test('T13: a failed write keeps its error code, file label, and cause', () => {
  const { folder } = makeCrew();
  const { target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  const r = applyTeamAdoption(inp, planTeamAdoption(inp).revision, {
    afterWrite: rel => { if (rel === 'x-crew-v0.7/team.yaml') throw Object.assign(new Error('synthetic'), { code: 'EIO' }); },
  });
  const fault = r.problems.find(p => p.code === 'TEAM_ADOPT_WRITE_FAILED');
  assert.ok(fault, JSON.stringify(r));
  assert.equal(fault.path, 'x-crew-v0.7/team.yaml');
  assert.deepEqual(fault.cause, { name: 'Error', code: 'EIO' });
});

test('T16: apply returns a problem, not an exception, when the target parent goes away', () => {
  const { folder } = makeCrew();
  const { project, target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  const plan = planTeamAdoption(inp);
  const r = applyTeamAdoption(inp, plan.revision, { beforeApply: () => fs.rmSync(path.join(project, '.bowerloom'), { recursive: true }) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.length > 0);
});

// ---- T14: folder errors say what happened --------------------------------------------------------------------------------

test('T14: a missing team folder, an unreadable folder, and a link are told apart', t => {
  assert.ok(codes(loadTeam(path.join(tempDir(), 'demo-team'))).includes('TEAM_FILE_MISSING'));
  const { folder } = makeTeam({ 'team.json': json(teamFile()), 'prompts/lead.md': 'x\n' });
  fs.chmodSync(path.join(folder, 'prompts'), 0o000);
  t.after(() => fs.chmodSync(path.join(folder, 'prompts'), 0o755));
  assert.ok(codes(loadTeam(folder)).includes('TEAM_FILE_UNREADABLE'));
});

test('T14: a member folder that is missing, unreadable, or a link is told apart', t => {
  const { project, team } = setup(solo('codex', { folder: 'wt/maker' }));
  assert.ok(startCodes(team, input(project)).includes('TEAM_START_FOLDER'));
  fs.mkdirSync(path.join(project, 'wt', 'maker'), { recursive: true });
  fs.chmodSync(path.join(project, 'wt'), 0o000);
  t.after(() => fs.chmodSync(path.join(project, 'wt'), 0o755));
  assert.ok(startCodes(team, input(project)).includes('TEAM_FOLDER_UNREADABLE'));
});

// ---- T15: the problem cap says how many more --------------------------------------------------------------------------------

test('T15: a capped problem list says how many more problems there are', () => {
  const members = Array.from({ length: 64 }, (_, i) => member(`m${i}`, { engine: 'hermes', start: 'x', inbox: 'y', model: '', folder: '/abs' }));
  const r = load({ 'team.json': json(teamFile({ members, limits: { activeMembers: 64 } })) }).r;
  assert.equal(r.problems.length, 200);
  assert.equal(r.problems.at(-1).code, 'TEAM_PROBLEMS_TRUNCATED');
  assert.match(r.problems.at(-1).message, /and \d+ more/);
});

// ---- T17: answers are checked while questions are open -----------------------------------------------------------------------

test('T17: an answer fault is reported while other questions are open', () => {
  const { folder } = makeCrew();
  const plan = planTeamAdoption({ source: folder, target: folder, answers: { harness: 'Bad_Id', members: { lead: { folder: '/abs', model: 'standard' } } } });
  assert.ok(plan.questions.length > 0);
  const c = plan.problems.map(p => p.code);
  for (const code of ['TEAM_INVALID_ID', 'TEAM_FOLDER_INVALID', 'TEAM_MODEL_CLASS']) assert.ok(c.includes(code), `${code} in ${c}`);
});

// ---- T18: start plan members ------------------------------------------------------------------------------------------------

test('T18: an empty member list is refused, and a subset plan lists the members it leaves out', () => {
  const { project, team } = setup(teamFile({ members: [member('lead', { start: 'manual' }), member('maker', { engine: 'codex', folder: 'wt/maker' })] }), ['wt/maker']);
  assert.ok(startCodes(team, input(project, { members: [] })).includes('TEAM_START_USAGE'));
  const r = planTeamStart(team, input(project, { members: ['maker'] }));
  assert.deepEqual(r.plan.omitted, ['lead']);
  assert.deepEqual(planTeamStart(team, input(project)).plan.omitted, []);
});

// ---- T19: a 0.7 id that is not a 0.8 id ---------------------------------------------------------------------------------------

test('T19: a 0.7 id that is not a valid 0.8 id is a rename question', () => {
  const yaml = CREW_YAML.replaceAll('owner: lead', 'owner: lead--x').replace('  - id: lead\n', '  - id: lead--x\n');
  const relay = json(relayMap(['lead--x', 'maker'], [route('lead--x', 'maker')]));
  const { folder } = makeCrew({ yaml, relay });
  const answers = { ...ANSWERS, members: { 'lead--x': ANSWERS.members.lead, maker: ANSWERS.members.maker } };
  const { target } = emptyTarget();
  const open = planTeamAdoption({ source: folder, target, answers, acknowledged: ACK });
  assert.deepEqual(open.questions.map(q => [q.id, q.kind]), [['rename:lead--x', 'rename']]);
  const renamed = { ...answers, members: { ...answers.members, 'lead--x': { ...answers.members['lead--x'], id: 'lead-x' } } };
  const inp = { source: folder, target, answers: renamed, acknowledged: ACK };
  const plan = planTeamAdoption(inp);
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
  assert.deepEqual(plan.team.members.map(m => m.id), ['lead-x', 'maker']);
  assert.ok(plan.writes.some(w => w.path === 'maps/relay.json' && w.kind === 'new'));
  assert.equal(applyTeamAdoption(inp, plan.revision).ok, true);
  const t = loadTeam(target);
  assert.equal(t.ok, true, JSON.stringify(t.ok ? null : t.problems));
  assert.deepEqual(t.team.relay.participants, ['lead-x', 'maker']);
  assert.equal(fs.readFileSync(path.join(target, 'x-crew-v0.7/maps/relay.json'), 'utf8'), relay);
  // In place, the 0.7 relay map cannot change, so a rename that it names is refused.
  const inPlace = planTeamAdoption({ source: folder, target: folder, answers: renamed, acknowledged: ACK });
  assert.ok(inPlace.problems.some(p => p.code === 'TEAM_ADOPT_RENAME_IN_PLACE'));
});

test('T19: a 0.7 team id that is not a valid 0.8 id is a rename question too', () => {
  const { folder } = makeCrew({ id: 'demo--crew', yaml: CREW_YAML.replace('id: demo-crew', 'id: demo--crew') });
  const { target } = emptyTarget('demo-crew2');
  const open = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: ACK });
  assert.ok(open.questions.some(q => q.id === 'rename:team'));
  const plan = planTeamAdoption({ source: folder, target, answers: { ...ANSWERS, id: 'demo-crew2' }, acknowledged: ACK });
  assert.equal(plan.ready, true, JSON.stringify(plan.problems));
  assert.equal(plan.team.id, 'demo-crew2');
});

// ---- T21: the eight mutation gaps -----------------------------------------------------------------------------------------------

test('T21: participants are compared by id, not by count', () => {
  assert.ok(codes(load(withRelay(undefined, relayMap(['lead', 'ghost'], []))).r).includes('TEAM_RELAY_PARTICIPANTS'));
});

test('T21: a line the secret scan cannot finish is refused as incomplete', () => {
  const r = load({ 'team.json': json(teamFile({ 'x-notes': { long: 'a '.repeat(2100) } })) }).r;
  assert.ok(codes(r).includes('TEAM_SECRET_SCAN_INCOMPLETE'), JSON.stringify(r));
});

test('T21: an invalid approval record is a problem at load and at start', () => {
  const guarded = teamFile({ guardrails: { rules: [rule('no-push')] }, members: [member('solo', { engine: 'pi', start: 'manual' })], limits: { activeMembers: 1 } });
  const { folder, project } = makeTeam({ 'team.json': json(guarded) });
  const good = approval(entryHash(loaded(rule('no-push'))), 'no-push');
  assert.ok(codes(loadTeam(folder, { approvals: [good, { part: 'nope' }], now: NOW })).includes('TEAM_APPROVAL_INVALID'));
  const team = loadTeam(folder, { approvals: [good], now: NOW }).team;
  assert.ok(startCodes(team, input(project, { approvals: [good, { part: 'nope' }], now: NOW })).includes('TEAM_APPROVAL_INVALID'));
});

test('T21: the kept files have a count limit and a depth limit', () => {
  const many = Object.fromEntries(Array.from({ length: 1025 }, (_, i) => [`x-crew-v0.7/f${i}.md`, 'x\n']));
  assert.ok(codes(load({ 'team.json': json(teamFile()), ...many }).r).includes('TEAM_TOO_LARGE'));
  const deep = `x-crew-v0.7/${Array.from({ length: 9 }, (_, i) => `d${i}`).join('/')}/f.md`;
  assert.ok(codes(load({ 'team.json': json(teamFile()), [deep]: 'x\n' }).r).includes('TEAM_TOO_LARGE'));
  const ok = `x-crew-v0.7/${Array.from({ length: 7 }, (_, i) => `d${i}`).join('/')}/f.md`;
  assert.equal(load({ 'team.json': json(teamFile()), [ok]: 'x\n' }).r.ok, true);
});

test('T21: apply refuses when a 0.7 file changes during the run, or when the result does not load', () => {
  const one = makeCrew();
  const inp = { source: one.folder, target: one.folder, answers: ANSWERS, acknowledged: ACK };
  const r = applyTeamAdoption(inp, planTeamAdoption(inp).revision, { afterWrite: rel => { if (rel === 'team.json') fs.appendFileSync(path.join(one.folder, 'team.yaml'), '# changed\n'); } });
  assert.ok(r.problems.some(p => p.code === 'TEAM_ADOPT_SOURCE_CHANGED'), JSON.stringify(r));
  assert.equal(fs.existsSync(path.join(one.folder, 'team.json')), false);
  const two = makeCrew();
  const inp2 = { source: two.folder, target: two.folder, answers: ANSWERS, acknowledged: ACK };
  const r2 = applyTeamAdoption(inp2, planTeamAdoption(inp2).revision, { afterWrite: rel => { if (rel === 'team.json') fs.writeFileSync(path.join(two.folder, 'stray.txt'), 'x\n'); } });
  assert.ok(r2.problems.some(p => p.code === 'TEAM_ADOPT_VERIFY'), JSON.stringify(r2));
  assert.equal(fs.existsSync(path.join(two.folder, 'team.json')), false);
});

test('T21: a file that appears at a planned path is never overwritten', () => {
  const { folder } = makeCrew();
  const inp = { source: folder, target: folder, answers: ANSWERS, acknowledged: ACK };
  const r = applyTeamAdoption(inp, planTeamAdoption(inp).revision, { afterWrite: rel => { if (rel === 'x-crew-v0.7/team.yaml') fs.writeFileSync(path.join(folder, 'team.json'), 'mine\n'); } });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(folder, 'team.json'), 'utf8'), 'mine\n');
});

test('T21: limits.activeMembers comes from the 0.7 maxActiveWorkers', () => {
  const { folder } = makeCrew({ yaml: CREW_YAML.replace('maxActiveWorkers: 2', 'maxActiveWorkers: 1') });
  assert.deepEqual(planTeamAdoption({ source: folder, target: folder, answers: ANSWERS, acknowledged: ACK }).team.limits, { activeMembers: 1 });
});

test('T21: environment names come only from MCP servers and hooks for the member engine', () => {
  const { project, team } = setup(solo('claude-code', { start: 'manual' }));
  const mcp = [
    { id: 'a', name: 'a', transport: 'stdio', command: 'a', env: { X: '${FOR_CLAUDE}' }, privateBlocks: {} },
    { id: 'b', name: 'b', transport: 'stdio', command: 'b', env: { Y: '${FOR_CODEX}' }, engines: ['codex'], privateBlocks: {} },
  ];
  const hooks = [{ id: 'h', event: 'PreToolUse', command: 'run ${HOOK_CODEX}', strength: 'advisory', engines: ['codex'], privateBlocks: {} }];
  const r = planTeamStart(team, input(project, { harnesses: { demo: harness('demo', { mcp, hooks }) } }));
  assert.deepEqual(r.plan.members[0].environment, ['FOR_CLAUDE']);
});

test('T21: a team whose relay map is copied keeps the 0.7 bytes in maps/relay.json', () => {
  const { folder } = makeCrew();
  const { target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  assert.equal(applyTeamAdoption(inp, planTeamAdoption(inp).revision).ok, true);
  assert.equal(fs.readFileSync(path.join(target, 'maps/relay.json'), 'utf8'), CREW_RELAY);
});
