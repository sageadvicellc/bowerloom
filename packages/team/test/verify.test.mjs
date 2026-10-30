// Verification review V1 to V11 of step 4, lane B (e77ac5e..25e2d80).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyTeamAdoption, bypassPointers, confineFolder, loadTeam, namesWidening, planTeamAdoption, planTeamStart,
} from '../../../dist/packages/team/src/index.js';
import {
  CREW_YAML, FAKE_TOKEN, cleanup, codes, emptyTarget, json, makeCrew, makeTeam, member, rule, teamFile, tempDir,
} from './fixture.mjs';

test.after(cleanup);

const ACK = ['owner-permissions', 'budget-reserve', 'required-capabilities', 'paid-fallback'];
const ANSWERS = Object.freeze({
  harness: 'demo',
  members: { lead: { engine: 'claude-code', model: 'model-a' }, maker: { engine: 'codex', model: 'model-b', folder: 'wt/maker' } },
});
const VERSIONS = Object.freeze({ 'claude-code': '2.1.310', codex: '0.157.0', opencode: '1.18.30', pi: '1.4.0', 'deepseek-harness': '0.2.2-alpha.2' });
const harness = (rules = []) => ({ revision: `sha256:${'a'.repeat(64)}`, harness: { id: 'demo', engines: [{ id: 'codex' }, { id: 'claude-code' }] }, entries: { rules, sandbox: [], mcp: [], hooks: [] } });
const NO_ENV = Object.freeze({});

/** A home folder with a project in it, and the named folders made beside the project. */
function homeWith(...dirs) {
  const home = tempDir('bowerloom-team-home-');
  const project = path.join(home, 'proj');
  fs.mkdirSync(project, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(home, d), { recursive: true });
  return { home, project };
}
const confine = (project, folder, home, extra = {}) => confineFolder(project, folder, { mustExist: false, home, env: NO_ENV, ...extra });

// ---- V1: letter case and the native real path ------------------------------------------------------------------------

test('V1: a config folder named in another letter case is still refused', () => {
  const { home, project } = homeWith('.claude', '.codex');
  for (const folder of ['../.CLAUDE', '../.Claude', '../.CODEX']) {
    const r = confine(project, folder, home);
    assert.equal(r.ok, false, folder);
    assert.equal(r.code, 'TEAM_FOLDER_OUTSIDE', folder);
  }
});

test('V1: a project path given in another letter case is checked by its real path', t => {
  const { home, project } = homeWith('.claude');
  const variant = project.replace(`${path.sep}proj`, `${path.sep}PROJ`);
  if (!fs.existsSync(variant)) { t.skip('this file system tells letter case apart'); return; }
  assert.equal(confine(variant, '../.claude', home).code, 'TEAM_FOLDER_OUTSIDE');
  const homeVariant = home.replace('bowerloom-team-home-', 'BOWERLOOM-TEAM-HOME-');
  assert.equal(confineFolder(homeVariant, '.', { mustExist: false, home, env: NO_ENV }).code, 'TEAM_FOLDER_OUTSIDE', 'the home folder in another case');
  assert.equal(confineFolder(path.join(homeVariant, 'proj'), '.', { mustExist: false, home, env: NO_ENV }).ok, true);
});

// ---- V2: the whole role is scanned before it is cut --------------------------------------------------------------------

test('V2: a secret that straddles the cut of a role is not shown', () => {
  for (const cut of [100, 110, 118]) {
    const { folder } = makeCrew({ yaml: CREW_YAML.replace('role: Plans the change', `role: ${'x'.repeat(cut)} ${FAKE_TOKEN}`) });
    const ask = planTeamAdoption({ source: folder, target: folder }).questions.find(q => q.id === 'engine:lead').ask;
    assert.ok(!/ghp_/.test(ask), `cut ${cut}: ${ask}`);
  }
});

// ---- V3: copies fit the loader's depth -------------------------------------------------------------------------------------

test('V3: a ready plan never fails verify on depth', () => {
  for (const levels of [5, 6, 7]) {
    const { folder } = makeCrew();
    let d = path.join(folder, 'skills', 's');
    fs.mkdirSync(d, { recursive: true });
    for (let i = 0; i < levels; i++) { d = path.join(d, `d${i}`); fs.mkdirSync(d); }
    fs.writeFileSync(path.join(d, 'f.md'), 'x\n');
    const { target } = emptyTarget();
    const first = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: ACK });
    const inp = { source: folder, target, answers: ANSWERS, acknowledged: [...ACK, ...first.notCarried.map(n => n.id)] };
    const plan = planTeamAdoption(inp);
    assert.equal(plan.ready, true, `${levels}: ${JSON.stringify(plan.problems)}`);
    const r = applyTeamAdoption(inp, plan.revision);
    assert.equal(r.ok, true, `${levels} levels: ${JSON.stringify(r)}`);
    if (levels >= 6) assert.ok(first.notCarried.some(n => n.path.startsWith('skills/s/d')), `${levels}: the deep folder is listed`);
  }
});

