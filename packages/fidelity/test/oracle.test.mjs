// Locked-in parts spec, section 11 (test oracle) and section 12 check 11. rulesync 43.2.0, MIT, a pinned dev
// dependency, never a run-time one. Its `convert` runs on the same synthetic fixture as Bowerloom, and the outputs are
// compared by what each engine would decide for the same requests. Every difference must be explained.
//
// Isolation (ruling R7 on 122891c). rulesync runs in a child process with two limits:
// - macOS sandbox-exec with a profile that denies all network. When sandbox-exec is missing or cannot apply its profile,
//   the oracle tests are skipped with that reason; rulesync never runs without it. A probe test shows that a process
//   under the same profile cannot reach a local TCP server.
// - The Node permission model: reads only from the rulesync package, node_modules, the fresh temporary folder, the
//   Node install, and the preload; writes only inside the temporary folder; no child process or worker. HOME is inside
//   the temporary folder. A preload also refuses Node's network calls, as a second layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codexCommands, codexDecide, codexFilesystemDecide, codexPrefix, codexPatternMatches, codexShellArgv, engineDecision,
  morePermissive, neutralDecision, openCodeDecide, openCodeFromConfig, openCodePathPatterns, openCodeRequest, openCodeWildcard, pathMatches, pathRegex, splitCommand, translateGuardrails,
} from '../../../dist/packages/fidelity/src/index.js';
import { MIXED_RULES, allRequests } from './fixture.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const cli = path.join(root, 'node_modules/rulesync/dist/cli/index.js');
const preload = path.join(here, 'oracle-no-network.mjs');
const folders = [];
/** rulesync converts from the Claude Code projection, so both sides start from the rules Claude Code carries. */
const CARRIED = MIXED_RULES.filter(r => translateGuardrails('claude-code', { rules: [r], sandbox: [] }).lines[0].result !== 'absent');
test.after(() => { for (const f of folders) fs.rmSync(f, { recursive: true, force: true }); });

/** The unmanaged Codex entry that must survive a projection (section 12 check 4). Synthetic. */
const UNMANAGED_TOML = '[mcp_servers.keep]\ncommand = "keep-me"\n';

/** The sandbox-exec profile of the oracle: everything the user may do, except any network. */
const NO_NETWORK = '(version 1)(allow default)(deny network*)';
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
/** Null when sandbox-exec is present and applies the profile; otherwise why the oracle is skipped. */
const SANDBOX_MISSING = (() => {
  if (!fs.existsSync(SANDBOX_EXEC)) return 'macOS sandbox-exec is missing, so rulesync cannot run with the network denied.';
  const probe = spawnSync(SANDBOX_EXEC, ['-p', NO_NETWORK, '/usr/bin/true'], { encoding: 'utf8' });
  return probe.status === 0 ? null : `sandbox-exec could not apply its profile (${(probe.stderr || '').trim().slice(0, 120)}), so rulesync cannot run with the network denied.`;
})();
const ORACLE = SANDBOX_MISSING ? { skip: SANDBOX_MISSING } : {};
/** The Node binary and its own lib folder (review item W8), not the whole install prefix. */
const nodeReads = [fs.realpathSync(process.execPath), path.join(path.dirname(path.dirname(fs.realpathSync(process.execPath))), 'lib')];
/** Every path the rulesync process may read. */
const limits = folder => [path.join(root, 'node_modules/rulesync'), path.join(root, 'node_modules'), folder, ...nodeReads, preload];

/** Runs `rulesync convert` from the Claude Code projection of the fixture. Returns the folder and the run. */
function convert(to) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bowerloom-oracle-'));
  folders.push(folder);
  const cc = translateGuardrails('claude-code', { rules: CARRIED, sandbox: [] });
  fs.mkdirSync(path.join(folder, '.claude'));
  fs.mkdirSync(path.join(folder, '.codex'));
  fs.mkdirSync(path.join(folder, 'home'));
  fs.writeFileSync(path.join(folder, '.claude/settings.json'), JSON.stringify({ permissions: cc.form.permissions }, null, 2) + '\n');
  fs.writeFileSync(path.join(folder, '.codex/config.toml'), UNMANAGED_TOML);
  const reads = limits(folder);
  const run = spawnSync(SANDBOX_EXEC, ['-p', NO_NETWORK, process.execPath,
    '--permission', ...reads.map(r => `--allow-fs-read=${r}`), `--allow-fs-write=${folder}`, '--import', preload,
    cli, 'convert', '--from', 'claudecode', '--to', to, '--features', 'permissions',
  ], { cwd: folder, env: { PATH: process.env.PATH ?? '', HOME: path.join(folder, 'home'), NO_COLOR: '1' }, encoding: 'utf8', timeout: 60_000 });
  return { folder, run };
}

