// Step 5, lane D: the 0.8 `bowerloom harness` commands, through the real binary (blueprint section F, item 1).
// Every run gets its own HOME and XDG_STATE_HOME under a temporary folder. The project is synthetic
// (tests/fixtures/harness-08/project.json). No engine runs; engine versions come from harness.json. The tests assert
// exit codes and refusal codes, never the refusal words, which lane C owns.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { baseEnv, cli, errorCode, removeAll, run } from './support/config-cli.js';
import { applyAdoption, planAdoption } from '../packages/adoption/src/index.js';
import { applyPortable, harnessStateDirs, planPortable } from '../packages/project-sync/src/index.js';
import { DefinitionError } from '../packages/contracts/src/index.js';
import { reportFailure } from '../apps/cli/src/human.js';
import { withPartialWords } from '../apps/cli/src/harness-def.js';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../tests/fixtures/harness-08/project.json', import.meta.url)), 'utf8')) as { files: Record<string, string> };
const ENGINES = ['--engine', 'claude-code@2.1.310', '--engine', 'codex@0.157.0', '--engine', 'opencode@1.18.30'];
const PICK = ['--pick', 'system-prompt/AGENTS.md=AGENTS.md'];
/** Decision D8B: the guardrail, hook, and servers found in Claude Code files apply to every engine of the harness. */
const EVERY = ['--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp'];
const KEY = /^(skills|subagents|guardrails|hooks|mcp)\/[^@\s]+@(claude-code|codex|opencode|pi|deepseek-harness):[a-f0-9]{12}$/;
/** Files install finds equal in bytes or in meaning to what it would write. It takes them over: it records them and writes nothing. */
const TAKEN_OVER = ['.claude/settings.json', '.claude/skills/review/SKILL.md', '.mcp.json', 'AGENTS.md'];

interface W { base: string; home: string; dir: string; state: string; env: Record<string, string> }
interface Refused { key: string; part: string; entry: string; field?: string; engine: string; result: string; reason: string; approvable: boolean }

function world(t: TestContext): W {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-harness-def-')));
  t.after(() => removeAll(base));
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const dir = join(home, 'Projects', 'e2e'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, text] of Object.entries(FIXTURE.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text, { mode: 0o644 }); }
  return { base, home, dir, state: join(base, 'state'), env: { HOME: home, XDG_STATE_HOME: join(base, 'state'), BOWERLOOM_PREVIEW_ENGINES: '1' } };
}
const bl = (w: W, args: string[], cwd = w.dir) => run(cwd, ['harness', ...args], w.env);
const json = <T = Record<string, unknown>>(text: string): T => JSON.parse(text) as T;
const stateRoot = (w: W): string => join(w.state, 'bowerloom');

/** Every file and folder under a root, with its mode and content hash. */
function snapshot(root: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(root)) return out;
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(root, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      if (skip(r)) continue;
      const st = lstatSync(join(root, r)), mode = (st.mode & 0o7777).toString(8);
      if (st.isDirectory()) { out[`${r}/`] = mode; walk(r); } else out[r] = `${mode} ${createHash('sha256').update(readFileSync(join(root, r))).digest('hex')}`;
    }
  };
  walk(''); return out;
}
const outsideDefinition = (rel: string): boolean => rel === '.bowerloom' || rel.startsWith('.bowerloom/');

/**
 * Plans adoption (exit 3), then applies it with every confirmation the plan asks for. By default the guardrail, hook, and
 * servers apply to every engine (decision D8B), so no one edits the definition by hand.
 */