// ---- V4: Codex reads no user config or rules ---------------------------------------------------------------------------

test('V4: the Codex command ignores user config and rules files', () => {
  const { project, folder } = makeTeam({ 'team.json': json(teamFile({ members: [member('solo', { engine: 'codex' })], limits: { activeMembers: 1 } })) });
  const team = loadTeam(folder).team;
  const r = planTeamStart(team, { projectDir: project, versions: VERSIONS, harnesses: { demo: harness() }, home: tempDir(), env: NO_ENV });
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  const cmd = r.plan.members[0].command;
  assert.deepEqual(cmd.argv, ['codex', '-c', 'approval_policy="never"', 'exec', '--ignore-user-config', '--ignore-rules', '--json', '--sandbox', 'workspace-write', '-m', 'model-a', '-']);
  assert.match(cmd.ambient, /--ignore-user-config/);
  // --ignore-rules can drop the projected .codex/rules. A member whose Codex form writes a rule there does not start.
  const withRule = planTeamStart(team, { projectDir: project, versions: VERSIONS, harnesses: { demo: harness([{ ...rule('no-push'), privateBlocks: {} }]) }, home: tempDir(), env: NO_ENV });
  assert.equal(withRule.ok, false);
  assert.ok(withRule.problems.some(p => p.code === 'TEAM_START_UNPINNED' && /ignore-rules/.test(p.message)), JSON.stringify(withRule.problems));
});

// ---- B6: --sandbox and the Codex permission profile ---------------------------------------------------------------------

test('B6: an unattended Codex member whose guardrails write the permission profile does not start, because --sandbox was not live-checked with it', () => {
  const { project, folder } = makeTeam({ 'team.json': json(teamFile({ members: [member('solo', { engine: 'codex' })], limits: { activeMembers: 1 } })) });
  const team = loadTeam(folder).team;
  const plan = rules => planTeamStart(team, { projectDir: project, versions: VERSIONS, harnesses: { demo: harness(rules) }, home: tempDir(), env: NO_ENV, approvals: [] });
  const withPath = plan([{ ...rule('no-env'), action: 'read', pattern: '.env', privateBlocks: {} }]);
  assert.equal(withPath.ok, false);
  assert.ok(withPath.problems.some(p => p.code === 'TEAM_START_UNPINNED' && /--sandbox/.test(p.message) && /permission profile/.test(p.message)), JSON.stringify(withPath.problems));
  // A harness with no path rule and no sandbox writes no profile, so the check stays quiet.
  assert.equal(plan([]).ok, true);
  // A sandbox requirement alone, in the harness, writes the profile too.
  const box = planTeamStart(team, { projectDir: project, versions: VERSIONS, harnesses: { demo: { ...harness(), entries: { ...harness().entries, sandbox: [{ id: 'box', files: true, network: true, strength: 'advisory', privateBlocks: {} }] } } }, home: tempDir(), env: NO_ENV });
  assert.ok(!box.ok && box.problems.some(p => p.code === 'TEAM_START_UNPINNED' && /--sandbox/.test(p.message)), JSON.stringify(box.problems));
  // A manual start runs no command, so the check stays quiet.
  const manual = makeTeam({ 'team.json': json(teamFile({ members: [member('solo', { engine: 'codex', start: 'manual' })], limits: { activeMembers: 1 } })) });
  const quiet = planTeamStart(loadTeam(manual.folder).team, { projectDir: manual.project, versions: VERSIONS, harnesses: { demo: harness([{ ...rule('no-env'), action: 'read', pattern: '.env', privateBlocks: {} }]) }, home: tempDir(), env: NO_ENV });
  assert.equal(quiet.ok ? false : quiet.problems.some(p => p.code === 'TEAM_START_UNPINNED'), false, JSON.stringify(quiet.ok ? null : quiet.problems));
});

// ---- V5: more characters that one-line text refuses -------------------------------------------------------------------