function assertIsolated({ folder, run }) {
  assert.equal(run.error, undefined, String(run.error));
  assert.doesNotMatch(run.stderr + run.stdout, /BOWERLOOM-ORACLE-NETWORK/, 'rulesync tried to use the network');
  assert.doesNotMatch(run.stderr + run.stdout, /ERR_ACCESS_DENIED/, 'rulesync tried to write outside its folder or start a process');
  assert.equal(run.status, 0, run.stderr + run.stdout);
  assert.deepEqual(fs.readdirSync(path.join(folder, 'home')), [], 'rulesync wrote to HOME');
}

const read = (folder, file) => { try { return fs.readFileSync(path.join(folder, file), 'utf8'); } catch { return null; } };

/** The prefix rules of the generated `.codex/rules/rulesync.rules`, with the source pattern of each. */
function parseCodexRules(text) {
  const rules = [];
  for (const m of (text ?? '').matchAll(/# (.*)\nprefix_rule\(\s*pattern = (\[[^\n]*\]),\s*decision = "(\w+)"/g)) {
    rules.push({ source: m[1], pattern: JSON.parse(m[2]), decision: m[3] });
  }
  return rules;
}

/** The entries of the `:workspace_roots` filesystem table of the generated `.codex/config.toml`. */
function parseWorkspaceRoots(text) {
  const out = [];
  let inside = false;
  for (const line of (text ?? '').split('\n')) {
    if (line.startsWith('[')) { inside = /^\[permissions\.[^.]+\.filesystem\.":workspace_roots"\]$/.test(line.trim()); continue; }
    const m = inside && /^"([^"]+)" = "(read|write|deny)"$/.exec(line.trim());
    if (m) out.push({ path: m[1], access: m[2] });
  }
  return out;
}

function rulesyncCodexDecide(rules, fsEntries, request) {
  switch (request.action) {
    case 'shell': return codexDecide(rules, codexShellArgv(request.command));
    case 'read': return codexFilesystemDecide(fsEntries, 'read', request.path);
    case 'edit': case 'write': return codexFilesystemDecide(fsEntries, 'write', request.path);
    default: return 'default';
  }
}

// ---- Differences ---------------------------------------------------------------------------------------------------------
// A difference is { engine, request, bowerloom, rulesync, neutral }: what each projection decides for one request.

const codexRun = SANDBOX_MISSING ? null : convert('codexcli,opencodev1');
const v2Run = SANDBOX_MISSING ? null : convert('opencode');
const out = (run, file) => run ? read(run.folder, file) : null;
const rsRules = parseCodexRules(out(codexRun, '.codex/rules/rulesync.rules'));
const rsFilesystem = parseWorkspaceRoots(out(codexRun, '.codex/config.toml'));
const codexToml = out(codexRun, '.codex/config.toml') ?? '';
const oc1Text = out(codexRun, 'opencode.jsonc') ?? out(codexRun, 'opencode.json') ?? '{}';
const oc2Text = out(v2Run, 'opencode.jsonc') ?? out(v2Run, 'opencode.json') ?? '{}';
const rsOpenCode = openCodeFromConfig(JSON.parse(oc1Text).permission ?? {});
/** Deny and ask shell rules that rulesync left out of the Codex rules file. */
const droppedByRulesync = CARRIED.filter(r => r.action === 'shell' && r.effect !== 'allow' && !rsRules.some(x => x.source === r.pattern));

