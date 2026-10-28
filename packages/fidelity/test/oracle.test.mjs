// Locked-in parts spec, section 11 (test oracle) and section 12 check 11. rulesync 43.2.0, MIT, a pinned dev
// dependency, never a run-time one. Its `convert` runs on the same synthetic fixture as Bowerloom, and the outputs are
// compared by what each engine would decide for the same requests. Every difference must be explained.
//
// Isolation: rulesync runs in a child process under the Node permission model. It can read files but can write only
// inside a fresh temporary folder, cannot start processes or workers, and has HOME set inside that folder. A preload
// refuses every network call and leaves a marker on stderr. The test fails if either limit is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codexCommands, codexDecide, codexFilesystemDecide, codexPrefix, codexPatternMatches, codexShellArgv, engineDecision,
  morePermissive, neutralDecision, openCodeDecide, openCodeFromConfig, openCodePathPatterns, openCodeRequest, openCodeWildcard, pathMatches, splitCommand, translateGuardrails,
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
  const run = spawnSync(process.execPath, [
    '--permission', '--allow-fs-read=*', `--allow-fs-write=${folder}`, '--import', preload,
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

const codexRun = convert('codexcli,opencodev1');
const v2Run = convert('opencode');
const rsRules = parseCodexRules(read(codexRun.folder, '.codex/rules/rulesync.rules'));
const rsFilesystem = parseWorkspaceRoots(read(codexRun.folder, '.codex/config.toml'));
const codexToml = read(codexRun.folder, '.codex/config.toml') ?? '';
const oc1Text = read(codexRun.folder, 'opencode.jsonc') ?? read(codexRun.folder, 'opencode.json') ?? '{}';
const oc2Text = read(v2Run.folder, 'opencode.jsonc') ?? read(v2Run.folder, 'opencode.json') ?? '{}';
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
const DIFFERENCES = computeDifferences();

const isPath = r => ['read', 'edit', 'write'].includes(r.action);
const looser = d => morePermissive(d.rulesync, d.bowerloom);

/** Section 11, item 3: the known differences, in the spec's words. */
const SPEC_LIST = {
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

/**
 * Differences that this oracle run found on 2026-10-28 and that the section 11 list does not hold. They are kept apart
 * from the spec list: adding them to it is Hanna's decision. Until then the strict check 11 test below is a TODO, and
 * the pinned test fails on any difference that is in neither list.
 */
const FOUND_2026_10_28 = {
  'root-only-paths': {
    text: 'Rulesync writes a path deny or ask at the project root only. Claude Code, the source, matches it at any depth, and Bowerloom keeps that.',
    // The path matches the rule only below the root: `./` pins a pattern to the root.
    explains: d => isPath(d.request) && CARRIED.some(r => isPath(r) && r.effect !== 'allow' && pathMatches(r.pattern, d.request.path, 'any-depth') && !pathMatches(`./${r.pattern}`, d.request.path, 'anchored')),
  },
  'opencode-read-deny-edit': {
    text: 'For OpenCode, rulesync does not write a read deny under edit. In the source a read deny also blocks changes, and Bowerloom writes both.',
    explains: d => d.engine === 'opencode' && ['edit', 'write'].includes(d.request.action) && looser(d)
      && CARRIED.some(r => r.action === 'read' && r.effect === 'deny' && pathMatches(r.pattern, d.request.path, 'any-depth')),
  },
  'opencode-colon-tail': {
    text: 'For OpenCode, rulesync keeps a trailing :* as text, which OpenCode reads as a literal colon, so the rule never matches. Bowerloom writes a trailing space and *.',
    explains: d => d.engine === 'opencode' && d.request.action === 'shell' && CARRIED.some(r => r.action === 'shell' && r.pattern.endsWith(':*')
      && splitCommand(d.request.command).some(command => neutralDecision([r], { action: 'shell', command }) !== 'default')),
  },
  'opencode-wider-allow': {
    text: 'For OpenCode, rulesync writes a path allow whose * stays inside one folder as it is. OpenCode reads * across folders, so the allow covers more than the source. Bowerloom leaves it out, and reports it absent.',
    explains: d => d.engine === 'opencode' && isPath(d.request) && d.rulesync === 'allow' && CARRIED.some(r => isPath(r) && r.effect === 'allow'
      && openCodePathPatterns(r.pattern, 'allow').wider && openCodeWildcard(d.request.path, r.pattern)),
  },
  'codex-mcp': {
    text: 'Rulesync carries no MCP rule into Codex. Bowerloom disables the denied tool or server.',
    explains: d => d.engine === 'codex' && d.request.action === 'mcp' && looser(d),
  },
  'opencode-skill-key': {
    text: 'For OpenCode, rulesync writes skill rules under the key Skill, which OpenCode does not read. Bowerloom writes them under skill.',
    explains: d => d.engine === 'opencode' && d.request.action === 'skill' && d.rulesync === 'default',
  },
};

/** File-level differences: settings that change what an engine allows but that no fixture request reaches. */
const FILE_FINDINGS_2026_10_28 = {
  'codex-network-enabled': {
    text: 'From a web fetch allow, rulesync sets network.enabled = true on the Codex profile, which opens the network to sandboxed commands. Codex has no web rule target, so Bowerloom writes nothing.',
    present: () => /\[permissions\.[^.\]]+\.network\]\nenabled = true/.test(codexToml),
  },
  'codex-modes': {
    text: 'Rulesync sets approval_policy, approvals_reviewer, and default_permissions in Codex. Bowerloom writes the engine default for modes and reports it (section 8.3 rule 12).',
    present: () => /^approval_policy = /m.test(codexToml) && /^default_permissions = /m.test(codexToml),
  },
  'codex-git-write': {
    text: 'Rulesync adds ".git/**" = "write" to the Codex profile, which reopens writes that the Codex workspace baseline keeps read-only. Bowerloom adds no grant.',
    present: () => codexToml.includes('".git/**" = "write"'),
  },
};

const explainedBy = (list, d) => Object.entries(list).filter(([, k]) => k.explains(d)).map(([id]) => id);
const unlisted = DIFFERENCES.filter(d => explainedBy(SPEC_LIST, d).length === 0);
const describe = d => `${d.engine} ${JSON.stringify(d.request)}: Bowerloom ${d.bowerloom}, rulesync ${d.rulesync}, source ${d.neutral}`;

test('rulesync 43.2.0 is the pinned MIT oracle, and it ran with no network, no process, and no write outside its folder', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/rulesync/package.json'), 'utf8'));
  assert.equal(pkg.version, '43.2.0');
  assert.equal(pkg.license, 'MIT');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies.rulesync, '43.2.0');
  assertIsolated(codexRun);
  assertIsolated(v2Run);
  assert.ok(DIFFERENCES.length > 0, 'the comparison found nothing at all, so it is not comparing');
});