test('V5: one-line text refuses line and paragraph separators, variation selectors, and private-use characters', () => {
  for (const s of ['a b', 'a b', 'a️b', 'a︀b', 'a\u{E0100}b', 'a\u{E01EF}b', 'ab', 'a\u{F0000}b']) {
    const { folder } = makeTeam({ 'team.json': json(teamFile({ members: [member('solo', { purpose: `Plans ${s} it.` })], limits: { activeMembers: 1 } })) });
    assert.ok(codes(loadTeam(folder)).includes('TEAM_INVALID_FIELD'), JSON.stringify(s));
  }
});

// ---- V6: a wider denylist -----------------------------------------------------------------------------------------------

test('V6: more widening forms in text are refused', () => {
  for (const t of ['codex -a never exec', 'codex -a=never', '--approval-mode yolo', '--approval-mode=yolo', '--dangerously-allow-all',
    '--no-sandbox', 'network_access = true', '--allowedTools Bash(*)', '--allowedTools "Bash"', 'approval_policy​never',
    'approval_policy%20never', '\\u0064anger-full-access', 'danger full access', 'approval policy never']) {
    assert.equal(namesWidening(t), true, JSON.stringify(t));
  }
  for (const t of ['We accept edits from the reviewer.', '--allowedTools "Bash(git status)"', 'a never-ending list', 'Network access is off.']) {
    assert.equal(namesWidening(t), false, JSON.stringify(t));
  }
});

test('V6: widening forms split across sibling keys, list neighbours, and nested values are refused', () => {
  for (const j of [
    { a: 'approval_policy', b: 'never' }, { name: 'approval_policy', value: 'never' }, { flag: '--ask-for-approval', value: 'never' },
    ['danger-', 'full-access'], ['--ask-for-', 'approval', 'never'], ['-c', 'approval_policy', '=', 'never'], ['approval_policy', ['never']],
    { approval_policy: { mode: 'never' } }, { approval_policy: ['never'] }, { x: ['approval_policy', 5, 'never'] },
    { k: 'sandbox', v: 'danger-', w: 'full-access' }, ['-a', 'never'], { network_access: true }, { allowedTools: ['Bash(*)'] },
  ]) assert.ok(bypassPointers(j).length > 0, JSON.stringify(j));
  assert.deepEqual(bypassPointers({ approval_policy: 'on-request', note: 'never mind' }), []);
});

// ---- V7: 0.8 files in the source are listed ----------------------------------------------------------------------------

test('V7: a source team.json or x-crew-v0.7 folder is listed in notCarried', () => {
  const { folder } = makeCrew({ extra: { 'team.json': '{}\n', 'x-crew-v0.7/old.md': 'old\n' } });
  const { target } = emptyTarget();
  const plan = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: ACK });
  const listed = plan.notCarried.map(n => n.path).sort();
  assert.deepEqual(listed, ['team.json', 'x-crew-v0.7']);
  for (const n of plan.notCarried) assert.match(n.reason, /0\.8/);
});

// ---- V8: more 0.7 fields that map to nothing ------------------------------------------------------------------------------

test('V8: notMapped lists reservePercent, requiredCapabilities, and paidFallback', () => {
  const { folder } = makeCrew();
  const plan = planTeamAdoption({ source: folder, target: folder, answers: ANSWERS });
  assert.deepEqual(plan.notMapped.map(n => n.id).sort(), [...ACK].sort());
  assert.equal(planTeamAdoption({ source: folder, target: folder, answers: ANSWERS, acknowledged: ACK.slice(0, 3) }).ready, false);
  assert.equal(planTeamAdoption({ source: folder, target: folder, answers: ANSWERS, acknowledged: ACK }).ready, true);
});

// ---- V9: no link between the project and teams/ -------------------------------------------------------------------------

test('V9: a link at .bowerloom or teams/ is refused', () => {
  const { folder } = makeCrew();
  for (const at of ['.bowerloom', '.bowerloom/teams']) {
    const project = tempDir();
    const elsewhere = tempDir();
    if (at === '.bowerloom') { fs.mkdirSync(path.join(elsewhere, 'teams')); fs.symlinkSync(elsewhere, path.join(project, '.bowerloom')); }
    else { fs.mkdirSync(path.join(project, '.bowerloom')); fs.symlinkSync(elsewhere, path.join(project, '.bowerloom', 'teams')); }
    const plan = planTeamAdoption({ source: folder, target: path.join(project, '.bowerloom', 'teams', 'demo-crew'), answers: ANSWERS, acknowledged: ACK });
    assert.equal(plan.ready, false, at);
    assert.ok(plan.problems.some(p => p.code === 'TEAM_ADOPT_TARGET_LINK'), `${at}: ${JSON.stringify(plan.problems)}`);
  }
});

// ---- V10: more refused folders ---------------------------------------------------------------------------------------