function computeDifferences() {
  const ours = { codex: translateGuardrails('codex', { rules: CARRIED, sandbox: [] }), opencode: translateGuardrails('opencode', { rules: CARRIED, sandbox: [] }) };
  const out = [];
  for (const request of allRequests()) {
    const pairs = {
      codex: [engineDecision(ours.codex.form, request), rulesyncCodexDecide(rsRules, rsFilesystem, request)],
      opencode: [engineDecision(ours.opencode.form, request), openCodeDecide(rsOpenCode, openCodeRequest(request))],
    };
    for (const [engine, [bowerloom, rulesync]] of Object.entries(pairs)) {
      if (bowerloom !== rulesync) out.push({ engine, request, bowerloom, rulesync, neutral: neutralDecision(CARRIED, request) });
    }
  }
  return out;
}
const DIFFERENCES = SANDBOX_MISSING ? [] : computeDifferences();

const isPath = r => ['read', 'edit', 'write'].includes(r.action);
const looser = d => morePermissive(d.rulesync, d.bowerloom);

/** Section 11, item 3: the differences of the trial of 2026-10-27, in the spec's words. */
const ITEM_3 = {
  'dropped-deny': {
    text: 'Rulesync keeps allow rules but drops deny rules that Codex cannot express. Bowerloom tightens instead.',
    explains: d => d.engine === 'codex' && d.request.action === 'shell' && looser(d) && droppedByRulesync.some(r => {
      const prefix = codexPrefix(r.pattern);
      return prefix !== null && codexCommands(codexShellArgv(d.request.command)).some(argv => codexPatternMatches(prefix.tokens, argv));
    }),
  },
  'subagent-tool-limit': { text: 'Rulesync drops subagent tool limits without a warning. Bowerloom reports them or refuses.', explains: () => false },
  'codex-allow': { text: 'Rulesync writes a Codex allow rule for a neutral allow. Bowerloom never does.', explains: d => d.engine === 'codex' && d.rulesync === 'allow' },
  'config-overwrite': { text: 'Rulesync overwrites an existing Codex config.toml. Bowerloom preserves unmanaged entries.', explains: () => false },
  'default-value': { text: 'Rulesync copies ${NAME:-x} as literal text. Bowerloom resolves or refuses it.', explains: () => false },
  'opencode-2x': { text: 'The rulesync target opencode writes OpenCode 2.x shapes. Bowerloom writes the recorded version.', explains: () => false },
};

/** Section 11, item 4: the differences of the oracle test of 2026-10-28 (workbench PR 552). */
const ITEM_4 = {
  'root-only-paths': {
    text: 'Rulesync writes a path deny or ask at the project root only. Claude Code, the source, matches it at any depth, and Bowerloom keeps that.',
    // The path as an engine sees it, unresolved, matches the rule only below the root: `./` pins a pattern to the root.
    explains: d => isPath(d.request) && CARRIED.some(r => isPath(r) && r.effect !== 'allow'
      && pathRegex(r.pattern, 'any-depth', true).test(d.request.path) && !pathRegex(`./${r.pattern}`, 'anchored').test(d.request.path)),
  },  'opencode-read-deny-edit': {
    text: 'For OpenCode, rulesync does not write a read deny under edit. In the source a read deny also blocks changes, and Bowerloom writes both.',
    explains: d => d.engine === 'opencode' && ['edit', 'write'].includes(d.request.action) && looser(d)
      && CARRIED.some(r => r.action === 'read' && r.effect === 'deny' && pathMatches(r.pattern, d.request.path, 'any-depth')),
  },  'opencode-colon-tail': {
    text: 'For OpenCode, rulesync keeps a trailing :* as text, which OpenCode reads as a literal colon, so the rule never matches. Bowerloom writes a trailing space and *.',
    explains: d => d.engine === 'opencode' && d.request.action === 'shell' && CARRIED.some(r => r.action === 'shell' && r.pattern.endsWith(':*')
      && splitCommand(d.request.command).some(command => neutralDecision([r], { action: 'shell', command }) !== 'default')),
  },  'opencode-wider-allow': {
    text: 'For OpenCode, rulesync writes a path allow whose * stays inside one folder as it is. OpenCode reads * across folders, so the allow covers more than the source. Bowerloom leaves it out, and reports it absent.',
    explains: d => d.engine === 'opencode' && isPath(d.request) && d.rulesync === 'allow' && CARRIED.some(r => isPath(r) && r.effect === 'allow'
      && openCodePathPatterns(r.pattern, 'allow').wider && openCodeWildcard(d.request.path, r.pattern)),
  },  'codex-mcp': {
    text: 'Rulesync carries no MCP rule into Codex. Bowerloom disables the denied tool or server.',
    explains: d => d.engine === 'codex' && d.request.action === 'mcp' && looser(d),
  },  'opencode-skill-key': {
    text: 'For OpenCode, rulesync writes skill rules under the key Skill, which OpenCode does not read. Bowerloom writes them under skill.',
    explains: d => d.engine === 'opencode' && d.request.action === 'skill' && d.rulesync === 'default',
  },};