function adopt(w: W, every: readonly string[] = EVERY): { revision: string; approvals: string[] } {
  const planned = bl(w, ['adopt', ...ENGINES, ...PICK, ...every, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { approvalsRequired: string[]; ready: boolean } }>(planned.stdout);
  assert.equal(body.plan.ready, true);
  const confirms = body.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const applied = bl(w, ['adopt', ...ENGINES, ...PICK, ...every, ...confirms, '--approve', body.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  return { revision: body.revision, approvals: body.plan.approvalsRequired };
}

/** Install refuses with fidelity lines; each is accepted; install then plans (exit 3) and applies (exit 0). */
function install(w: W): { refused: Refused[]; revision: string; changes: { path: string; action: string }[]; takenOver: { path: string; entry?: string }[] } {
  const first = bl(w, ['install', '--json']);
  assert.equal(first.status, 1, first.stderr + first.stdout);
  assert.equal(errorCode(first.stderr), 'PORTABLE_FIDELITY');
  const refused = json<{ code: string; refused: Refused[] }>(first.stdout).refused;
  for (const line of refused) {
    const accepted = bl(w, ['accept', line.key, '--json']);
    assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
  }
  const planned = bl(w, ['install', '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { changes: { path: string; action: string }[]; takenOver: { path: string; entry?: string }[] } }>(planned.stdout);
  const applied = bl(w, ['install', '--approve', body.revision, '--json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  return { refused, revision: body.revision, changes: body.plan.changes, takenOver: body.plan.takenOver };
}

test('Spec H check 7: adopt plans with exit 3 and writes nothing; apply writes only .bowerloom and every original stays byte for byte', t => {
  const w = world(t);
  const before = snapshot(w.base);
  const bare = bl(w, ['adopt', ...ENGINES, '--json']);
  assert.equal(bare.status, 3, bare.stderr);
  const plan = json<{ approvalRequired: boolean; plan: { ready: boolean; conflicts: { key: string }[] } }>(bare.stdout);
  assert.equal(plan.approvalRequired, true);
  assert.equal(plan.plan.ready, false, 'the AGENTS.md and CLAUDE.md conflict waits for --pick');
  assert.deepEqual(plan.plan.conflicts.map(c => c.key), ['system-prompt/AGENTS.md']);
  const human = bl(w, ['adopt', ...ENGINES, ...PICK]);
  assert.equal(human.status, 3, human.stderr);
  assert.match(human.stdout, /Revision: [a-f0-9]{64}\n/);
  assert.match(human.stdout, /--confirm/);
  assert.deepEqual(snapshot(w.base), before, 'a plan writes nothing, in the project or the private state');

  // Apply without the confirmations the plan lists refuses, and writes nothing.
  const planned = json<{ revision: string; plan: { approvalsRequired: string[] } }>(bl(w, ['adopt', ...ENGINES, ...PICK, '--json']).stdout);
  assert.ok(planned.plan.approvalsRequired.length > 0);
  const unconfirmed = bl(w, ['adopt', ...ENGINES, ...PICK, '--approve', planned.revision]);
  assert.equal(unconfirmed.status, 1); assert.equal(errorCode(unconfirmed.stderr), 'ADOPTION_APPROVAL_REQUIRED');
  assert.equal(existsSync(join(w.dir, '.bowerloom')), false);

  const originals = snapshot(w.dir);
  adopt(w);
  assert.deepEqual(snapshot(w.dir, outsideDefinition), originals, 'every file outside .bowerloom is byte for byte the same');
  for (const rel of ['harness.json', 'instructions/AGENTS.md', 'skills/review/SKILL.md', 'guardrails.json', 'hooks.json', 'mcp.json']) assert.ok(existsSync(join(w.dir, '.bowerloom', rel)), rel);
  const status = bl(w, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  const s = json<{ definition: { present: boolean; engines: { id: string; version: string }[] }; projected: boolean }>(status.stdout);
  assert.equal(s.definition.present, true); assert.equal(s.projected, false);
  assert.deepEqual(s.definition.engines, [{ id: 'claude-code', version: '2.1.310' }, { id: 'codex', version: '0.157.0' }, { id: 'opencode', version: '1.18.30' }]);
  // A second adoption refuses: the folder has a 0.8 harness now.
  const again = bl(w, ['adopt', ...ENGINES, ...PICK, '--json']);
  assert.equal(again.status, 1); assert.equal(errorCode(again.stderr), 'ADOPTION_DEFINED');
});

test('Decision D8B: adopt --every-engine for guardrails, hooks, and mcp widens them; install gives Codex and OpenCode lines with no hand edit', t => {
  const w = world(t);
  type Every = { part: string; chosen: boolean; widens: number; notWidened: { id: string; reason: string }[] };
  const plain = json<{ revision: string; plan: { everyEngine: Every[] } }>(bl(w, ['adopt', ...ENGINES, ...PICK, '--json']).stdout);
  assert.deepEqual(plain.plan.everyEngine.map(e => [e.part, e.chosen, e.widens]), [['guardrails', false, 1], ['hooks', false, 1], ['mcp', false, 2]], 'each part counts what the choice would widen');
  const human = bl(w, ['adopt', ...ENGINES, ...PICK]);
  assert.match(human.stdout, /--every-engine hooks/);
  const planned = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, '--json']);
  assert.equal(planned.status, 3, planned.stderr);
  const wide = json<{ revision: string; plan: { everyEngine: Every[]; approvalsRequired: string[] } }>(planned.stdout);
  assert.deepEqual(wide.plan.everyEngine.map(e => [e.part, e.chosen, e.widens, e.notWidened.length]), [['guardrails', true, 1, 0], ['hooks', true, 1, 0], ['mcp', true, 2, 0]]);
  assert.notEqual(wide.revision, plain.revision, 'the choice is part of the plan revision');
  // An approval made without the choice does not match the plan with it.
  const confirms = wide.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const stale = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, ...confirms, '--approve', plain.revision]);
  assert.equal(stale.status, 1); assert.equal(errorCode(stale.stderr), 'STALE_APPROVAL');
  assert.equal(existsSync(join(w.dir, '.bowerloom')), false);
  // The flag repeated in another order is the same plan.
  const reordered = json<{ revision: string }>(bl(w, ['adopt', ...ENGINES, ...PICK, '--every-engine', 'mcp', '--every-engine', 'hooks', '--every-engine', 'guardrails', '--json']).stdout);
  assert.equal(reordered.revision, wide.revision);
  adopt(w);
  for (const [file, key] of [['guardrails.json', 'rules'], ['hooks.json', 'hooks'], ['mcp.json', 'servers']] as const) {
    const value = json<Record<string, Record<string, unknown>[]>>(readFileSync(join(w.dir, '.bowerloom', file), 'utf8'));
    for (const entry of value[key]!) assert.equal('engines' in entry, false, `${file}: ${JSON.stringify(entry)}`);
  }
  const { refused } = install(w);
  for (const rel of ['.codex/rules/bowerloom.rules', '.codex/hooks.json', '.opencode/plugins/bowerloom-hooks.js']) assert.ok(existsSync(join(w.dir, rel)), `${rel}: the Claude Code deny rule and hook reach Codex and OpenCode`);
  assert.match(readFileSync(join(w.dir, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.lint\]/, 'and a Claude Code server reaches Codex');
  assert.ok(Object.keys(json<{ mcp: Record<string, unknown> }>(readFileSync(join(w.dir, 'opencode.json'), 'utf8')).mcp).length >= 2, 'and OpenCode');
  assert.deepEqual([...new Set(refused.map(l => l.engine))].sort(), ['codex', 'opencode']);
  assert.ok(refused.some(l => l.part === 'hooks') && refused.some(l => l.part === 'guardrails'), refused.map(l => l.key).join(' '));
});

test('Spec P check 7: install to claude-code, codex and opencode gives fidelity lines; accept each; install exits 3, then 0', t => {
  const w = world(t);
  adopt(w);
  const { refused, changes } = install(w);
  assert.ok(refused.length >= 3, 'the deny rule and the hook are weaker in Codex and OpenCode');
  for (const line of refused) {
    assert.match(line.key, KEY); assert.equal(line.approvable, true);
    assert.ok(['codex', 'opencode'].includes(line.engine), line.key);
    assert.ok(['weakened', 'absent'].includes(line.result));
    assert.ok(line.key.startsWith(`${line.part}/${line.entry}${line.field ? `.${line.field}` : ''}@${line.engine}:`));
  }
  assert.deepEqual(refused.map(l => l.engine).filter((e, i, a) => a.indexOf(e) === i).sort(), ['codex', 'opencode']);
  // The paths of the projection for the three engines.
  const written = changes.filter(c => c.action !== 'unchanged').map(c => c.path).sort();
  assert.deepEqual(written, ['.agents/skills/review/SKILL.md', '.claude/settings.json', '.claude/skills/review/SKILL.md', '.codex/config.toml', '.codex/hooks.json', '.codex/rules/bowerloom.rules', '.mcp.json', '.opencode/plugins/bowerloom-hooks.js', 'AGENTS.md', 'CLAUDE.md', 'opencode.json'].sort());
  for (const rel of written) assert.ok(existsSync(join(w.dir, rel)), rel);
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n', 'accept-agents, the default reconcile');
  assert.equal(readFileSync(join(w.dir, 'AGENTS.md'), 'utf8'), readFileSync(join(w.dir, '.bowerloom', 'instructions', 'AGENTS.md'), 'utf8'));
  const status = json<{ projected: boolean; drafts: number; receipt: { approvals: number } }>(bl(w, ['status', '--json']).stdout);
  assert.equal(status.projected, true);
  assert.equal(status.drafts, 0, 'drafts are dropped once the receipt records them');
  assert.equal(status.receipt.approvals, refused.length);
  // Accepting a line again is harmless: the receipt already holds it.
  const again = bl(w, ['accept', refused[0]!.key]);
  assert.equal(again.status, 0, again.stderr);
});

test('Install takes over files equal in bytes or meaning: it records them, writes nothing to them, and removal leaves them as they were', t => {
  const w = world(t);
  adopt(w);
  const originals = snapshot(w.dir, outsideDefinition);
  const modes = Object.fromEntries(TAKEN_OVER.map(rel => [rel, lstatSync(join(w.dir, rel)).mode & 0o7777]));
  const first = json<{ refused: Refused[] }>(bl(w, ['install', '--json']).stdout);
  for (const line of first.refused) assert.equal(bl(w, ['accept', line.key]).status, 0);
  // The person reads the plan: each equal file is marked take-over, not replace or update.
  const human = bl(w, ['install']);
  assert.equal(human.status, 3, human.stderr);
  for (const rel of TAKEN_OVER) assert.match(human.stdout, new RegExp(`take-over +${rel.replace(/[.\\/]/g, c => `\\${c}`)}\\n`), rel);
  const planned = bl(w, ['install', '--json']);
  assert.equal(planned.status, 3, planned.stderr);
  const { revision, plan: { changes, takenOver } } = json<{ revision: string; plan: { changes: { path: string; action: string }[]; takenOver: { path: string; entry?: string }[] } }>(planned.stdout);
  const applied = bl(w, ['install', '--approve', revision, '--json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const action = (rel: string): string | undefined => changes.find(c => c.path === rel)?.action;
  for (const rel of TAKEN_OVER) assert.equal(action(rel), 'take-over', rel);
  assert.equal(action('CLAUDE.md'), 'replace', 'CLAUDE.md differs from the reconciled text, so it is replaced and its original is saved');
  assert.equal(action('.codex/config.toml'), 'replace', 'the Codex file gains the adopted server beside the unmanaged one');
  assert.deepEqual([...new Set(takenOver.map(x => x.path))].sort(), TAKEN_OVER, 'the plan lists each taken over file once by path');
  assert.ok(takenOver.some(x => x.path === '.mcp.json' && x.entry === 'mcpServers.files'), 'and an entry of a shared file by name');
  assert.ok(takenOver.some(x => x.path === '.claude/settings.json' && x.entry === 'permissions.deny[0]'));
  // Nothing was written to a taken over file: same bytes, same mode.
  const now = snapshot(w.dir, outsideDefinition);
  for (const rel of TAKEN_OVER) { assert.equal(now[rel], originals[rel], `${rel} is byte for byte the original`); assert.equal(lstatSync(join(w.dir, rel)).mode & 0o7777, modes[rel]); }
  const status = json<{ receipt: { files: number } }>(bl(w, ['status', '--json']).stdout);
  assert.ok(status.receipt.files >= TAKEN_OVER.length, 'the receipt records the taken over files');
  // A taken over file the person later changes is drift, like any file Bowerloom wrote.
  writeFileSync(join(w.dir, '.mcp.json'), '{"mcpServers":{}}\n');
  const drift = json<{ drift: { path: string; reason: string }[] }>(bl(w, ['drift', '--json']).stdout).drift;
  assert.deepEqual(drift.map(d => `${d.reason} ${d.path}`), ['changed .mcp.json']);
  writeFileSync(join(w.dir, '.mcp.json'), FIXTURE.files['.mcp.json']!);
  assert.deepEqual(json<{ drift: unknown[] }>(bl(w, ['drift', '--json']).stdout).drift, []);
  // Removal gives back the original of every path.
  const removal = json<{ revision: string }>(bl(w, ['remove', '--json']).stdout);
  assert.equal(bl(w, ['remove', '--approve', removal.revision]).status, 0);
  assert.deepEqual(snapshot(w.dir, outsideDefinition), originals);
});

test('Spec L checks 10 and 4: a second install is a no-op, and the unmanaged Codex server survives', t => {
  const w = world(t);
  adopt(w);
  const config = readFileSync(join(w.dir, '.codex', 'config.toml'), 'utf8');
  install(w);
  const after = snapshot(w.dir), stateAfter = snapshot(w.state);
  const second = bl(w, ['install', '--json']);
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(json<{ nothingToDo: boolean; noop: boolean }>(second.stdout).noop, true);
  const human = bl(w, ['install']);
  assert.equal(human.status, 0, human.stderr); assert.match(human.stdout, /Nothing to change/);
  assert.deepEqual(snapshot(w.dir), after, 'a no-op writes no project file');
  assert.deepEqual(snapshot(w.state), stateAfter, 'and no record');
  const now = readFileSync(join(w.dir, '.codex', 'config.toml'), 'utf8');
  assert.ok(now.startsWith(config), 'the unmanaged server is kept as written, byte for byte');
  assert.match(now, /\[mcp_servers\.lint\]/, 'the adopted server is added beside it');
});

test('Spec P check 3 and decision D5A: drift shows changed and mode, removal refuses, recover clears both, removal restores every original', t => {
  const w = world(t);
  adopt(w);
  const beforeInstall = snapshot(w.dir);
  install(w);
  const clean = bl(w, ['drift', '--check', '--json']);
  assert.equal(clean.status, 0, clean.stderr); assert.deepEqual(json<{ drift: unknown[] }>(clean.stdout).drift, []);

  writeFileSync(join(w.dir, '.claude/skills/review/SKILL.md'), '---\nname: review\ndescription: Reviews a change.\n---\n\nReview it twice.\n');
  chmodSync(join(w.dir, 'AGENTS.md'), 0o755);
  chmodSync(join(w.dir, '.agents/skills/review/SKILL.md'), 0o600);
  const drift = bl(w, ['drift', '--json']);
  assert.equal(drift.status, 0, drift.stderr);
  const lines = json<{ drift: { path: string; reason: string }[] }>(drift.stdout).drift.map(d => `${d.reason} ${d.path}`).sort();
  assert.deepEqual(lines, ['changed .claude/skills/review/SKILL.md', 'mode .agents/skills/review/SKILL.md', 'mode AGENTS.md']);
  const check = bl(w, ['drift', '--check']);
  assert.equal(check.status, 1); assert.equal(errorCode(check.stderr), 'PORTABLE_DRIFT');
  assert.match(check.stdout, /changed {2}\.claude\/skills\/review\/SKILL\.md/);

  const blocked = bl(w, ['remove', '--json']);
  assert.equal(blocked.status, 1); assert.equal(errorCode(blocked.stderr), 'PORTABLE_DRIFT');
  // A mode open to group or world write is never recorded.
  chmodSync(join(w.dir, '.agents/skills/review/SKILL.md'), 0o666);
  const open = bl(w, ['recover', '--record-mode', '.agents/skills/review/SKILL.md', '--json']);
  assert.equal(open.status, 1); assert.equal(errorCode(open.stderr), 'PORTABLE_MODE_UNSAFE');
  chmodSync(join(w.dir, '.agents/skills/review/SKILL.md'), 0o600);

  const recoverArgs = ['recover', '--keep', '.claude/skills/review/SKILL.md', '--restore-mode', 'AGENTS.md', '--record-mode', '.agents/skills/review/SKILL.md'];
  const planned = bl(w, [...recoverArgs, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const revision = json<{ revision: string; plan: { action: string } }>(planned.stdout);
  assert.equal(revision.plan.action, 'mode');
  const applied = bl(w, [...recoverArgs, '--approve', revision.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.equal(lstatSync(join(w.dir, 'AGENTS.md')).mode & 0o777, 0o644, 'restore-mode puts the mode back');
  assert.equal(lstatSync(join(w.dir, '.agents/skills/review/SKILL.md')).mode & 0o777, 0o600, 'record-mode keeps the new mode');
  const none = bl(w, ['drift', '--check', '--json']);
  assert.equal(none.status, 0, none.stderr + none.stdout); assert.deepEqual(json<{ drift: unknown[] }>(none.stdout).drift, []);

  const removal = bl(w, ['remove', '--json']);
  assert.equal(removal.status, 3, removal.stderr + removal.stdout);
  const removed = bl(w, ['remove', '--approve', json<{ revision: string }>(removal.stdout).revision]);
  assert.equal(removed.status, 0, removed.stderr + removed.stdout);
  // Every original is back. The kept skill file is the person's own version now, so removal leaves it.
  const after = snapshot(w.dir);
  const kept = '.claude/skills/review/SKILL.md';
  assert.match(readFileSync(join(w.dir, kept), 'utf8'), /Review it twice/);
  const withoutKept = (s: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(s).filter(([k]) => k !== kept));
  assert.deepEqual(withoutKept(after), withoutKept(beforeInstall));
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), FIXTURE.files['CLAUDE.md']);
  assert.equal(readFileSync(join(w.dir, '.codex', 'config.toml'), 'utf8'), FIXTURE.files['.codex/config.toml']);
  const status = json<{ projected: boolean; drafts: number }>(bl(w, ['status', '--json']).stdout);
  assert.equal(status.projected, false); assert.equal(status.drafts, 0);
  const nothing = bl(w, ['remove']);
  assert.equal(nothing.status, 1); assert.equal(errorCode(nothing.stderr), 'PORTABLE_NOTHING_PROJECTED');
});

test('A stale --approve refuses STALE_APPROVAL, and accept refuses a key whose entry changed', t => {
  const w = world(t);
  adopt(w);
  const first = json<{ refused: Refused[] }>(bl(w, ['install', '--json']).stdout).refused;
  for (const line of first) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const planned = json<{ revision: string }>(bl(w, ['install', '--json']).stdout);
  // The person changes the hook after seeing the plan.
  const hooks = join(w.dir, '.bowerloom', 'hooks.json'), value = json<{ hooks: Record<string, unknown>[] }>(readFileSync(hooks, 'utf8'));
  value.hooks[0]!.command = 'echo check twice';
  writeFileSync(hooks, `${JSON.stringify(value, null, 2)}\n`);
  const files = snapshot(w.dir);
  const stale = bl(w, ['install', '--approve', planned.revision]);
  // The changed hook has a new entry hash, so its drafts no longer count, and its lines are refused again.
  assert.equal(stale.status, 1, stale.stdout); assert.equal(errorCode(stale.stderr), 'PORTABLE_FIDELITY');
  assert.deepEqual(snapshot(w.dir), files, 'nothing was written');
  // The old key of the hook now names an entry that changed.
  const hookKey = first.find(l => l.part === 'hooks')!.key;
  const refusedKey = bl(w, ['accept', hookKey, '--json']);
  assert.equal(refusedKey.status, 1, refusedKey.stderr); assert.equal(errorCode(refusedKey.stderr), 'HARNESS_APPROVAL_STALE');
  // Once the new lines are accepted, the old plan revision is still stale.
  const fresh = json<{ refused: Refused[] }>(bl(w, ['install', '--json']).stdout).refused;
  assert.ok(fresh.some(l => l.part === 'hooks' && l.key !== hookKey));
  for (const line of fresh) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const again = bl(w, ['install', '--approve', planned.revision]);
  assert.equal(again.status, 1); assert.equal(errorCode(again.stderr), 'STALE_APPROVAL');
  const malformed = bl(w, ['accept', 'not-a-key']);
  assert.equal(malformed.status, 2); assert.equal(errorCode(malformed.stderr), 'USAGE');
});

test('Decision D4A: merge moves CLAUDE.md into the definition; install then makes CLAUDE.md @AGENTS.md, and removal restores it', t => {
  const w = world(t);
  adopt(w);
  const claude = readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8');
  const drift = json<{ instructions: { agents: string } | null }>(bl(w, ['drift', '--json']).stdout);
  assert.notEqual(drift.instructions, null, 'CLAUDE.md does not follow AGENTS.md');
  const viaInstall = bl(w, ['install', '--reconcile', 'merge', '--json']);
  assert.equal(viaInstall.status, 1); assert.equal(errorCode(viaInstall.stderr), 'PORTABLE_MERGE_NOT_BUILT');
  const planned = bl(w, ['merge', '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const merged = bl(w, ['merge', '--approve', json<{ revision: string }>(planned.stdout).revision]);
  assert.equal(merged.status, 0, merged.stderr + merged.stdout);
  const instructions = readFileSync(join(w.dir, '.bowerloom', 'instructions', 'AGENTS.md'), 'utf8');
  assert.match(instructions, /From CLAUDE\.md/); assert.match(instructions, /Use pnpm\./);
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), claude, 'merge edits the definition only');
  const twice = bl(w, ['merge', '--json']);
  assert.equal(twice.status, 1); assert.equal(errorCode(twice.stderr), 'ADOPTION_MERGE_NOTHING');
  install(w);
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.match(readFileSync(join(w.dir, 'AGENTS.md'), 'utf8'), /Use pnpm\./);
  const removal = json<{ revision: string }>(bl(w, ['remove', '--json']).stdout);
  assert.equal(bl(w, ['remove', '--approve', removal.revision]).status, 0);
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), claude);
});

test('Decision D4A: recover --adoption puts back a merge that stopped part way', t => {
  const w = world(t);
  adopt(w);
  const definition = snapshot(join(w.dir, '.bowerloom'));
  const planned = json<{ revision: string }>(bl(w, ['merge', '--json']).stdout);
  // A merge that dies after its first write, in its own process, leaves its journal.
  const dirs = harnessStateDirs(stateRoot(w), w.dir);
  const merge = fileURLToPath(new URL('../packages/adoption/src/merge.js', import.meta.url));
  const script = `const m = await import(${JSON.stringify(merge)}); await m.applyInstructionMergeWith({ projectDir: ${JSON.stringify(w.dir)}, stateDir: ${JSON.stringify(dirs.adoption)} }, ${JSON.stringify(planned.revision)}, new AbortController().signal, { afterWrite: () => process.exit(9) });`;
  const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...baseEnv(), ...w.env } });
  assert.equal(crashed.status, 9, crashed.stderr);
  assert.notDeepEqual(snapshot(join(w.dir, '.bowerloom')), definition, 'the stopped merge wrote a file');
  const status = json<{ unfinished: { merge: boolean } }>(bl(w, ['status', '--json']).stdout);
  assert.equal(status.unfinished.merge, true);
  const blocked = bl(w, ['merge', '--json']);
  assert.equal(blocked.status, 1); assert.equal(errorCode(blocked.stderr), 'ADOPTION_RECOVERY_REQUIRED');
  const recovery = bl(w, ['recover', '--adoption', '--json']);
  assert.equal(recovery.status, 3, recovery.stderr + recovery.stdout);
  const done = bl(w, ['recover', '--adoption', '--approve', json<{ revision: string }>(recovery.stdout).revision]);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  assert.deepEqual(snapshot(join(w.dir, '.bowerloom')), definition, 'the definition is as it was before the merge');
  assert.equal(json<{ unfinished: { merge: boolean } }>(bl(w, ['status', '--json']).stdout).unfinished.merge, false);
  const nothing = bl(w, ['recover', '--adoption']);
  assert.equal(nothing.status, 1); assert.equal(errorCode(nothing.stderr), 'ADOPTION_RECOVER_NOTHING');
});

test('Decision D3A: the record of the earlier app is moved on the first command, and removal works on it', async t => {
  const w = world(t);
  // The earlier app kept its record at <state>/desktop/<sha256(folder), 32 hex>/{adoption,portable}.
  const legacy = join(stateRoot(w), 'desktop', createHash('sha256').update(w.dir).digest('hex').slice(0, 32));
  mkdirSync(legacy, { recursive: true, mode: 0o700 });
  for (const p of [stateRoot(w), join(stateRoot(w), 'desktop'), w.state]) chmodSync(p, 0o700);
  const input = { projectDir: w.dir, stateDir: join(legacy, 'adoption'), engines: [{ id: 'claude-code' as const, version: '2.1.310' }] };
  const plan = planAdoption(input);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const io = { projectDir: w.dir, definitionFolder: join(w.dir, '.bowerloom'), stateDir: join(legacy, 'portable') };
  await applyPortable(io, planPortable(io).revision);
  const files = snapshot(w.dir);

  const moved = bl(w, ['status', '--dir', w.dir, '--json'], w.base);
  assert.equal(moved.status, 0, moved.stderr);
  const s = json<{ projected: boolean; legacy: string }>(moved.stdout);
  assert.equal(s.projected, true); assert.equal(s.legacy, 'moved');
  assert.equal(existsSync(legacy), false, 'the old record is gone from its old place');
  const dirs = harnessStateDirs(stateRoot(w), w.dir);
  assert.ok(existsSync(join(dirs.base, 'moved.json')));
  assert.ok(existsSync(join(dirs.portable, 'receipt.json')));
  assert.deepEqual(snapshot(w.dir), files, 'the move touches no project file');
  assert.equal(json<{ legacy: string }>(bl(w, ['status', '--json']).stdout).legacy, 'none', 'a second command moves nothing');
  const removal = json<{ revision: string }>(bl(w, ['remove', '--json']).stdout);
  const removed = bl(w, ['remove', '--approve', removal.revision]);
  assert.equal(removed.status, 0, removed.stderr + removed.stdout);
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), FIXTURE.files['CLAUDE.md']);
});

test('Routing and usage: 0.7 forms with --synthetic keep their handler; the 0.8 forms refuse bad flags with exit 2', t => {
  const w = world(t);
  for (const args of [['bogus'], ['status', '--dir', 'relative/path'], ['status', '--approve', 'a'.repeat(64)], ['install', '--engine'], ['install', '--engine', 'vim'], ['accept'], ['accept', 'a', 'b'], ['recover', '--adoption', '--keep', 'x'], ['drift', '--check', '--check'], ['adopt', '--pick', 'nothing'], ['adopt', '--every-engine', 'skills'], ['adopt', '--every-engine', 'hooks', '--every-engine', 'hooks'], ['adopt', '--every-engine'], []]) {
    const r = bl(w, args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`); assert.equal(errorCode(r.stderr), 'USAGE');
  }
  const old = run(w.dir, ['harness', 'removal-plan', '--synthetic'], w.env);
  assert.equal(old.status, 2); assert.match(json<{ error: { message: string } }>(old.stderr).error.message, /--synthetic/, 'the 0.7 handler names its own usage');
  const help = run(w.dir, ['help', 'harness'], w.env);
  assert.equal(help.status, 0, help.stderr); assert.match(help.stdout, /bowerloom harness install/);
  assert.equal(run(w.dir, ['harness', '--help'], w.env).status, 0);
  const short = run(w.dir, ['help'], w.env);
  assert.doesNotMatch(short.stdout, /harness install/, 'the new commands stay out of the short help');
  const yes = spawnSync(process.execPath, [cli, 'harness', 'drift', '--check', '-y'], { cwd: w.dir, encoding: 'utf8', env: { ...baseEnv(), ...w.env } });
  assert.equal(yes.status, 2, '-y after a flag that takes no value is the refused --yes');
  // Status of a folder with nothing: no definition, nothing projected, and nothing written.
  const before = snapshot(w.base);
  const status = bl(w, ['status']);
  assert.equal(status.status, 0, status.stderr); assert.match(status.stdout, /No harness definition/);
  assert.deepEqual(snapshot(w.base), before);
});

test('A partial refusal of adoption, merge, or install names the command that finishes it, as other partial refusals do', () => {
  for (const [code, fix] of [['ADOPTION_PARTIAL', 'bowerloom harness recover --adoption'], ['PORTABLE_PARTIAL', 'bowerloom harness recover']] as const) {
    const error = withPartialWords(new DefinitionError(code, 'Stopped part way. Already written: a.'));
    const agent = json<{ error: { code: string; next: string; fix: string; partial: boolean } }>(reportFailure(error, false).text);
    assert.equal(agent.error.code, code); assert.equal(agent.error.fix, fix); assert.equal(agent.error.partial, true);
    assert.equal(agent.error.next, `Run ${fix}.`);
    assert.equal(reportFailure(error, false).exitCode, 1);
  }
  const other = new DefinitionError('PORTABLE_DRIFT', 'x');
  assert.equal(withPartialWords(other), other); assert.equal('hint' in other, false);
});
