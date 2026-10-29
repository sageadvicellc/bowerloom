// Step 5, lane F: the app and the command line work on one folder, with one record (decision 7B; blueprint section F, item 1, point 2).
// The main process is tested directly: `createEngineService` with a "yes" for every dialog, beside the in-process `runHarnessDefCommand`.
// The folder is a synthetic copy of tests/fixtures/harness-08/project.json. Every test has its own HOME and XDG_STATE_HOME under a
// temporary folder, no engine runs, and no answer of the service holds an absolute path of the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyAdoption, planAdoption } from '../../../packages/adoption/src/index.js';
import { applyPortable, harnessStateDirs, planPortable } from '../../../packages/project-sync/src/index.js';
import { runHarnessDefCommand } from '../../cli/src/harness-def.js';
import { createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import type { AdoptChoices, AdoptView, Answer, FolderInfo, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { DESKTOP } from './support.js';

const FIXTURE = JSON.parse(readFileSync(join(DESKTOP, '..', '..', 'tests', 'fixtures', 'harness-08', 'project.json'), 'utf8')) as { files: Record<string, string> };
const WHEN = new Date('2026-10-28T12:00:00Z');
const EVERY: NonNullable<AdoptChoices['everyEngine']> = ['guardrails', 'hooks', 'mcp'];
const PICK = { 'system-prompt/AGENTS.md': 'AGENTS.md' };

// A stray read of the real home or state folder would be a bug: the whole file runs against temporary ones.
const GUARD = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-cross-guard-')));
process.env.HOME = join(GUARD, 'home'); process.env.XDG_STATE_HOME = join(GUARD, 'state');
mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
process.on('exit', () => rmSync(GUARD, { recursive: true, force: true }));

interface W { base: string; home: string; dir: string; stateHome: string; stateRoot: string; env: NodeJS.ProcessEnv }
function world(t: test.TestContext): W {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-cross-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const dir = join(home, 'Projects', 'e2e'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, text] of Object.entries(FIXTURE.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
  const stateHome = join(base, 'state');
  return { base, home, dir, stateHome, stateRoot: join(stateHome, 'bowerloom'), env: { HOME: home, XDG_STATE_HOME: stateHome } };
}
const serviceOf = (w: W): EngineService => createEngineService({ home: w.home, stateRoot: w.stateRoot, chooseFolder: async () => w.dir, confirm: async () => true, who: 'tester', now: () => WHEN });
const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
/** No answer of the service may hold the folder, the home folder, or the state folder as an absolute path. */
const noPaths = (w: W, answer: unknown, what: string): void => {
  const text = JSON.stringify(answer);
  for (const p of [w.dir, w.home, w.base, w.stateHome]) assert.equal(text.includes(p), false, `${what} holds an absolute path`);
};

interface Run { code: number; out: string; error: { code: string } | null; json: Record<string, unknown> }
/** The command line in this process, on the folder of the world, without a terminal: a plan exits 3, a refusal throws. */
async function cli(w: W, args: string[]): Promise<Run> {
  let out = '';
  const io = { interactive: false, ask: async (): Promise<string> => assert.fail('the command line asked a question') };
  try {
    const code = await runHarnessDefCommand(['harness', ...args], w.dir, w.home, text => { out += text; }, io, w.env);
    return { code, out, error: null, json: args.includes('--json') && out.trim().startsWith('{') ? JSON.parse(out) as Record<string, unknown> : {} };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    assert.equal(typeof code, 'string', `a refusal with a code: ${String(error)}`);
    return { code: code === 'USAGE' ? 2 : 1, out, error: { code: code as string }, json: args.includes('--json') && out.trim().startsWith('{') ? JSON.parse(out) as Record<string, unknown> : {} };
  }
}

/** Every file and folder under a root, with its mode and the hash of its bytes. */
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

/** The app adopts: every part for every engine, the one conflict picked, each acknowledgement and approval the plan asks for. */
async function adoptInApp(w: W, service: EngineService, folder: FolderInfo): Promise<AdoptView> {
  const first = value(await service.planAdoption(folder.id, { picks: PICK, acknowledged: [], everyEngine: EVERY }));
  const choices: AdoptChoices = { picks: PICK, acknowledged: first.unmapped.filter(u => u.gate === 'acknowledge').map(u => ({ id: u.id, hash: u.hash })), everyEngine: EVERY };
  const view = value(await service.planAdoption(folder.id, choices));
  assert.equal(view.ready, true);
  noPaths(w, view, 'the adoption plan');
  const done = value(await service.runAdoption(folder.id, view.revision, choices, view.approvals.map(a => ({ key: a.key, hash: a.hash }))));
  noPaths(w, done, 'the adoption result');
  assert.ok(done.written.includes('.bowerloom/harness.json'));
  return view;
}

/** The command line installs: it refuses with fidelity lines, accepts each, plans (exit 3), then applies. */
async function installInCli(w: W): Promise<{ refused: { key: string; engine: string; part: string }[]; changes: { path: string; action: string }[] }> {
  const first = await cli(w, ['install', '--json']);
  assert.equal(first.code, 1, first.out); assert.equal(first.error?.code, 'PORTABLE_FIDELITY');
  const refused = first.json.refused as { key: string; engine: string; part: string }[];
  assert.ok(refused.length > 0);
  for (const line of refused) assert.equal((await cli(w, ['accept', line.key])).code, 0);
  const planned = await cli(w, ['install', '--json']);
  assert.equal(planned.code, 3, planned.out);
  const applied = await cli(w, ['install', '--approve', planned.json.revision as string, '--json']);
  assert.equal(applied.code, 0, applied.out);
  return { refused, changes: (planned.json.plan as { changes: { path: string; action: string }[] }).changes };
}

test('the app adopts, the command line installs, the app sees the folder installed and removes it, and the command line sees nothing left', async t => {
  const w = world(t);
  const originals = snapshot(w.dir, outsideDefinition);
  const service = serviceOf(w);
  const folder = value(await service.chooseFolder());
  noPaths(w, folder, 'the folder row');
  assert.equal(folder.hasDefinition, false); assert.equal(folder.projected, false);

  const view = await adoptInApp(w, service, folder);
  assert.deepEqual(snapshot(w.dir, outsideDefinition), originals, 'adoption writes only .bowerloom');
  assert.deepEqual(view.everyEngine.map(e => [e.part, e.chosen]), [['guardrails', true], ['hooks', true], ['mcp', true]]);
  const row = (await service.folders())[0]!;
  assert.equal(row.hasDefinition, true); assert.equal(row.projected, false);
  assert.ok(row.engines.includes('claude-code') && row.engines.includes('codex'), 'adoption listed the engines whose files it read');

  // The command line reads the app's record: the same folder, one state.
  const before = await cli(w, ['status', '--json']);
  assert.equal(before.code, 0, before.out);
  assert.equal((before.json.definition as { present: boolean }).present, true); assert.equal(before.json.projected, false);
  assert.equal(before.json.legacy, 'none');

  // The widened guardrail and hook reach Codex without a hand edit, so the command line refuses them as weakened lines first.
  const { refused, changes } = await installInCli(w);
  assert.ok(refused.some(l => l.engine === 'codex' && l.part === 'hooks') && refused.some(l => l.engine === 'codex' && l.part === 'guardrails'), refused.map(l => l.key).join(' '));
  for (const rel of ['.codex/hooks.json', '.codex/rules/bowerloom.rules']) assert.ok(existsSync(join(w.dir, rel)), rel);
  assert.ok(changes.some(c => c.path === '.mcp.json' && c.action === 'take-over'), 'the Claude Code server file equals what install would write, so it is taken over');
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.match(readFileSync(join(w.dir, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.local-notes\]/, 'the unmanaged Codex server survives');

  // The app sees the install, and offers no approval line: the command line recorded them.
  const after = (await service.folders())[0]!;
  noPaths(w, after, 'the folder row');
  assert.equal(after.projected, true); assert.deepEqual(after.unfinished, { projection: false, adoption: false });
  const input: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
  const again = value(await service.planProjection(folder.id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>;
  assert.equal(again.kind, 'plan');
  assert.equal(again.plan.noop, true, 'the app finds nothing to change after the command line installed');
  noPaths(w, again, 'the install plan');

  // The app removes what the command line installed.
  const removal = value(await service.planRemoval(folder.id));
  noPaths(w, removal, 'the removal plan');
  const removed = value(await service.runRemoval(folder.id, removal.revision));
  noPaths(w, removed, 'the removal result');
  assert.equal((await service.folders())[0]!.projected, false);
  assert.deepEqual(snapshot(w.dir, outsideDefinition), originals, 'every original is back byte for byte');

  // The command line sees nothing installed, and nothing waiting.
  const status = await cli(w, ['status', '--json']);
  assert.equal(status.code, 0, status.out);
  assert.equal(status.json.projected, false); assert.equal(status.json.drafts, 0); assert.equal(status.json.receipt, null);
  assert.deepEqual(status.json.unfinished, { projection: false, adoption: false, merge: false });
  const gone = await cli(w, ['remove', '--json']);
  assert.equal(gone.code, 1); assert.equal(gone.error?.code, 'PORTABLE_NOTHING_PROJECTED');
  const drift = await cli(w, ['drift', '--json']);
  assert.equal(drift.code, 0, drift.out); assert.deepEqual(drift.json.drift, [], 'nothing installed is nothing that drifted'); assert.equal(drift.json.projected, false);
  const checked = await cli(w, ['drift', '--check', '--json']);
  assert.equal(checked.code, 1); assert.equal(checked.error?.code, 'PORTABLE_NOTHING_PROJECTED', 'a check of nothing does not pass');
});

test('the command line adopts and installs, the app reads that record, finds nothing to change, and removes it', async t => {
  const w = world(t);
  const originals = snapshot(w.dir, outsideDefinition);
  const planned = await cli(w, ['adopt', '--engine', 'claude-code@2.1.310', '--engine', 'codex@0.157.0', '--pick', 'system-prompt/AGENTS.md=AGENTS.md', ...EVERY.flatMap(p => ['--every-engine', p]), '--json']);
  assert.equal(planned.code, 3, planned.out);
  const plan = planned.json.plan as { approvalsRequired: string[] };
  const applied = await cli(w, ['adopt', '--engine', 'claude-code@2.1.310', '--engine', 'codex@0.157.0', '--pick', 'system-prompt/AGENTS.md=AGENTS.md', ...EVERY.flatMap(p => ['--every-engine', p]), ...plan.approvalsRequired.flatMap(k => ['--confirm', k]), '--approve', planned.json.revision as string]);
  assert.equal(applied.code, 0, applied.out);
  await installInCli(w);
  const service = serviceOf(w);
  const folder = value(await service.chooseFolder());
  assert.equal(folder.projected, true, 'the app reads the record the command line wrote');
  assert.deepEqual(folder.engines.slice().sort(), ['claude-code', 'codex']);
  noPaths(w, folder, 'the folder row');
  const input: ProjectInput = { engines: ['claude-code', 'codex'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };
  const again = value(await service.planProjection(folder.id, input)) as Extract<ProjectAnswer, { kind: 'plan' }>;
  assert.equal(again.kind, 'plan'); assert.equal(again.plan.noop, true, 'the lines accepted at the command line are not asked again');
  const removal = value(await service.planRemoval(folder.id));
  value(await service.runRemoval(folder.id, removal.revision));
  assert.deepEqual(snapshot(w.dir, outsideDefinition), originals);
  assert.equal((await cli(w, ['status', '--json'])).json.projected, false);
});

test('the record of the earlier app: seeded at the old path, moved when the app starts on the folder, and removed from the command line', async t => {
  const w = world(t);
  const dirs = harnessStateDirs(w.stateRoot, w.dir);
  // The earlier app kept its record at <state>/desktop/<sha256(folder), 32 hex>/{adoption,portable}.
  mkdirSync(dirs.legacy, { recursive: true, mode: 0o700 });
  for (const p of [w.stateHome, w.stateRoot, dirname(dirs.legacy)]) chmodSync(p, 0o700);
  const input = { projectDir: w.dir, stateDir: join(dirs.legacy, 'adoption'), engines: [{ id: 'claude-code' as const, version: '2.1.310' }] };
  const plan = planAdoption(input);
  await applyAdoption(input, plan.revision, plan.approvalsRequired);
  const io = { projectDir: w.dir, definitionFolder: join(w.dir, '.bowerloom'), stateDir: join(dirs.legacy, 'portable') };
  await applyPortable(io, planPortable(io).revision);
  assert.ok(existsSync(join(dirs.legacy, 'portable', 'receipt.json')), 'the earlier app left a receipt at the old path');
  const files = snapshot(w.dir);

  const service = serviceOf(w);
  const folder = value(await service.chooseFolder());
  noPaths(w, folder, 'the folder row');
  assert.equal(folder.projected, true, 'the app finds the moved record');
  assert.equal(existsSync(dirs.legacy), false, 'the old folder is gone');
  assert.ok(existsSync(join(dirs.base, 'moved.json')));
  assert.ok(existsSync(join(dirs.portable, 'receipt.json')));
  assert.deepEqual(snapshot(w.dir), files, 'the move touches no project file');

  const status = await cli(w, ['status', '--json']);
  assert.equal(status.code, 0, status.out);
  assert.equal(status.json.projected, true); assert.equal(status.json.legacy, 'none', 'the app moved it, so the command line moves nothing');
  const removal = await cli(w, ['remove', '--json']);
  assert.equal(removal.code, 3, removal.out);
  const removed = await cli(w, ['remove', '--approve', removal.json.revision as string]);
  assert.equal(removed.code, 0, removed.out);
  assert.equal(readFileSync(join(w.dir, 'CLAUDE.md'), 'utf8'), FIXTURE.files['CLAUDE.md']);
  assert.equal((await service.folders())[0]!.projected, false, 'the app sees the removal');
  assert.equal(JSON.stringify(await service.folders()).includes(w.base), false);
});

test('the earlier record and a shared one together are a plain refusal in the app and in the command line, and nothing moves', async t => {
  const w = world(t);
  const dirs = harnessStateDirs(w.stateRoot, w.dir);
  mkdirSync(dirs.legacy, { recursive: true, mode: 0o700 });
  mkdirSync(dirs.base, { recursive: true, mode: 0o700 });
  for (const p of [w.stateHome, w.stateRoot, dirname(dirs.legacy), dirname(dirs.base)]) chmodSync(p, 0o700);
  const before = snapshot(w.stateHome);
  const answer = await serviceOf(w).chooseFolder();
  assert.ok(answer !== null && !answer.ok);
  assert.equal(answer.refusal.code, 'HARNESS_STATE_TWO_RECORDS');
  noPaths(w, answer, 'the refusal');
  const run = await cli(w, ['status', '--json']);
  assert.equal(run.code, 1); assert.equal(run.error?.code, 'HARNESS_STATE_TWO_RECORDS');
  assert.deepEqual(snapshot(w.stateHome), before, 'neither side moved or wrote anything');
});
