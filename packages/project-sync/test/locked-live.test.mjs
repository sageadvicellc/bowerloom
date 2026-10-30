// Locked-in parts and teams: the live checks of step 5, blueprint section G (checks g4 to g11; g1 to g3 live in
// portable-live.test.mjs; g5 and g12 are runbook steps in tools/step5/live/README.md).
//
// The live tests run only when BOWERLOOM_LIVE_ENGINES=1 and the engine has a command in
//   BOWERLOOM_LIVE_CLAUDE_CODE, BOWERLOOM_LIVE_CODEX, BOWERLOOM_LIVE_OPENCODE
// each a JSON list of words, for example ["claude","-p"]. The version of the engine comes from
// BOWERLOOM_LIVE_<ENGINE>_VERSION and is never detected. Result lines go to BOWERLOOM_LIVE_RESULTS.
// The live tests call models, so they can cost money. npm test never sets the opt-in.
// The offline tests at the top need no engine and always run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CHECKS, CODEX_ROOT_VARIABLE, PROBE, appendResult, classify, codexGate, codexTrustRefusal, commandOf, liveSkip, makeScratch, probeServer, readLog, recorded,
  resultLine, resultsPath, runEngine, sanitize, shapeOf, stubSource, versionOf,
} from '../../../tools/step5/live/lib.mjs';
import {
  G7_PROMPT, G8_PATCH_PROMPT, G8_READ_PROMPT, G9_PROMPT, G10_PROMPT, OPEN_MARK, REF, SECRET_MARK,
  g4Project, g6Project, g7Project, g8Project, g9Argv, g9Project, g10Project, g11Project, g11Prompt,
  readG4, readG6, readG7, readG8, readG9, readG10, readG11, resultObject, settingSourcesHelp,
} from '../../../tools/step5/live/projects.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readme = path.resolve(here, '../../../tools/step5/live/README.md');
const withScratch = (t, prefix = 'bowerloom-live-offline') => { const sc = makeScratch(prefix); t.after(() => sc.cleanup()); return sc; };
const idle = (engine, extra = {}) => ({ BOWERLOOM_LIVE_ENGINES: '1', [`BOWERLOOM_LIVE_${engine}`]: '["x"]', ...extra });

// ---- offline: the scratch builder and the stub ---------------------------------------------------------------------

test('offline: a scratch folder is private, and its project, home, state, and stub folders exist', t => {
  const sc = withScratch(t);
  assert.equal(fs.statSync(sc.base).mode & 0o777, 0o700);
  for (const dir of [sc.project, sc.home, sc.state, sc.stubs]) assert.ok(fs.statSync(dir).isDirectory(), dir);
  assert.ok(fs.existsSync(sc.stub));
  assert.equal(fs.readFileSync(sc.stub, 'utf8'), stubSource());
  assert.equal(sc.env().XDG_STATE_HOME, sc.state);
});

test('offline: the project writer stays inside the project and refuses an escape', t => {
  const sc = withScratch(t);
  sc.write({ 'a/b.txt': 'x' });
  assert.equal(fs.readFileSync(path.join(sc.project, 'a/b.txt'), 'utf8'), 'x');
  assert.throws(() => sc.write({ '../out.txt': 'x' }));
  assert.throws(() => sc.write({ [path.join(os.tmpdir(), 'out.txt')]: 'x' }));
});

