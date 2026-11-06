// Step 5 review fixes in the command line (items 1 to 7 and 10 to 13 of the fix list). Every run gets its own HOME and
// XDG_STATE_HOME under a temporary folder. The project is synthetic (tests/fixtures/harness-08/project.json). No engine
// runs, and nothing touches the network.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { baseEnv, cli, errorCode, errorMessage, removeAll, run } from './support/config-cli.js';
import { harnessStateDirs, planPortable } from '../packages/project-sync/src/index.js';
import { withProjectLock } from '../packages/project-context/src/index.js';
import { renderRefusal } from '../apps/cli/src/human.js';
import { resultLines, runHarnessDefCommand } from '../apps/cli/src/harness-def.js';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../tests/fixtures/harness-08/project.json', import.meta.url)), 'utf8')) as { files: Record<string, string> };
const ENGINES = ['--engine', 'claude-code@2.1.310', '--engine', 'codex@0.157.0', '--engine', 'opencode@1.18.30'];
const PICK = ['--pick', 'system-prompt/AGENTS.md=AGENTS.md'];
const EVERY = ['--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp'];

interface W { base: string; home: string; dir: string; state: string; env: Record<string, string> }
interface Refused { key: string; engine: string; part: string }

function world(t: TestContext): W {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-review-fixes-')));
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const dir = join(home, 'Projects', 'e2e'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, text] of Object.entries(FIXTURE.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text, { mode: 0o644 }); }
  const w = { base, home, dir, state: join(base, 'state'), env: { HOME: home, XDG_STATE_HOME: join(base, 'state'), BOWERLOOM_PREVIEW_ENGINES: '1' } };
  t.after(() => removeAll(base));
  return w;
}
const bl = (w: W, args: string[], cwd = w.dir) => run(cwd, ['harness', ...args], w.env);
const json = <T = Record<string, unknown>>(text: string): T => JSON.parse(text) as T;
const stateRoot = (w: W): string => join(w.state, 'bowerloom');
const dirsOf = (w: W) => harnessStateDirs(stateRoot(w), w.dir);

/** Runs the binary without blocking this process, so a lock held here can answer its banner while the child runs. */
function runAsync(w: W, args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'harness', ...args], { cwd: w.dir, env: { ...baseEnv(), ...w.env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += String(d); }); child.stderr.on('data', d => { stderr += String(d); });
    child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