/** Section 11, item 4, last entry: file-level settings that change what Codex allows but that no request reaches. */
const ITEM_4_FILES = {
  'codex-network-enabled': {
    text: 'For Codex, rulesync sets network.enabled = true from a web allow. Bowerloom sets none of these.',
    present: () => /\[permissions\.[^.\]]+\.network\]\nenabled = true/.test(codexToml),
  },
  'codex-modes': {
    text: 'For Codex, rulesync sets approval_policy, approvals_reviewer, and default_permissions. Bowerloom sets none of these.',
    present: () => /^approval_policy = /m.test(codexToml) && /^approvals_reviewer = /m.test(codexToml) && /^default_permissions = /m.test(codexToml),
  },
  'codex-git-write': {
    text: 'For Codex, rulesync adds ".git/**" = "write". Bowerloom sets none of these.',
    present: () => codexToml.includes('".git/**" = "write"'),
  },
};

/** Item 4, last two entries: what follows from rulings R2 and R8 of the review of 122891c. */
const oursOpenCode = translateGuardrails('opencode', { rules: CARRIED, sandbox: [] });
const withoutDefault = { ...oursOpenCode.form, permission: oursOpenCode.form.permission.filter(k => k.key !== '*'), defaults: { decision: 'default', written: false, reason: '' } };
Object.assign(ITEM_4, {
  'opencode-explicit-default': {
    text: 'For OpenCode, Bowerloom writes an explicit default "*": {"*": "ask"} as the first key. Rulesync writes no default.',
    explains: d => d.engine === 'opencode' && d.bowerloom === 'ask' && engineDecision(withoutDefault, d.request) === d.rulesync,
  },
  'opencode-space-tightening': {
    text: 'For OpenCode, Bowerloom writes each literal space in a deny or ask shell pattern as *. The rule then also blocks extra spaces and tabs. Rulesync writes the pattern unchanged.',
    explains: d => d.engine === 'opencode' && d.request.action === 'shell' && morePermissive(d.rulesync, d.bowerloom)
      && CARRIED.some(r => r.action === 'shell' && r.effect !== 'allow' && /each space is written as \*/.test(oursOpenCode.lines.find(l => l.entry === r.id)?.reason ?? '')
        && engineDecision(translateGuardrails('opencode', { rules: [r], sandbox: [] }).form, d.request) === d.bowerloom),
  },
});

const SPEC_LIST = { ...ITEM_3, ...ITEM_4 };
const explainedBy = d => Object.entries(SPEC_LIST).filter(([, k]) => k.explains(d)).map(([id]) => id);
const describe = d => `${d.engine} ${JSON.stringify(d.request)}: Bowerloom ${d.bowerloom}, rulesync ${d.rulesync}, source ${d.neutral}`;

test('rulesync 43.2.0 is the pinned MIT oracle', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/rulesync/package.json'), 'utf8'));
  assert.equal(pkg.version, '43.2.0');
  assert.equal(pkg.license, 'MIT');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.rulesync, '43.2.0');
});

test('the oracle profile denies the network: a process under it cannot reach a local server', ORACLE, async () => {
  const net = await import('node:net');
  const server = net.createServer(socket => socket.end()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const port = server.address().port;
    const script = `const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>{process.stdout.write('connected');process.exit(0)});s.on('error',e=>{process.stdout.write(e.code);process.exit(0)})`;
    const probe = await new Promise(resolve => {
      const child = spawn(SANDBOX_EXEC, ['-p', NO_NETWORK, process.execPath, '-e', script], { env: { PATH: process.env.PATH ?? '' } });
      let text = '';
      child.stdout.on('data', d => { text += d; });
      child.on('close', () => resolve(text));
    });
    assert.notEqual(probe, 'connected');
    assert.match(probe, /EPERM|EACCES/);
  } finally { server.close(); }
});