test('check 11: every rulesync difference is on the section 11 list', {
  todo: unlisted.length ? `${unlisted.length} differences in ${new Set(unlisted.flatMap(d => explainedBy(FOUND_2026_10_28, d))).size} kinds are not on the section 11 list yet; see FOUND_2026_10_28. Adding them is Hanna's decision.` : false,
}, () => {
  assert.deepEqual(unlisted.map(describe), []);
});

test('check 11, pinned: every difference is on the section 11 list or in the findings of 2026-10-28, so a new one fails', () => {
  const unexplained = DIFFERENCES.filter(d => explainedBy(SPEC_LIST, d).length === 0 && explainedBy(FOUND_2026_10_28, d).length === 0);
  assert.deepEqual(unexplained.map(describe), []);
});

test('check 11: each recorded finding of 2026-10-28 still occurs, so a stale one is removed', () => {
  for (const [id, finding] of Object.entries(FOUND_2026_10_28)) assert.ok(DIFFERENCES.some(d => finding.explains(d)), id);
  for (const [id, finding] of Object.entries(FILE_FINDINGS_2026_10_28)) assert.ok(finding.present(), id);
});

test('check 11: the known differences that a guardrail fixture can reach occur as the spec says', () => {
  assert.ok(DIFFERENCES.some(SPEC_LIST['dropped-deny'].explains), 'dropped-deny');
  assert.ok(DIFFERENCES.some(SPEC_LIST['codex-allow'].explains), 'codex-allow');
  assert.ok(Array.isArray(JSON.parse(oc2Text).permissions) && JSON.parse(oc2Text).permission === undefined, 'opencode-2x');
  assert.ok(rsRules.some(r => r.decision === 'allow'), 'rulesync wrote a Codex allow rule');
  // Bowerloom's side of the same fixture: the forbidden prefix, and no Codex allow.
  const ours = translateGuardrails('codex', { rules: CARRIED, sandbox: [] }).form.prefixRules;
  assert.ok(ours.some(r => r.decision === 'forbidden' && r.pattern.join(' ') === 'git push'));
  assert.equal(ours.some(r => r.decision === 'allow'), false);
});

test('check 11: rulesync 43.2.0 kept the unmanaged Codex entry, so the config-overwrite difference does not occur here', () => {
  assert.ok(codexToml.includes(UNMANAGED_TOML), 'if this fails, the config-overwrite item of the section 11 list explains it');
});

test('check 11: the subagent and default-value items are not reached by guardrail fixtures', { skip: 'The subagent and MCP projection lanes own those parts; this lane projects guardrails only.' }, () => {});