function adopt(w: W): void {
  const planned = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { approvalsRequired: string[] } }>(planned.stdout);
  const confirms = body.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const applied = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, ...confirms, '--approve', body.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
}
/** Install refuses with lines; each is accepted; install then plans and applies. Returns the JSON of the apply. */
function install(w: W, extra: string[] = []): { refused: Refused[]; result: Record<string, unknown> } {
  const first = bl(w, ['install', ...extra, '--json']);
  assert.equal(first.status, 1, first.stderr + first.stdout);
  const refused = json<{ refused: Refused[] }>(first.stdout).refused;
  for (const line of refused) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const planned = bl(w, ['install', ...extra, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const applied = bl(w, ['install', ...extra, '--approve', json<{ revision: string }>(planned.stdout).revision, '--json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  return { refused, result: json<{ result: Record<string, unknown> }>(applied.stdout).result };
}
const editJson = (path: string, change: (v: any) => void): void => { const v = JSON.parse(readFileSync(path, 'utf8')); change(v); writeFileSync(path, `${JSON.stringify(v, null, 2)}\n`); };

// ---- item 1 -----------------------------------------------------------------------------------------------------------------

test('item 1: accept plans only the engine named in the key, so another engine\'s version refusal does not hide the line', t => {
  const w = world(t);
  adopt(w);
  // OpenCode is listed at a version Bowerloom does not write for: a plan over every listed engine refuses on that.
  editJson(join(w.dir, '.bowerloom', 'harness.json'), v => { v.engines.find((e: { id: string }) => e.id === 'opencode').version = '1.0.0'; });
  const all = bl(w, ['install', '--json']);
  assert.equal(errorCode(all.stderr), 'PORTABLE_ENGINE_VERSION');
  const two = bl(w, ['install', '--engine', 'claude-code', '--engine', 'codex', '--json']);
  assert.equal(two.status, 1, two.stderr); assert.equal(errorCode(two.stderr), 'PORTABLE_FIDELITY');
  const line = json<{ refused: Refused[] }>(two.stdout).refused.find(l => l.engine === 'codex')!;
  const accepted = bl(w, ['accept', line.key, '--json']);
  assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
  assert.equal(json<{ accepted: boolean }>(accepted.stdout).accepted, true);
});

// ---- item 2 -----------------------------------------------------------------------------------------------------------------

test('item 2: status and drift answer while another command holds the project lock; the help says every command settles an old record', async t => {
  const w = world(t);
  adopt(w);
  await withProjectLock(w.dir, new AbortController().signal, async () => {
    const status = await runAsync(w, ['status', '--json']);
    assert.equal(status.status, 0, status.stderr + status.stdout);
    assert.equal(json<{ legacy: string }>(status.stdout).legacy, 'none');
    const drift = await runAsync(w, ['drift', '--json']);
    assert.equal(drift.status, 0, drift.stderr + drift.stdout);
  });
  const help = run(w.dir, ['help', 'harness'], w.env);
  assert.match(help.stdout.replace(/\s+/g, ' '), /Any harness command settles the record of an older Bowerloom app once/);
});

// ---- item 3 -----------------------------------------------------------------------------------------------------------------

test('item 3: drift with nothing installed says so, reports projected false, and --check refuses PORTABLE_NOTHING_PROJECTED', t => {
  const w = world(t);
  adopt(w);
  const human = bl(w, ['drift']);
  assert.equal(human.status, 0, human.stderr); assert.match(human.stdout, /Nothing is installed/);
  const body = json<{ projected: boolean; drift: unknown[] }>(bl(w, ['drift', '--json']).stdout);
  assert.equal(body.projected, false); assert.deepEqual(body.drift, []);
  const check = bl(w, ['drift', '--check', '--json']);
  assert.equal(check.status, 1, check.stdout); assert.equal(errorCode(check.stderr), 'PORTABLE_NOTHING_PROJECTED');
  const checkHuman = bl(w, ['drift', '--check']);
  assert.equal(checkHuman.status, 1); assert.match(checkHuman.stdout, /Nothing is installed/);
});

test('item 3: drift refuses PORTABLE_RECOVERY_REQUIRED while an install or removal is unfinished, with and without --check', t => {
  const w = world(t);
  adopt(w); install(w);
  assert.equal(json<{ projected: boolean }>(bl(w, ['drift', '--json']).stdout).projected, true);
  writeFileSync(join(dirsOf(w).portable, 'pending.json'), '{}\n', { mode: 0o600 });
  for (const args of [['drift'], ['drift', '--check'], ['drift', '--json']]) {
    const r = bl(w, args);
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stdout}`); assert.equal(errorCode(r.stderr), 'PORTABLE_RECOVERY_REQUIRED');
  }
});

test('item 3: drift --check also fails when CLAUDE.md does not follow AGENTS.md', t => {
  const w = world(t);
  adopt(w); install(w, ['--reconcile', 'keep-both']);
  const plain = bl(w, ['drift', '--json']);
  assert.equal(plain.status, 0, plain.stderr);
  assert.notEqual(json<{ instructions: unknown }>(plain.stdout).instructions, null);
  const check = bl(w, ['drift', '--check', '--json']);
  assert.equal(check.status, 1, check.stdout); assert.equal(errorCode(check.stderr), 'PORTABLE_DRIFT');
  assert.match(errorMessage(check.stderr), /CLAUDE\.md/);
});

// ---- item 4 -----------------------------------------------------------------------------------------------------------------

test('item 4: a merge that stopped part way blocks install, remove, and accept with ADOPTION_RECOVERY_REQUIRED', t => {
  const w = world(t);
  adopt(w);
  const { refused } = install(w, ['--reconcile', 'keep-both']);
  const planned = json<{ revision: string }>(bl(w, ['merge', '--json']).stdout);
  const merge = fileURLToPath(new URL('../packages/adoption/src/merge.js', import.meta.url));
  const script = `const m = await import(${JSON.stringify(merge)}); await m.applyInstructionMergeWith({ projectDir: ${JSON.stringify(w.dir)}, stateDir: ${JSON.stringify(dirsOf(w).adoption)} }, ${JSON.stringify(planned.revision)}, new AbortController().signal, { afterWrite: () => process.exit(9) });`;
  const crashed = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...baseEnv(), ...w.env } });
  assert.equal(crashed.status, 9, crashed.stderr);
  for (const args of [['install', '--json'], ['remove', '--json'], ['accept', refused[0]!.key, '--json']]) {
    const r = bl(w, args);
    assert.equal(r.status, 1, `${args[0]}: ${r.stdout}`); assert.equal(errorCode(r.stderr), 'ADOPTION_RECOVERY_REQUIRED', args[0]);
    assert.match(errorMessage(r.stderr), /bowerloom harness recover --adoption/, args[0]);
  }
  // Status and drift still answer, and the recovery still works.
  assert.equal(bl(w, ['status']).status, 0);
  const recovery = json<{ revision: string }>(bl(w, ['recover', '--adoption', '--json']).stdout);
  assert.equal(bl(w, ['recover', '--adoption', '--approve', recovery.revision]).status, 0);
  assert.equal(bl(w, ['remove', '--json']).status, 3);
});

/** A journal as a stopped adoption leaves it: the shape `applyAdoption` writes before its first file. */
const STOPPED_ADOPTION = (projectDir: string): string => `${JSON.stringify({ format: 'bowerloom/adoption-pending/v1beta1', projectDir, planRevision: 'a'.repeat(64), files: [], dirs: [] }, null, 2)}\n`;

test('a stopped adoption blocks install, remove, and accept with ADOPTION_RECOVERY_REQUIRED, as a stopped merge does; status and recovery still answer', t => {
  const w = world(t);
  adopt(w);
  const { refused } = install(w, ['--reconcile', 'keep-both']);
  const journal = join(dirsOf(w).adoption, 'adoption-pending.json');
  mkdirSync(dirsOf(w).adoption, { recursive: true, mode: 0o700 });
  for (const text of [STOPPED_ADOPTION(w.dir), '{ not json']) {
    writeFileSync(journal, text, { mode: 0o600 });
    for (const args of [['install', '--json'], ['remove', '--json'], ['accept', refused[0]!.key, '--json']]) {
      const r = bl(w, args);
      assert.equal(r.status, 1, `${args[0]}: ${r.stdout}`); assert.equal(errorCode(r.stderr), 'ADOPTION_RECOVERY_REQUIRED', args[0]);
      assert.match(errorMessage(r.stderr), /adoption stopped part way/, args[0]);
      assert.match(errorMessage(r.stderr), /bowerloom harness recover --adoption/, args[0]);
    }
    assert.equal(bl(w, ['status']).status, 0);
  }
  writeFileSync(journal, STOPPED_ADOPTION(w.dir), { mode: 0o600 });
  const recovery = json<{ revision: string }>(bl(w, ['recover', '--adoption', '--json']).stdout);
  assert.equal(bl(w, ['recover', '--adoption', '--approve', recovery.revision]).status, 0);
  assert.equal(existsSync(journal), false);
  assert.equal(bl(w, ['remove', '--json']).status, 3, 'after the recovery the removal plans again');
});

// ---- items 5 and 6 ----------------------------------------------------------------------------------------------------------

test('items 5 and 6: removal keeps a taken-over file (JSON kept, human keep) and the human result lists every left-behind folder', t => {
  const w = world(t);
  adopt(w);
  const { result } = install(w);
  const taken = (result as { takenOver: { path: string }[] }).takenOver.map(x => x.path);
  assert.ok(taken.includes('.mcp.json'), `install JSON carries takenOver: ${JSON.stringify(result)}`);
  // A file of the person's in a folder Bowerloom made keeps that folder.
  writeFileSync(join(w.dir, '.codex', 'rules', 'mine.rules'), '# mine\n');
  const planned = bl(w, ['remove']);
  assert.equal(planned.status, 3, planned.stderr);
  assert.match(planned.stdout, /keep {3,}\.mcp\.json/); assert.doesNotMatch(planned.stdout, /restore +\.mcp\.json/);
  const revision = json<{ revision: string }>(bl(w, ['remove', '--json']).stdout).revision;
  const human = bl(w, ['remove', '--approve', revision]);
  assert.equal(human.status, 0, human.stderr + human.stdout);
  assert.match(human.stdout, /^Applied plan [a-f0-9]{64}\./);
  assert.match(human.stdout, /Kept as it is: \.mcp\.json/);
  assert.match(human.stdout, /Left in place: \.codex\/rules \(not-empty\)/);
});

test('item 6: the JSON result of a removal names the kept files', t => {
  const w = world(t);
  adopt(w); install(w);
  const revision = json<{ revision: string }>(bl(w, ['remove', '--json']).stdout).revision;
  const applied = json<{ result: { kept: string[]; restored: string[] } }>(bl(w, ['remove', '--approve', revision, '--json']).stdout);
  assert.ok(applied.result.kept.includes('.mcp.json'), JSON.stringify(applied.result));
  assert.ok(!applied.result.restored.includes('.mcp.json'));
});

test('item 5: resultLines prints one line per left-behind folder, kept path, and left folder, and nothing for a result without them', () => {
  assert.deepEqual(resultLines({ leftBehind: [{ path: 'a', reason: 'not-empty' }], kept: ['b', { path: 'c', reason: 'changed' }], leftFolders: ['d'] }), [
    'Left in place: a (not-empty)', 'Kept as it is: b', 'Kept as it is: c (changed)', 'Left folder: d',
  ]);
  assert.deepEqual(resultLines({ written: ['x'] }), []);
  assert.deepEqual(resultLines(null), []);
  assert.deepEqual(resultLines({ warnings: ['approval drafts not cleared (EACCES); run bowerloom harness status'] }), ['Note: approval drafts not cleared (EACCES); run bowerloom harness status']);
});

// ---- item 7 -----------------------------------------------------------------------------------------------------------------

test('item 7: a draft that cannot be cleared after a good install is a warning in the result, not a failure', t => {
  const w = world(t);
  adopt(w);
  const first = json<{ refused: Refused[] }>(bl(w, ['install', '--json']).stdout);
  for (const line of first.refused) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const revision = json<{ revision: string }>(bl(w, ['install', '--json']).stdout).revision;
  // The record folder cannot be changed: the drafts file cannot be removed, but the portable record can still be written.
  const base = dirsOf(w).base;
  mkdirSync(dirsOf(w).portable, { mode: 0o700 });
  chmodSync(base, 0o500); t.after(() => { try { chmodSync(base, 0o700); } catch { /* removed already */ } });
  const applied = bl(w, ['install', '--approve', revision, '--json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const body = json<{ applied: boolean; result: { warnings?: string[]; receipt: string | null } }>(applied.stdout);
  assert.equal(body.applied, true); assert.ok(body.result.receipt !== null);
  assert.deepEqual(body.result.warnings?.length, 1, applied.stdout);
  assert.match(body.result.warnings![0]!, /^approval drafts not cleared \([A-Z_]+\); run bowerloom harness status$/);
});

// ---- item 10 ----------------------------------------------------------------------------------------------------------------

test('item 10: status reports a damaged approvals.json, modes.json, or moving.json as a problem of its section and still exits 0', t => {
  const w = world(t);
  adopt(w); install(w);
  const dirs = dirsOf(w);
  writeFileSync(dirs.approvals, 'not json\n', { mode: 0o600 });
  writeFileSync(join(dirs.portable, 'modes.json'), 'not json\n', { mode: 0o600 });
  writeFileSync(join(dirs.base, 'moving.json'), 'not json\n', { mode: 0o600 });
  const status = bl(w, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr + status.stdout);
  const body = json<{ problems: { section: string; code: string; file: string }[] }>(status.stdout);
  const by = Object.fromEntries(body.problems.map(p => [p.file, p]));
  for (const file of ['approvals.json', 'modes.json', 'moving.json']) assert.equal(by[file]?.code, 'PORTABLE_STATE_INVALID', `${file}: ${JSON.stringify(body.problems)}`);
  assert.equal(new Set(body.problems.map(p => p.section)).size, body.problems.length, 'one problem per section');
  const human = bl(w, ['status']);
  assert.equal(human.status, 0, human.stderr);
  for (const file of ['approvals.json', 'modes.json', 'moving.json']) assert.match(human.stdout, new RegExp(`Problem: ${file.replace('.', '\\.')} \\(PORTABLE_STATE_INVALID\\)`));
  assert.match(human.stdout, /Move it aside/);
  assert.doesNotMatch(human.stdout, new RegExp(w.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'no absolute path');
});

test('item 10: the words of a damaged record name the file and say to move it aside, not to run recover', () => {
  const words = renderRefusal('PORTABLE_STATE_INVALID', 'A record is damaged. approvals.json.');
  assert.match(words, /file the message names/i); assert.match(words, /move/i); assert.match(words, /aside/i);
  assert.doesNotMatch(words.split('\n')[1]!, /recover/);
});

// ---- item 11 ----------------------------------------------------------------------------------------------------------------

test('item 11: Ctrl-C during an approved install stops it with exit 130, writes nothing, and removes its handlers', async t => {
  const w = world(t);
  adopt(w);
  const first = json<{ refused: Refused[] }>(bl(w, ['install', '--json']).stdout);
  for (const line of first.refused) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const before = { int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') };
  const out: string[] = [];
  // The person says yes in the terminal; the stop request arrives before the write starts.
  const io = { interactive: true, async ask(): Promise<string> { process.emit('SIGINT'); return 'y'; } };
  const code = await runHarnessDefCommand(['harness', 'install'], w.dir, w.home, text => { out.push(text); }, io, { ...w.env });
  assert.equal(code, 130, out.join(''));
  assert.match(out.join(''), /Stopped/);
  assert.equal(existsSync(join(dirsOf(w).portable, 'receipt.json')), false, 'nothing was installed');
  assert.deepEqual({ int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM') }, before, 'the handlers are gone');
  // The same command with no stop request still works.
  const ok = await runHarnessDefCommand(['harness', 'install'], w.dir, w.home, () => {}, { interactive: true, async ask() { return 'y'; } }, { ...w.env });
  assert.equal(ok, 0);
});

test('item 11: the stop request reaches adoption and adoption recovery, which refuse before they write', async t => {
  const w = world(t);
  const planned = json<{ revision: string; plan: { approvalsRequired: string[] } }>(bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, '--json']).stdout);
  const confirms = planned.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const io = { interactive: true, async ask(): Promise<string> { process.emit('SIGTERM'); return 'y'; } };
  const out: string[] = [];
  const code = await runHarnessDefCommand(['harness', 'adopt', ...ENGINES, ...PICK, ...EVERY, ...confirms], w.dir, w.home, text => { out.push(text); }, io, { ...w.env });
  assert.equal(code, 130, out.join(''));
  assert.equal(existsSync(join(w.dir, '.bowerloom')), false, 'nothing was written');
});

// ---- item 12 ----------------------------------------------------------------------------------------------------------------

test('item 12: the install plan prints what runs: each command, URL, and literal environment value, and not a reference', t => {
  const w = world(t);
  adopt(w);
  editJson(join(w.dir, '.bowerloom', 'mcp.json'), v => { v.servers.push({ name: 'extra', transport: 'stdio', command: 'extra-server', args: ['--quiet'], env: { LEVEL: 'debug-level-value', KEY: '${EXTRA_KEY}' } }); });
  const first = bl(w, ['install', '--json']);
  assert.equal(errorCode(first.stderr), 'PORTABLE_FIDELITY', first.stderr);
  const refused = json<{ refused: Refused[] }>(first.stdout).refused;
  for (const line of refused) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const plan = bl(w, ['install']);
  assert.equal(plan.status, 3, plan.stderr);
  assert.match(plan.stdout, /echo check/, 'the hook command');
  assert.match(plan.stdout, /runs: \["extra-server","--quiet"\]/, 'the server command, as its argument list');
  assert.match(plan.stdout, /LEVEL=debug-level-value/, 'a literal value');
  assert.doesNotMatch(plan.stdout, /KEY=/, 'a reference is not a literal');
  assert.doesNotMatch(plan.stdout, /EXTRA_KEY/);
});

test('item 12: the adoption plan prints why each item needs a confirmation beside its --confirm key', t => {
  const w = world(t);
  const human = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY]);
  assert.equal(human.status, 3, human.stderr);
  const plan = json<{ plan: { approvalsRequired: string[]; items: { part: string; id: string; needsApproval: string[] }[] } }>(bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, '--json']).stdout).plan;
  assert.ok(plan.approvalsRequired.length > 0);
  for (const key of plan.approvalsRequired) {
    const item = plan.items.find(i => `${i.part}/${i.id}` === key)!;
    assert.ok(item.needsApproval.length > 0);
    const line = human.stdout.split('\n').find(l => l.includes(`--confirm ${key}`));
    assert.ok(line !== undefined, `${key} is listed`);
    for (const reason of item.needsApproval) assert.ok(human.stdout.includes(reason), `${key}: ${reason}`);
  }
});

// ---- item 13 ----------------------------------------------------------------------------------------------------------------

test('item 13: a printed install plan leaves out stateDir and keeps projectDir, and its revision is the one of the full plan', t => {
  const w = world(t);
  adopt(w);
  const refused = json<{ refused: Refused[] }>(bl(w, ['install', '--json']).stdout).refused;
  for (const line of refused) assert.equal(bl(w, ['accept', line.key]).status, 0);
  const printed = json<{ revision: string; plan: Record<string, unknown> }>(bl(w, ['install', '--json']).stdout);
  assert.equal('stateDir' in printed.plan, false);
  assert.equal(printed.plan.projectDir, w.dir);
  assert.equal(printed.plan.revision, printed.revision);
  assert.doesNotMatch(JSON.stringify(printed), new RegExp(stateRoot(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const dirs = dirsOf(w);
  const drafts = JSON.parse(readFileSync(dirs.approvals, 'utf8')) as { drafts: unknown[] };
  const full = planPortable({
    projectDir: w.dir, definitionFolder: join(w.dir, '.bowerloom'), stateDir: dirs.portable, approvals: drafts.drafts as never, previewEngines: true,
  });
  assert.equal(full.revision, printed.revision, 'the revision is computed over the full plan, as before');
  const human = bl(w, ['status', '--json']);
  assert.equal(json<{ folder: string }>(human.stdout).folder, w.dir, 'the status keeps its folder');
});