test('V10: more user folders are refused', () => {
  const names = ['.ssh', '.aws', '.gnupg', 'Library', '.gemini', '.cursor'];
  const { home, project } = homeWith(...names);
  for (const n of names) assert.equal(confine(project, `../${n}`, home).code, 'TEAM_FOLDER_OUTSIDE', n);
});

test('V10: the folders that XDG_CONFIG_HOME, CODEX_HOME, and CLAUDE_CONFIG_DIR name are refused, and never shown', () => {
  const { home, project } = homeWith('cfg-x', 'cfg-codex', 'cfg-claude');
  for (const [name, dir] of [['XDG_CONFIG_HOME', 'cfg-x'], ['CODEX_HOME', 'cfg-codex'], ['CLAUDE_CONFIG_DIR', 'cfg-claude']]) {
    const r = confine(project, `../${dir}`, home, { env: { [name]: path.join(home, dir) } });
    assert.equal(r.code, 'TEAM_FOLDER_OUTSIDE', name);
    assert.ok(r.message.includes(name) && !r.message.includes(dir), r.message);
    assert.equal(confine(project, `../${dir}`, home).ok, true, `${name} unset`);
  }
});

test('V10: project-level .git, .claude, .codex, and .bowerloom are not member folders', () => {
  const { home, project } = homeWith();
  for (const folder of ['.git', '.git/hooks', '.claude', '.claude/agents', '.codex', '.bowerloom', '.bowerloom/teams', '.GIT']) {
    assert.equal(confine(project, folder, home).code, 'TEAM_FOLDER_RESERVED', folder);
  }
  assert.equal(confine(project, 'wt/.git-notes', home).ok, true);
});

// ---- V11: crash leftovers, created folders, size, and modes ----------------------------------------------------------

test('V11: a folder left by a crashed adoption is named, with how to clear it', () => {
  const { folder } = makeCrew();
  const { target } = emptyTarget();
  fs.mkdirSync(path.join(target, 'x-crew-v0.7'), { recursive: true });
  const p = planTeamAdoption({ source: folder, target, answers: ANSWERS, acknowledged: ACK }).problems.find(x => x.code === 'TEAM_ADOPT_EXISTS');
  assert.ok(p, 'TEAM_ADOPT_EXISTS');
  assert.match(p.message, /\.bowerloom\/teams\/demo-crew\/x-crew-v0\.7/);
  assert.match(p.message, /remove/i);
});

test('V11: a folder is recorded the moment it is made, so a failure right after removes it', () => {
  const { folder } = makeCrew();
  const { target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  const r = applyTeamAdoption(inp, planTeamAdoption(inp).revision, { afterMkdir: rel => { if (rel.endsWith('x-crew-v0.7')) throw new Error('synthetic failure'); } });
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.join(target, 'x-crew-v0.7')), false, 'the folder made just before the failure is gone');
  assert.ok(!r.problems.some(p => p.code === 'TEAM_ADOPT_LEFT_BEHIND'), JSON.stringify(r.problems));
});

test('V11: the loader and adoption share a total size cap', () => {
  const big = 'a'.repeat(1_000_000);
  const files = Object.fromEntries(Array.from({ length: 34 }, (_, i) => [`x-crew-v0.7/f${i}.md`, big]));
  assert.ok(codes(loadTeam(makeTeam({ 'team.json': json(teamFile()), ...files }).folder)).includes('TEAM_TOO_LARGE'));
  const extra = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`assets/f${i}.md`, big]));
  const { folder } = makeCrew({ extra });
  const plan = planTeamAdoption({ source: folder, target: folder, answers: ANSWERS, acknowledged: ACK });
  assert.equal(plan.ready, false);
  assert.ok(plan.problems.some(p => p.code === 'TEAM_TOO_LARGE'), JSON.stringify(plan.problems.map(p => p.code)));
});

test('V11: a copied file keeps its execute bit', () => {
  const { folder } = makeCrew({ extra: { 'prompts/run.sh': '#!/bin/sh\necho ok\n' } });
  fs.chmodSync(path.join(folder, 'prompts', 'run.sh'), 0o755);
  const { target } = emptyTarget();
  const inp = { source: folder, target, answers: ANSWERS, acknowledged: ACK };
  assert.equal(applyTeamAdoption(inp, planTeamAdoption(inp).revision).ok, true);
  assert.notEqual(fs.statSync(path.join(target, 'x-crew-v0.7', 'prompts', 'run.sh')).mode & 0o111, 0);
  assert.equal(fs.statSync(path.join(target, 'x-crew-v0.7', 'prompts', 'lead.md')).mode & 0o111, 0);
});
