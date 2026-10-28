// Teams and relay spec, sections 6, 7, and 8; decisions 7 and 9. Acceptance checks 13 and 14 of section 11.
// Checks 7 to 12 need the relay bus, which decision 7 keeps out of 0.8; they are listed as todo below.
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULTS, entryHash } from '../../../dist/packages/harness-definition/src/index.js';
import { DELIVERY_TABLE, loadTeam, namesBypass, planTeamStart } from '../../../dist/packages/team/src/index.js';
import { NOW, approval, cleanup, json, makeTeam, member, relayMap, route, rule, teamFile, tempDir } from './fixture.mjs';

test.after(cleanup);

const VERSIONS = Object.freeze({ 'claude-code': '2.1.310', codex: '0.157.0', opencode: '1.18.30', pi: '1.4.0', 'deepseek-harness': '0.2.2-alpha.2' });
const ALL = ['claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'];
function harness(id = 'demo', { engines = ALL, rules = [], mcp = [], hooks = [] } = {}) {
  return { revision: `sha256:${'a'.repeat(64)}`, harness: { id, engines: engines.map(e => ({ id: e })) }, entries: { rules, sandbox: [], mcp, hooks } };
}
const loadedRule = (id, extra) => ({ ...rule(id, extra), privateBlocks: {} });

/** Loads a team and returns it with its project folder. Member folders are created. */
function setup(team = teamFile(), files = {}, folders = ['wt/maker']) {
  const { project, folder } = makeTeam({ 'team.json': json(team), ...files }, { folders });
  const r = loadTeam(folder);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return { project, team: r.team };
}
const HOME = tempDir('bowerloom-team-home-');
const input = (project, extra = {}) => ({ projectDir: project, versions: VERSIONS, harnesses: { demo: harness() }, home: HOME, ...extra });
const planned = (team, inp) => {
  const r = planTeamStart(team, inp);
  assert.equal(r.ok, true, JSON.stringify(r.ok ? null : r.problems));
  return r.plan;
};
const refusedStart = (team, inp, code) => {
  const r = planTeamStart(team, inp);
  assert.equal(r.ok, false, `expected ${code}`);
  assert.ok(r.problems.map(p => p.code).includes(code), `expected ${code}, got ${JSON.stringify(r.problems)}`);
  return r.problems;
};
const solo = (engine, extra = {}) => teamFile({ members: [member('solo', { engine, ...extra })], limits: { activeMembers: 1 } });

// ---- the plan (section 8, rule 3) ------------------------------------------------------------------------------------------