/** Runs a probe script under exactly the limits rulesync gets (review item W8). */
function probeUnderLimits(script) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'bowerloom-probe-'));
  folders.push(folder);
  const file = path.join(folder, 'probe.mjs');
  fs.writeFileSync(file, script);
  const run = spawnSync(SANDBOX_EXEC, ['-p', NO_NETWORK, process.execPath, '--permission', ...limits(folder).map(r => `--allow-fs-read=${r}`), `--allow-fs-write=${folder}`, '--import', preload, file],
    { cwd: folder, env: { PATH: process.env.PATH ?? '', HOME: path.join(folder, 'home') }, encoding: 'utf8', timeout: 30_000 });
  return run.stdout.trim();
}

test('W8: under the oracle limits a read outside them and a process start are both denied', ORACLE, () => {
  const out = probeUnderLimits(`import fs from 'node:fs'; import cp from 'node:child_process';
const r = []; try { fs.readFileSync('/etc/hosts'); r.push('read'); } catch (e) { r.push(e.code); }
try { cp.spawnSync('/bin/echo', ['x']); r.push('spawn'); } catch (e) { r.push(e.code); }
try { fs.readdirSync(${JSON.stringify(os.homedir())}); r.push('home'); } catch (e) { r.push(e.code); }
process.stdout.write(r.join(','));`);
  assert.equal(out, 'ERR_ACCESS_DENIED,ERR_ACCESS_DENIED,ERR_ACCESS_DENIED');
});

test('W8: the Node install that rulesync may read is the Node binary and its own lib folder only', () => {
  assert.deepEqual(nodeReads, [fs.realpathSync(process.execPath), path.join(path.dirname(path.dirname(fs.realpathSync(process.execPath))), 'lib')]);
});

test('rulesync ran under the profile: no network attempt, no process, no write or read outside its limits', ORACLE, () => {
  assertIsolated(codexRun);
  assertIsolated(v2Run);
  assert.ok(DIFFERENCES.length > 0, 'the comparison found nothing at all, so it is not comparing');
});

test('check 11: every rulesync difference is on the section 11 list (items 3 and 4)', ORACLE, () => {
  assert.deepEqual(DIFFERENCES.filter(d => explainedBy(d).length === 0).map(describe), []);
  for (const [id, item] of Object.entries(ITEM_4_FILES)) assert.ok(item.present(), id);
});

test('check 11: each item 4 difference still occurs, so a stale item is noticed', ORACLE, () => {
  for (const [id, item] of Object.entries(ITEM_4)) assert.ok(DIFFERENCES.some(d => item.explains(d)), id);
});

test('check 11: the item 3 differences that a guardrail fixture can reach occur as the spec says', ORACLE, () => {
  assert.ok(DIFFERENCES.some(ITEM_3['dropped-deny'].explains), 'dropped-deny');
  assert.ok(DIFFERENCES.some(ITEM_3['codex-allow'].explains), 'codex-allow');
  assert.ok(Array.isArray(JSON.parse(oc2Text).permissions) && JSON.parse(oc2Text).permission === undefined, 'opencode-2x');
  assert.ok(rsRules.some(r => r.decision === 'allow'), 'rulesync wrote a Codex allow rule');
  const ours = translateGuardrails('codex', { rules: CARRIED, sandbox: [] }).form.prefixRules;
  assert.ok(ours.some(r => r.decision === 'forbidden' && r.pattern.join(' ') === 'git push'));
  assert.equal(ours.some(r => r.decision === 'allow'), false);
});

test('check 11, item 5: rulesync 43.2.0 kept the unmanaged Codex entry', ORACLE, () => {
  assert.ok(codexToml.includes(UNMANAGED_TOML), 'if this fails, the config-overwrite item of the list explains it');
});

test('check 11: the subagent and default-value items are not reached by guardrail fixtures', { skip: 'The subagent and MCP projection lanes own those parts; this lane projects guardrails only.' }, () => {});