test('offline: the stub logs argv, environment names, a state word for a probe value, and standard input, and never a value', t => {
  const sc = withScratch(t);
  const r = spawnSync(process.execPath, [sc.stub, sc.log, 'label-1', 'one', REF, '--exit', '2'], {
    input: 'hello stdin', encoding: 'utf8', env: { PATH: process.env.PATH, PROBE, OTHER_NAME: 'a-private-value', LITERAL: REF },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Blocked/);
  const [entry] = readLog(sc.log);
  assert.equal(entry.label, 'label-1');
  assert.deepEqual(entry.argv, ['one', REF]);
  assert.ok(entry.envNames.includes('OTHER_NAME') && entry.envNames.includes('PROBE'));
  assert.deepEqual(entry.probe.sort((a, b) => a.name.localeCompare(b.name)), [{ name: 'LITERAL', state: 'literal-ref' }, { name: 'PROBE', state: 'probe-value' }]);
  assert.equal(entry.stdin, 'hello stdin');
  assert.ok(!fs.readFileSync(sc.log, 'utf8').includes('a-private-value'), 'no value is logged');
});

test('offline: the hook command line runs through sh, exits with the asked code, and logs', t => {
  const sc = withScratch(t);
  const r = spawnSync('/bin/sh', ['-c', sc.stubCommand('hook-1', { exit: 2 })], { input: '{"tool_name":"Bash"}', encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.equal(readLog(sc.log)[0].stdin, '{"tool_name":"Bash"}');
  const ok = spawnSync('/bin/sh', ['-c', sc.stubCommand('hook-2')], { input: '', encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(ok.status, 0);
});

test('offline: classify follows the same rule as the stub', () => {
  assert.equal(classify(PROBE), 'probe-value');
  assert.equal(classify(REF), 'literal-ref');
  assert.equal(classify(`x-${PROBE}-y`), 'contains-probe');
  assert.equal(classify('other'), null);
});

test('offline: the probe server logs the path and header states, not header values', async t => {
  const sc = withScratch(t);
  const server = await probeServer(sc.log, 'srv');
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.port}/${encodeURIComponent(REF)}/mcp`, { headers: { 'X-Probe-Literal': REF, 'X-Other': 'private-header-value' } });
  assert.equal(res.status, 400);
  const [entry] = readLog(sc.log);
  assert.equal(entry.label, 'srv');
  assert.equal(decodeURIComponent(entry.url), `/${REF}/mcp`);
  assert.deepEqual(entry.probe, [{ name: 'x-probe-literal', state: 'literal-ref' }]);
  assert.ok(!fs.readFileSync(sc.log, 'utf8').includes('private-header-value'));
});

test('offline: runEngine passes the prompt as the last argument or on standard input, and times out a hung command', async () => {
  const echo = ['-e', 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.stringify({argv:process.argv.slice(1),stdin:s})))', '--'];
  const arg = await runEngine({ words: [process.execPath, ...echo], extra: ['--flag'], prompt: 'PROMPT', cwd: os.tmpdir(), env: process.env });
  assert.deepEqual(JSON.parse(arg.stdout), { argv: ['--flag', 'PROMPT'], stdin: '' });
  const std = await runEngine({ words: [process.execPath, ...echo], extra: ['-'], prompt: 'PROMPT', via: 'stdin', cwd: os.tmpdir(), env: process.env });
  assert.deepEqual(JSON.parse(std.stdout), { argv: ['-'], stdin: 'PROMPT' });
  const hung = await runEngine({ words: [process.execPath, '-e', 'setTimeout(()=>{},60000)'], prompt: 'p', cwd: os.tmpdir(), env: process.env, timeoutMs: 300 });
  assert.equal(hung.timedOut, true);
  const missing = await runEngine({ words: ['bowerloom-live-no-such-command'], prompt: 'p', cwd: os.tmpdir(), env: process.env });
  assert.equal(missing.spawnError, 'ENOENT');
});

// ---- offline: environment variables, versions, refusal --------------------------------------------------------------

test('offline: commands come from the environment, versions are never detected, and an unset opt-in skips', () => {
  assert.equal(commandOf('codex', {}), null);
  assert.deepEqual(commandOf('claude-code', { BOWERLOOM_LIVE_CLAUDE_CODE: '["claude","-p"]' }), ['claude', '-p']);
  assert.deepEqual(commandOf('deepseek-harness', { BOWERLOOM_LIVE_DEEPSEEK_HARNESS: '["dsh"]' }), ['dsh']);
  assert.throws(() => commandOf('codex', { BOWERLOOM_LIVE_CODEX: 'not json' }));
  assert.throws(() => commandOf('codex', { BOWERLOOM_LIVE_CODEX: '[]' }));
  assert.equal(versionOf('codex', {}), 'unknown');
  assert.equal(versionOf('codex', { BOWERLOOM_LIVE_CODEX_VERSION: '0.157.0' }), '0.157.0');
  assert.match(liveSkip('codex', { BOWERLOOM_LIVE_CODEX: '["codex"]' }), /BOWERLOOM_LIVE_ENGINES=1/);
  assert.equal(liveSkip('codex', idle('CODEX')), false);
  assert.equal(liveSkip('codex', { BOWERLOOM_LIVE_ENGINES: '1' }), 'no command for codex');
});

test('offline: a Codex check refuses with a clear message until the trust variable is 1 and the root is set', () => {
  const both = { BOWERLOOM_LIVE_CODEX_TRUSTED: '1', BOWERLOOM_LIVE_CODEX_ROOT: '/fixed/root' };
  for (const id of CHECKS.filter(c => c.codexTrust).map(c => c.id)) {
    assert.match(codexTrustRefusal(id, {}), new RegExp(`Check ${id} refuses to run`));
    assert.match(codexTrustRefusal(id, { BOWERLOOM_LIVE_CODEX_TRUSTED: '0' }), /BOWERLOOM_LIVE_CODEX_TRUSTED=1/);
    assert.match(codexTrustRefusal(id, { BOWERLOOM_LIVE_CODEX_TRUSTED: '1' }), new RegExp(`${CODEX_ROOT_VARIABLE}.*codex-trust-setup\\.mjs`));
    assert.equal(codexTrustRefusal(id, both), null);
    assert.equal(codexGate(id, both), null);
  }
  assert.deepEqual(CHECKS.filter(c => c.codexTrust).map(c => c.id), ['g4', 'g7', 'g8', 'g9']);
});

test('offline: a result line holds the check, engine, version, command shape, result, evidence, and a UTC date, and no private path', t => {
  const sc = withScratch(t);
  const line = resultLine({
    check: 'g7', engine: 'codex', version: '0.157.0', command: shapeOf(['/opt/tools/codex', 'exec', '/opt/tools/script.mjs'], ['--sandbox', 'workspace-write']),
    result: 'pass', observed: `in ${sc.base}/project and ${os.homedir()}/x`, evidence: `${os.homedir()}/a`, scratchBase: sc.base, now: new Date('2026-10-28T12:00:00Z'),
  });
  assert.deepEqual(Object.keys(line).sort(), ['at', 'check', 'command', 'date', 'engine', 'evidence', 'observed', 'result', 'version']);
  assert.equal(line.date, '2026-10-28');
  assert.equal(line.at, '2026-10-28T12:00:00.000Z');
  assert.equal(line.command, 'codex exec script.mjs --sandbox workspace-write <prompt>');
  assert.ok(!JSON.stringify(line).includes(sc.base) && !JSON.stringify(line).includes(os.homedir()));
  assert.throws(() => resultLine({ check: 'g1', engine: 'codex', version: 'x', command: 'x', result: 'maybe' }));
  assert.equal(sanitize('/Users/someone/project'), '~/project');
});

test('offline: results go to BOWERLOOM_LIVE_RESULTS, or to a private file in a results folder', t => {
  const sc = withScratch(t);
  const file = path.join(sc.base, 'out', 'r.jsonl');
  const env = { BOWERLOOM_LIVE_RESULTS: file };
  assert.equal(resultsPath(env), file);
  appendResult(resultLine({ check: 'g1', engine: 'codex', version: 'v', command: 'c', result: 'pass' }), env);
  appendResult(resultLine({ check: 'g2', engine: 'codex', version: 'v', command: 'c', result: 'inconclusive' }), env);
  assert.deepEqual(readLog(file).map(l => l.check), ['g1', 'g2']);
  const fallback = resultsPath({});
  assert.ok(path.basename(path.dirname(fallback)).startsWith('bowerloom-live-results-'));
  assert.equal(fs.statSync(path.dirname(fallback)).mode & 0o777, 0o700);
  fs.rmSync(path.dirname(fallback), { recursive: true, force: true });
});

test('offline: recorded writes pass, inconclusive, and fail lines, and fails the test only for fail', async t => {
  const sc = withScratch(t);
  const file = path.join(sc.base, 'r.jsonl');
  const env = { BOWERLOOM_LIVE_RESULTS: file, BOWERLOOM_LIVE_OPENCODE_VERSION: '1.18.30' };
  const run = (body, check = 'gx') => recorded({ check, engine: 'opencode', scratch: sc, env }, body);
  await run(async () => ({ result: 'pass', observed: 'ok', evidence: 'e', shape: 'opencode run <prompt>' }));
  await run(async () => ({ result: 'inconclusive', observed: 'none', evidence: 'e' }));
  await assert.rejects(run(async () => ({ result: 'fail', observed: 'bad', evidence: 'e' })), /bad/);
  await assert.rejects(run(async () => { throw new Error('boom'); }), /boom/);
  const lines = readLog(file);
  assert.deepEqual(lines.map(l => l.result), ['pass', 'inconclusive', 'fail', 'fail']);
  assert.equal(lines[0].version, '1.18.30');
  assert.equal(lines[0].command, 'opencode run <prompt>');
  assert.equal(lines[1].command, 'unknown');
  assert.match(lines[3].evidence, /boom/);
});

// ---- offline: the scratch projects and the evidence readers --------------------------------------------------------

test('offline: g4 project holds a Codex server with the reference in args, env, URL, and a header', t => {
  const sc = withScratch(t);
  const p = g4Project(sc, 4321);
  const toml = p.files['.codex/config.toml'];
  assert.match(toml, /\[mcp_servers\.probe_cmd\]/);
  assert.ok(toml.includes(`"${REF}"`), 'the reference is in args');
  assert.match(toml, /env_vars = \["PROBE"\]/);
  assert.match(toml, /LITERAL_REF = "\$\{PROBE\}"/);
  assert.match(toml, /url = "http:\/\/127\.0\.0\.1:4321\/\$\{PROBE\}\/mcp"/);
  assert.match(toml, /X-Probe-Literal = "\$\{PROBE\}"/);
  assert.ok(toml.includes(sc.stub) && toml.includes(sc.log));
  assert.equal(p.prompt, 'Reply OK');
  assert.equal(p.env.PROBE, PROBE);
});

test('offline: g4 reader tells expanded from literal and says inconclusive when no server started', () => {
  assert.equal(readG4([]).result, 'inconclusive');
  const literal = readG4([
    { label: 'g4-cmd', argv: [REF], envNames: ['A'], probe: [{ name: 'PROBE', state: 'probe-value' }, { name: 'LITERAL_REF', state: 'literal-ref' }] },
    { label: 'g4-http', url: `/${encodeURIComponent(REF)}/mcp`, probe: [{ name: 'x-probe-literal', state: 'literal-ref' }] },
  ]);
  assert.equal(literal.result, 'pass');
  assert.equal(literal.observed, 'args=literal; env=literal-ref; env_vars=probe-value; url=literal; header=literal-ref');
  const expanded = readG4([{ label: 'g4-cmd', argv: [PROBE], envNames: [], probe: [{ name: 'LITERAL_REF', state: 'probe-value' }] }]);
  assert.match(expanded.observed, /args=expanded; env=probe-value; env_vars=absent; url=not-reached/);
});

test('offline: g6 project writes the real OpenCode plugin with a before hook and an after hook that log', t => {
  const sc = withScratch(t);
  const p = g6Project(sc);
  const code = p.files['.opencode/plugins/bowerloom-hooks.js'];
  assert.match(code, /tool\.execute\.before/);
  assert.match(code, /tool\.execute\.after/);
  assert.ok(code.includes('g6-pre') && code.includes('g6-post'));
  assert.equal(JSON.parse(p.files['opencode.json']).permission.bash, 'allow');
  assert.equal(p.prompt, 'Run: echo hi');
  new Function(code.replace(/^export /m, ''));
});

test('offline: g6 reader reports the stdin key lists and the absent case', () => {
  assert.equal(readG6([]).result, 'inconclusive');
  const r = readG6([
    { label: 'g6-pre', stdin: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo hi' } }) },
    { label: 'g6-post', stdin: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {} }) },
  ]);
  assert.equal(r.result, 'pass');
  assert.match(r.observed, /pre\.tool_input\.keys=\["command"\]/);
  assert.match(r.observed, /post\.tool_input\.keys=\[\]/);
});

test('offline: g7 projects exist for the three engines and each hook exits 2 on the touch command', t => {
  const sc = withScratch(t);
  const claude = g7Project(sc, 'claude-code');
  assert.deepEqual(claude.extra, ['--allowedTools', 'Bash']);
  assert.equal(claude.via, 'stdin');
  const settings = JSON.parse(claude.files['.claude/settings.json']);
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /--exit 2$/);
  const codex = g7Project(sc, 'codex');
  assert.deepEqual(codex.extra, ['--sandbox', 'workspace-write', '-c', 'approval_policy="never"']);
  assert.equal(JSON.parse(codex.files['.codex/hooks.json']).hooks.PreToolUse[0].matcher, 'Bash|exec_command');
  const open = g7Project(sc, 'opencode');
  assert.match(open.files['.opencode/plugins/bowerloom-hooks.js'], /tool\.execute\.before/);
  for (const p of [claude, codex, open]) assert.equal(p.prompt, G7_PROMPT);
  assert.throws(() => g7Project(sc, 'pi'));
});

test('offline: g7 reader separates blocked, not blocked, and no hook call', t => {
  const sc = withScratch(t);
  assert.equal(readG7('codex', [], sc.project).result, 'inconclusive');
  const ran = [{ label: 'g7-codex' }];
  assert.equal(readG7('codex', ran, sc.project).result, 'pass');
  fs.writeFileSync(path.join(sc.project, 'blocked.txt'), '');
  assert.equal(readG7('codex', ran, sc.project).result, 'fail');
});

test('offline: g8 project extends :workspace with one denied path, and the reader finds a leak or a patch', t => {
  const sc = withScratch(t);
  const p = g8Project();
  assert.match(p.files['.codex/config.toml'], /default_permissions = "bowerloom"/);
  assert.match(p.files['.codex/config.toml'], /extends = ":workspace"/);
  assert.match(p.files['.codex/config.toml'], /"secret\.txt" = "deny"/);
  assert.ok(!/sandbox_mode/.test(p.files['.codex/config.toml']));
  sc.write(p.files);
  const shown = { stdout: `${OPEN_MARK}\n`, stderr: '' };
  assert.equal(readG8(shown, { stdout: '', stderr: '' }, sc.project).result, 'pass');
  assert.equal(readG8({ stdout: '', stderr: '' }, shown, sc.project).result, 'inconclusive');
  assert.equal(readG8({ stdout: `${OPEN_MARK} ${SECRET_MARK}`, stderr: '' }, shown, sc.project).result, 'fail');
  fs.writeFileSync(path.join(sc.project, 'secret.txt'), 'patched-by-live-check\n');
  assert.equal(readG8(shown, shown, sc.project).result, 'fail');
  assert.match(G8_READ_PROMPT + G8_PATCH_PROMPT, /secret\.txt/);
});

test('offline: g9 uses the Codex argv of the team engines table, and the reader tells dropped from kept', t => {
  const sc = withScratch(t);
  const argv = g9Argv('codex');
  assert.deepEqual(argv.words, ['codex', '-c', 'approval_policy="never"', 'exec', '--ignore-user-config', '--ignore-rules', '--json', '--sandbox', 'workspace-write']);
  assert.deepEqual(argv.extra, ['-']);
  const p = g9Project();
  assert.match(p.files['.codex/rules/bowerloom.rules'], /pattern = \["touch"\]/);
  assert.match(p.files['.codex/rules/bowerloom.rules'], /decision = "forbidden"/);
  assert.equal(p.prompt, G9_PROMPT);
  const none = { stdout: '', stderr: '' };
  assert.equal(readG9(none, sc.project).result, 'inconclusive');
  assert.equal(readG9({ stdout: 'blocked by rule', stderr: '' }, sc.project).result, 'pass');
  fs.writeFileSync(path.join(sc.project, 'ignore-probe.txt'), '');
  assert.match(readG9(none, sc.project).evidence, /dropped/);
});

test('offline: g10 reads the help line and compares the two runs', () => {
  assert.equal(settingSourcesHelp('--model <m>\n  --setting-sources <sources>  Comma-separated list\n  --x'), '--setting-sources <sources>  Comma-separated list');
  assert.equal(settingSourcesHelp('nothing'), null);
  const line = '--setting-sources <sources>';
  assert.equal(readG10(null, false, true).result, 'inconclusive');
  assert.equal(readG10(line, true, true).result, 'fail');
  assert.equal(readG10(line, false, false).result, 'inconclusive');
  assert.equal(readG10(line, false, true).result, 'pass');
  assert.deepEqual(JSON.parse(g10Project().files['.claude/settings.json']).permissions.deny, ['Bash(touch pinned.txt)']);
  assert.match(G10_PROMPT, /pinned\.txt/);
});

test('offline: g11 project has no rules and the reader lists the denied tools from permission_denials', t => {
  const sc = withScratch(t);
  const p = g11Project();
  assert.deepEqual(Object.keys(p.files), ['notes.txt']);
  assert.deepEqual(p.extra, ['--output-format', 'json']);
  for (const tool of ['Read', 'Edit', 'Bash', 'WebFetch']) assert.match(g11Prompt(1), new RegExp(tool));
  sc.write(p.files);
  const out = JSON.stringify({ type: 'result', permission_denials: [{ tool_name: 'Edit' }, { tool_name: 'Bash' }, { tool_name: 'Edit' }] });
  const r = readG11(out, sc.project, []);
  assert.equal(r.result, 'pass');
  assert.equal(r.observed, 'denied=["Bash","Edit"]; edited=false; fetched=false');
  assert.equal(readG11('not json', sc.project, []).result, 'inconclusive');
  assert.deepEqual(resultObject(JSON.stringify([{ type: 'system' }, { type: 'result', a: 1 }])), { type: 'result', a: 1 });
});

// ---- offline: the runbook and the skip rule ------------------------------------------------------------------------

test('offline: the README has one section per check with command, proof, settled item, turns, and prerequisite', () => {
  const text = fs.readFileSync(readme, 'utf8');
  assert.ok(!/\/Users\/|\/home\/|C:\\/.test(text), 'no machine path in the README');
  for (const c of CHECKS) {
    const start = text.indexOf(`## Check ${c.id}:`);
    assert.ok(start >= 0, `a section for ${c.id}`);
    const next = text.indexOf('\n## ', start + 5);
    const section = text.slice(start, next < 0 ? undefined : next);
    for (const label of ['Command:', 'Proves:', 'Settles:', 'Turns:', 'Prerequisite:']) assert.ok(section.includes(label), `${c.id} has ${label}`);
    assert.match(section, new RegExp(`Turns:\\*\\* ${c.turns}\\b`), `${c.id} turn count`);
    if (c.kind === 'manual') assert.match(section, /Manual/, `${c.id} is marked manual`);
    if (c.codexTrust) assert.match(section, /BOWERLOOM_LIVE_CODEX_TRUSTED=1/, `${c.id} names the trust variable`);
    if (c.codexTrust) assert.match(section, /BOWERLOOM_LIVE_CODEX_ROOT=/, `${c.id} names the root variable`);
  }
});

test('offline: the kinds of check match the plan: g5 and g12 are runbook steps, the rest are tests', () => {
  assert.deepEqual(CHECKS.map(c => c.id), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11', 'g12']);
  assert.deepEqual(CHECKS.filter(c => c.kind === 'manual').map(c => c.id), ['g5', 'g12']);
});

function skippedLines(file) {
  const env = { ...process.env, BOWERLOOM_LIVE_CHILD: '1' };
  delete env.NODE_TEST_CONTEXT; // a child of a test run would otherwise report to its parent instead of printing
  for (const name of Object.keys(env)) if (name.startsWith('BOWERLOOM_LIVE_') && name !== 'BOWERLOOM_LIVE_CHILD') delete env[name];
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { env, encoding: 'utf8', timeout: 120_000 });
  const out = r.stdout;
  return { status: r.status, lines: out.split('\n'), fail: Number(/^# fail (\d+)/m.exec(out)?.[1] ?? NaN), skipped: Number(/^# skipped (\d+)/m.exec(out)?.[1] ?? NaN) };
}

test('offline: with BOWERLOOM_LIVE_ENGINES unset, every live test in portable-live.test.mjs is skipped, not failed', () => {
  const r = skippedLines(path.join(here, 'portable-live.test.mjs'));
  assert.equal(r.status, 0);
  assert.equal(r.fail, 0);
  const live = r.lines.filter(l => /^(not )?ok \d+ - .*\(live\)/.test(l));
  assert.ok(live.length >= 7, `live tests found: ${live.length}`);
  assert.ok(live.every(l => /# SKIP/.test(l)), live.filter(l => !/# SKIP/.test(l)).join('\n'));
});

test('offline: with BOWERLOOM_LIVE_ENGINES unset, every live test in locked-live.test.mjs is skipped, not failed', { skip: process.env.BOWERLOOM_LIVE_CHILD === '1' && 'the child run skips this test so it cannot start itself again' }, () => {
  const r = skippedLines(fileURLToPath(import.meta.url));
  assert.equal(r.status, 0);
  assert.equal(r.fail, 0);
  const live = r.lines.filter(l => /^(not )?ok \d+ - .*\(live\)/.test(l));
  const ids = new Set(live.map(l => /- (g\d+) \(live\)/.exec(l)?.[1]));
  for (const id of ['g4', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11']) assert.ok(ids.has(id), `${id} is registered`);
  assert.ok(live.every(l => /# SKIP/.test(l)), live.filter(l => !/# SKIP/.test(l)).join('\n'));
});

// ---- live ---------------------------------------------------------------------------------------------------------

const turnProblem = r => r.spawnError ? `The engine did not start (${r.spawnError}).` : r.timedOut ? 'The turn timed out.' : null;
const stopped = (problem, shape) => ({ result: 'inconclusive', observed: problem, evidence: problem, shape });

function live(id, engine, title, body, { codex = false } = {}) {
  test(`${id} (live): ${title}`, { skip: liveSkip(engine), timeout: 1_800_000 }, async t => {
    if (codex) {
      const gate = codexGate(id);
      if (gate) {
        appendResult(resultLine({ check: id, engine, version: versionOf(engine), command: 'refused before any turn', result: 'inconclusive', observed: gate.observed, evidence: gate.message }));
        assert.fail(gate.message);
      }
    }
    // A Codex check runs in the one fixed root, so the trusted project path and the hook command never change.
    const sc = makeScratch(`bowerloom-live-${id}`, codex ? { fixedBase: process.env[CODEX_ROOT_VARIABLE] } : {});
    t.after(() => sc.cleanup());
    await recorded({ check: id, engine, scratch: sc }, () => body(sc, t, commandOf(engine)));
  });
}

live('g4', 'codex', 'Codex expands ${NAME} in an MCP server command, args, env, URL, and header', async (sc, t, words) => {
  const server = await probeServer(sc.log, 'g4-http');
  t.after(() => server.close());
  const p = g4Project(sc, server.port);
  sc.write(p.files).gitInit();
  const r = await runEngine({ words, prompt: p.prompt, cwd: sc.project, env: sc.env(p.env) });
  const shape = shapeOf(words);
  return turnProblem(r) ? stopped(turnProblem(r), shape) : { ...readG4(sc.entries()), shape };
}, { codex: true });

live('g6', 'opencode', 'an OpenCode plugin hook receives the tool name and the arguments before and after a call', async (sc, _t, words) => {
  const p = g6Project(sc);
  sc.write(p.files).gitInit();
  const r = await runEngine({ words, prompt: p.prompt, cwd: sc.project, env: sc.env() });
  const shape = shapeOf(words);
  return turnProblem(r) ? stopped(turnProblem(r), shape) : { ...readG6(sc.entries()), shape };
});

for (const engine of ['claude-code', 'codex', 'opencode']) {
  live('g7', engine, `a PreToolUse hook that exits 2 blocks touch in ${engine}`, async (sc, _t, words) => {
    const p = g7Project(sc, engine);
    sc.write(p.files).gitInit();
    const r = await runEngine({ words, extra: p.extra, prompt: p.prompt, via: p.via, cwd: sc.project, env: sc.env() });
    const shape = shapeOf(words, p.extra, p.via);
    return turnProblem(r) ? stopped(turnProblem(r), shape) : { ...readG7(engine, sc.entries(), sc.project), shape };
  }, { codex: engine === 'codex' });
}

live('g8', 'codex', 'a Codex profile that extends :workspace denies one path for read and for patch', async (sc, _t, words) => {
  const p = g8Project();
  sc.write(p.files).gitInit();
  const read = await runEngine({ words, extra: p.extra, prompt: G8_READ_PROMPT, cwd: sc.project, env: sc.env() });
  const shape = shapeOf(words, p.extra);
  if (turnProblem(read)) return stopped(turnProblem(read), shape);
  const patch = await runEngine({ words, extra: p.extra, prompt: G8_PATCH_PROMPT, cwd: sc.project, env: sc.env() });
  return turnProblem(patch) ? stopped(turnProblem(patch), shape) : { ...readG8(read, patch, sc.project), shape };
}, { codex: true });

live('g9', 'codex', 'Codex --ignore-rules keeps or drops a project rule that forbids touch', async (sc, _t, words) => {
  const p = g9Project();
  sc.write(p.files).gitInit();
  const argv = g9Argv(words[0]);
  const r = await runEngine({ words: argv.words, extra: argv.extra, prompt: p.prompt, via: 'stdin', cwd: sc.project, env: sc.env() });
  const shape = shapeOf(argv.words, argv.extra, 'stdin');
  return turnProblem(r) ? stopped(turnProblem(r), shape) : { ...readG9(r, sc.project), shape };
}, { codex: true });

live('g10', 'claude-code', 'a project deny applies under --setting-sources project,local and not under user', async (sc, _t, words) => {
  const p = g10Project();
  sc.write(p.files).gitInit();
  const shape = shapeOf(words, ['--setting-sources', '<sources>', '--allowedTools', 'Bash'], 'stdin');
  // Step 1 costs no tokens: read the help text for the flag.
  const help = await runEngine({ words: [words[0], '--help'], prompt: '', via: 'stdin', cwd: sc.project, env: sc.env(), timeoutMs: 60_000 });
  if (turnProblem(help)) return stopped(turnProblem(help), shape);
  const helpLine = settingSourcesHelp(`${help.stdout}\n${help.stderr}`);
  if (!helpLine) return { ...readG10(null, false, false), shape };
  const touched = path.join(sc.project, 'pinned.txt');
  const turn = async sources => {
    fs.rmSync(touched, { force: true });
    const r = await runEngine({ words, extra: ['--setting-sources', sources, '--allowedTools', 'Bash'], prompt: p.prompt, via: 'stdin', cwd: sc.project, env: sc.env() });
    return { problem: turnProblem(r), ran: fs.existsSync(touched) };
  };
  const a = await turn('project,local');
  if (a.problem) return stopped(a.problem, shape);
  const b = await turn('user');
  return b.problem ? stopped(b.problem, shape) : { ...readG10(helpLine, a.ran, b.ran), shape };
});

live('g11', 'claude-code', 'Claude Code lists the denied tools of a run with no rules in permission_denials', async (sc, t, words) => {
  const server = await probeServer(sc.log, 'g11-http');
  t.after(() => server.close());
  const p = g11Project();
  sc.write(p.files).gitInit();
  const r = await runEngine({ words, extra: p.extra, prompt: g11Prompt(server.port), cwd: sc.project, env: sc.env() });
  const shape = shapeOf(words, p.extra);
  return turnProblem(r) ? stopped(turnProblem(r), shape) : { ...readG11(r.stdout, sc.project, sc.entries()), shape };
});