test('the plan lists each member: folder, engine and version, command, environment names, and delivery mode', () => {
  const { project, team } = setup();
  const plan = planned(team, input(project));
  assert.equal(plan.format, 'bowerloom/team-start-plan/v1beta1');
  assert.equal(plan.startsAuthorized, false, 'a person approves the plan before any instance starts');
  assert.match(plan.revision, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(plan.team, { id: 'demo-team', revision: team.revision });
  const [lead, maker] = plan.members;
  assert.equal(lead.folder, project);
  assert.equal(maker.folder, path.join(project, 'wt', 'maker'));
  assert.deepEqual([lead.engine, lead.version, maker.engine, maker.version], ['claude-code', '2.1.310', 'codex', '0.157.0']);
  assert.deepEqual(lead.harness, { id: 'demo', revision: `sha256:${'a'.repeat(64)}`, from: 'team' });
  assert.deepEqual(lead.command.argv, [
    'claude', '--print', '--model', 'model-a', '--output-format', 'json', '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--settings', '{"crossSessionInbound":"accept","sandbox":{"enabled":true,"allowUnsandboxedCommands":false}}',
  ]);
  assert.equal(lead.command.cwd, project);
  assert.equal(lead.command.stdin, 'message');
  assert.deepEqual(maker.command.argv, ['codex', '-c', 'approval_policy="never"', 'exec', '--json', '--sandbox', 'workspace-write', '-m', 'model-b', '-']);
  for (const m of plan.members) {
    assert.ok(Array.isArray(m.environment));
    assert.ok(!namesBypass(m.command.argv.join(' ')), 'no command holds a bypass flag');
    assert.ok(DELIVERY_TABLE[m.engine].modes.includes(m.delivery.mode));
  }
  assert.equal(lead.billing.source, 'subscription');
  assert.equal(maker.billing.source, 'not-recorded');
});

test('the inbox word of a Claude Code member becomes its crossSessionInbound setting', () => {
  const { project, team } = setup(solo('claude-code', { inbox: 'refuse' }), {}, []);
  assert.equal(JSON.parse(planned(team, input(project)).members[0].command.argv.at(-1)).crossSessionInbound, 'refuse');
});

test('the environment lists names from the member harness, never values', () => {
  const { project, team } = setup(solo('claude-code'), {}, []);
  const mcp = [{ id: 'docs', name: 'docs', transport: 'stdio', command: 'docs-server', args: ['--url', '${DEMO_URL}'], env: { DEMO_TOKEN: '${DEMO_TOKEN}', MODE: 'plain', KEY: { keychain: 'demo-entry' } }, privateBlocks: {} }];
  const hooks = [{ id: 'check', event: 'PreToolUse', command: '${PROJECT_DIR}/scripts/check ${DEMO_HOOK_VAR}', strength: 'advisory', privateBlocks: {} }];
  const plan = planned(team, input(project, { harnesses: { demo: harness('demo', { mcp, hooks }) } }));
  // ${PROJECT_DIR} is the neutral hook placeholder that projection rewrites, not a name a person sets.
  assert.deepEqual(plan.members[0].environment, ['DEMO_HOOK_VAR', 'DEMO_TOKEN', 'DEMO_URL']);
  assert.ok(!JSON.stringify(plan).includes('demo-entry'));
});

test('a manual member has no command: a person starts it', () => {
  const { project, team } = setup(solo('pi', { start: 'manual' }), {}, []);
  const m = planned(team, input(project)).members[0];
  assert.equal(m.command, null);
  assert.equal(m.start, 'manual');
});

test('the revision follows the inputs', () => {
  const { project, team } = setup();
  const a = planned(team, input(project)).revision;
  assert.equal(planned(team, input(project)).revision, a);
  assert.notEqual(planned(team, input(project, { versions: { ...VERSIONS, codex: '0.158.0' } })).revision, a);
});

// ---- check 14: every delivery mode in the loss report ------------------------------------------------------------------------

test('check 14: every delivery mode in the start plan appears in the loss report with its result word', () => {
  const team = teamFile({
    members: ALL.map((engine, i) => member(`m${i}`, { engine, start: 'manual', folder: `wt/m${i}` })),
    limits: { activeMembers: 5 },
  });
  const { project, team: loaded } = setup(team, {}, ALL.map((_, i) => `wt/m${i}`));
  const plan = planned(loaded, input(project));
  // T20: one line per member per mode its engine offers; the chosen mode is marked.
  assert.equal(plan.report.length, plan.members.reduce((n, m) => n + DELIVERY_TABLE[m.engine].modes.length, 0));
  for (const m of plan.members) {
    const lines = plan.report.filter(l => l.member === m.id && l.subject === 'delivery');
    assert.deepEqual(lines.map(l => l.mode), [...DELIVERY_TABLE[m.engine].modes], `every mode of ${m.engine}`);
    const chosen = lines.filter(l => l.chosen);
    assert.equal(chosen.length, 1, `one chosen mode for ${m.id}`);
    assert.equal(chosen[0].mode, m.delivery.mode);
    assert.equal(chosen[0].result, m.delivery.result);
    for (const line of lines) {
      assert.equal(line.engine, m.engine);
      assert.ok(RESULTS.includes(line.result));
      assert.ok(line.reason.includes(line.mode) && line.reason.includes(DELIVERY_TABLE[m.engine].result));
    }
  }
  // The strongest mode of the section 6 table, and the word it would have with a bus.
  assert.deepEqual(plan.members.map(m => [m.engine, m.delivery.mode]), [
    ['claude-code', 'push'], ['codex', 'turn'], ['opencode', 'push'], ['pi', 'push'], ['deepseek-harness', 'turn'],
  ]);
  assert.deepEqual(ALL.map(e => DELIVERY_TABLE[e].result), ['translated', 'weakened', 'translated', 'translated', 'weakened']);
  // Decision 7: no bus in 0.8, so no mode delivers. The line says so, and names the word a bus would give.
  for (const m of plan.members) {
    assert.equal(m.delivery.result, 'absent');
    assert.match(m.delivery.reason, /decision 7/);
    assert.ok(m.delivery.reason.includes(DELIVERY_TABLE[m.engine].result));
  }
});

test('check 14: a member that refuses messages has an absent delivery line that says so', () => {
  const { project, team } = setup(solo('claude-code', { inbox: 'refuse' }), {}, []);
  for (const line of planned(team, input(project)).report) {
    assert.equal(line.result, 'absent');
    assert.match(line.reason, /refuses/);
  }
});

// ---- check 13: a relay map with no bus starts no socket and no process --------------------------------------------------------

const SPAWNERS = ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'];

test('check 13: a relay map with no bus starts no socket and no process', t => {
  const team = teamFile({ routes: 'maps/relay.json' });
  const { project, folder } = makeTeam({ 'team.json': json(team), 'maps/relay.json': json(relayMap(['lead', 'maker'], [route('lead', 'maker')])) }, { folders: ['wt/maker'] });
  const calls = [];
  const spy = (object, names, label) => {
    for (const name of names) {
      const real = object[name];
      object[name] = (...args) => { calls.push(`${label}.${name}`); throw new Error(`${label}.${name} was called`); };
      t.after(() => { object[name] = real; syncBuiltinESMExports(); });
    }
  };
  spy(childProcess, SPAWNERS, 'child_process');
  spy(net, ['createServer', 'createConnection', 'connect'], 'net');
  spy(net.Server.prototype, ['listen'], 'net.Server');
  spy(net.Socket.prototype, ['connect'], 'net.Socket');
  spy(dgram, ['createSocket'], 'dgram');
  syncBuiltinESMExports();

  const loaded = loadTeam(folder);
  assert.equal(loaded.ok, true, JSON.stringify(loaded.ok ? null : loaded.problems));
  const plan = planned(loaded.team, input(project));
  assert.deepEqual(calls, []);
  assert.deepEqual(plan.relay.map, 'maps/relay.json');
  assert.equal(plan.relay.bus, 'absent');
  assert.equal(plan.relay.sockets, 0);
  assert.equal(plan.relay.processes, 0);
  assert.match(plan.relay.reason, /decision 7/);
  assert.deepEqual(plan.relay.routes, [{ from: 'lead', to: 'maker', what: 'plan.doc to build.doc', delivery: 'accepted-output', movedBy: 'a person' }]);
});

test('check 13: no module the team package reaches loads a process, thread, or network module', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const walker = path.join(root, 'dist/tests/support/module-walk.js');
  const entry = path.join(root, 'dist/packages/team/src/index.js');
  const r = childProcess.spawnSync(process.execPath, ['--experimental-import-meta-resolve', '--no-warnings', walker, entry], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const { files, builtins, opaque, mentions } = JSON.parse(r.stdout);
  assert.ok(files.some(f => f.endsWith('packages/team/src/start.js')), 'the walk reaches the start plan');
  assert.deepEqual(opaque, [], 'a computed load could start a process');
  for (const name of ['child_process', 'worker_threads', 'cluster']) {
    assert.equal(builtins[name], undefined, `the team package reaches ${name} through ${builtins[name]?.join(', ')}`);
  }
  // A shared module may load net for a helper such as isIP; the spy test above shows no socket opens. The team
  // package itself loads no network module at all.
  const own = f => f.includes(`${path.sep}dist${path.sep}packages${path.sep}team${path.sep}`);
  for (const name of ['net', 'dgram', 'http', 'https', 'http2', 'tls']) {
    assert.deepEqual((builtins[name] ?? []).filter(own), [], `the team package loads ${name}`);
  }
  assert.equal(mentions.child_process, undefined, `a reached file names child_process: ${mentions.child_process?.join(', ')}`);
});

// ---- decision 9: an approval that cannot reach a person refuses the start --------------------------------------------------

test('decision 9: an unattended member with a team ask rule is refused; a manual one starts', () => {
  const ask = { guardrails: { rules: [rule('ask-push', { effect: 'ask' })] } };
  const unattended = setup({ ...solo('claude-code'), ...ask }, {}, []);
  const problems = refusedStart(unattended.team, input(unattended.project), 'TEAM_START_APPROVAL_UNREACHABLE');
  assert.ok(problems.some(p => p.message.includes('"ask-push"')));
  const { project, team } = setup({ ...solo('claude-code', { start: 'manual' }), ...ask }, {}, []);
  planned(team, input(project));
});

test('decision 9: an ask rule in the member harness counts too; deny and allow rules do not', () => {
  for (const engine of ['claude-code', 'codex']) {
    const one = setup(solo(engine), {}, []);
    refusedStart(one.team, input(one.project, { harnesses: { demo: harness('demo', { rules: [loadedRule('ask-push', { effect: 'ask' })] }) } }), 'TEAM_START_APPROVAL_UNREACHABLE');
  }
  const { project, team } = setup(solo('claude-code'), {}, []);
  planned(team, input(project, { harnesses: { demo: harness('demo', { rules: [loadedRule('no-push'), loadedRule('read-docs', { action: 'read', pattern: 'docs/**', effect: 'allow', strength: 'advisory' })] }) } }));
  // An ask rule for another engine does not apply.
  planned(team, input(project, { harnesses: { demo: harness('demo', { rules: [loadedRule('ask-codex', { effect: 'ask', engines: ['codex'] })] }) } }));
});

test('decision 9: Codex exec with an MCP server is refused (open issue 24135)', () => {
  const { project, team } = setup(solo('codex'), {}, []);
  const mcp = [{ id: 'docs', name: 'docs', transport: 'http', url: 'https://docs.example.test/mcp', privateBlocks: {} }];
  const problems = refusedStart(team, input(project, { harnesses: { demo: harness('demo', { mcp }) } }), 'TEAM_START_APPROVAL_UNREACHABLE');
  assert.ok(problems.some(p => p.message.includes('24135')));
  // A server filtered to another engine does not apply.
  planned(team, input(project, { harnesses: { demo: harness('demo', { mcp: [{ ...mcp[0], engines: ['claude-code'] }] }) } }));
});

test('decision 9: OpenCode asks for any request no rule matches, so it does not start unattended', () => {
  for (const start of ['headless', 'server']) {
    const { project, team } = setup(solo('opencode', { start }), {}, []);
    refusedStart(team, input(project), 'TEAM_START_APPROVAL_UNREACHABLE');
  }
});

test('decision 9: an unattended start that relies on undocumented behavior is refused', () => {
  for (const engine of ['deepseek-harness', 'pi']) {
    const { project, team } = setup(solo(engine), {}, []);
    refusedStart(team, input(project), 'TEAM_START_UNDOCUMENTED');
  }
});

test('a server start is refused where 0.8 has no server to start or nothing to drive it', () => {
  for (const engine of ['claude-code', 'codex', 'pi', 'deepseek-harness']) {
    const { project, team } = setup(solo(engine, { start: 'server' }), {}, []);
    refusedStart(team, input(project), 'TEAM_START_MODE_UNSUPPORTED');
  }
});

// ---- other refusals ---------------------------------------------------------------------------------------------------------------

test('engine versions: each is recorded, and Claude Code is new enough for --permission-prompts', () => {
  const { project, team } = setup();
  refusedStart(team, input(project, { versions: { 'claude-code': '2.1.310' } }), 'TEAM_START_ENGINE_VERSION');
  refusedStart(team, input(project, { versions: { ...VERSIONS, 'claude-code': '2.1.200' } }), 'TEAM_START_ENGINE_VERSION');
  refusedStart(team, input(project, { versions: { ...VERSIONS, 'claude-code': '2.1.259-beta.1' } }), 'TEAM_START_ENGINE_VERSION');
  refusedStart(team, input(project, { versions: { ...VERSIONS, codex: 'latest' } }), 'TEAM_START_ENGINE_VERSION');
  planned(team, input(project, { versions: { ...VERSIONS, 'claude-code': '2.1.259' } }));
});

test('harnesses: each member harness is given and lists the member engine', () => {
  const { project, team } = setup();
  refusedStart(team, input(project, { harnesses: {} }), 'TEAM_START_HARNESS_MISSING');
  refusedStart(team, input(project, { harnesses: { demo: harness('demo', { engines: ['claude-code'] }) } }), 'TEAM_START_HARNESS_ENGINE');
});

test('folders: a member folder must exist as a real folder', () => {
  const { project, team } = setup(teamFile(), {}, []);
  refusedStart(team, input(project), 'TEAM_START_FOLDER');
});

test('usage and limits: an absolute project folder, known members, and the active member cap', () => {
  const { project, team } = setup();
  refusedStart(team, input('relative/project'), 'TEAM_START_USAGE');
  refusedStart(team, input(project, { members: ['ghost'] }), 'TEAM_START_USAGE');
  const capped = setup(teamFile({ limits: { activeMembers: 1 } }));
  refusedStart(capped.team, input(capped.project), 'TEAM_START_LIMIT');
  assert.deepEqual(planned(capped.team, input(capped.project, { members: ['maker'] })).members.map(m => m.id), ['maker']);
});

test('the start plan judges team guardrails with its own approvals (check 6 again at start)', () => {
  const { project, team } = setup(solo('pi', { start: 'manual' }), {}, []);
  // A team checked with other approvals is judged again with the plan's.
  const withRule = { ...team, file: { ...team.file, guardrails: { rules: [loadedRule('no-push')], sandbox: [] } } };
  refusedStart(withRule, input(project), 'TEAM_GUARDRAIL_NOT_CARRIED');
  planned(withRule, input(project, { approvals: [approval(entryHash(loadedRule('no-push')), 'no-push')], now: NOW }));
});

// ---- checks 7 to 12 need the relay bus --------------------------------------------------------------------------------------

const GATE = 'needs the relay bus: decision 7 keeps it out of 0.8 until the one-week Repowire trial shows demand';
test.todo(`check 7: a message sent twice with one idempotency key is delivered once (${GATE})`);
test.todo(`check 8: a message that holds an approval claim satisfies no prompt, and the receiver's guardrails stay unchanged (${GATE})`);
test.todo(`check 9: a sender sees sent, not delivered, for an engine that gives no acknowledgment (${GATE})`);
test.todo(`check 10: a rename of a member label does not break delivery (${GATE})`);
test.todo(`check 11: a body over 16,384 bytes is refused, and a file path reference works (${GATE})`);
test.todo(`check 12: a two-member loop stops at the message cap and reports the stop (${GATE})`);
