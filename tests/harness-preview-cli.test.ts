// Beta.1 supports Claude Code and Codex. OpenCode, Pi, and DeepSeek Harness are preview engines behind BOWERLOOM_PREVIEW_ENGINES=1.
// Through the real binary: adopt, status, drift, and remove stay open; install to a preview engine is refused before any write.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { errorCode, removeAll, run } from './support/config-cli.js';
import { reportFailure } from '../apps/cli/src/human.js';
import { EnginePreviewRefusal } from '../packages/skill-manifest/src/engine.js';

const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../tests/fixtures/harness-08/project.json', import.meta.url)), 'utf8')) as { files: Record<string, string> };
const ENGINES = ['--engine', 'claude-code@2.1.310', '--engine', 'codex@0.157.0', '--engine', 'opencode@1.18.30'];
const PICK = ['--pick', 'system-prompt/AGENTS.md=AGENTS.md'];
const EVERY = ['--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp'];
const ON = { BOWERLOOM_PREVIEW_ENGINES: '1' };

interface W { base: string; home: string; dir: string; env: Record<string, string> }
function world(t: TestContext): W {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-preview-cli-')));
  t.after(() => removeAll(base));
  const home = join(base, 'home'); mkdirSync(home, { mode: 0o700 });
  const dir = join(home, 'Projects', 'e2e'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, text] of Object.entries(FIXTURE.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text, { mode: 0o644 }); }
  return { base, home, dir, env: { HOME: home, XDG_STATE_HOME: join(base, 'state') } };
}
const bl = (w: W, args: string[], extra: Record<string, string> = {}) => run(w.dir, ['harness', ...args], { ...w.env, ...extra });
const json = <T = Record<string, unknown>>(text: string): T => JSON.parse(text) as T;

/** Every file and folder under a root, with its mode and content hash. */
function snapshot(root: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
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

/** Adopts with the switch OFF: adoption reads every engine and is not gated. */
function adopt(w: W): void {
  const planned = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { approvalsRequired: string[] } }>(planned.stdout);
  const confirms = body.plan.approvalsRequired.flatMap(k => ['--confirm', k]);
  const applied = bl(w, ['adopt', ...ENGINES, ...PICK, ...EVERY, ...confirms, '--approve', body.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
}
interface Plan { engines: { id: string }[]; skippedPreview: string[]; previewNotice: string | null; changes: { path: string; action: string }[] }
/** Accepts every refused line, then returns the plan (exit 3) with the environment given. */
function planInstall(w: W, args: string[], extra: Record<string, string>): { revision: string; plan: Plan; refusedEngines: string[] } {
  const refusedEngines: string[] = [];
  const first = bl(w, ['install', ...args, '--json'], extra);
  if (first.status === 1) {
    assert.equal(errorCode(first.stderr), 'PORTABLE_FIDELITY', first.stderr);
    for (const line of json<{ refused: { key: string; engine: string }[] }>(first.stdout).refused) {
      refusedEngines.push(line.engine);
      const accepted = bl(w, ['accept', line.key, '--json'], extra);
      assert.equal(accepted.status, 0, accepted.stderr + accepted.stdout);
    }
  }
  const planned = bl(w, ['install', ...args, '--json'], extra);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: Plan }>(planned.stdout);
  return { revision: body.revision, plan: body.plan, refusedEngines };
}

test('adopt, status, and drift are not gated: a definition that lists OpenCode adopts and reads with the switch off', t => {
  const w = world(t);
  adopt(w);
  const status = bl(w, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.deepEqual(json<{ definition: { engines: { id: string }[] } }>(status.stdout).definition.engines.map(e => e.id), ['claude-code', 'codex', 'opencode']);
  const drift = bl(w, ['drift', '--json']);
  assert.equal(drift.status, 0, drift.stderr + drift.stdout);
});

test('install --engine <preview engine> is refused with ENGINE_PREVIEW, exit 1, before any write', t => {
  const w = world(t);
  adopt(w);
  const before = snapshot(w.base);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const r = bl(w, ['install', '--engine', engine, '--json']);
    assert.equal(r.status, 1, `${engine}: ${r.stderr}`);
    // pi and deepseek-harness are not listed by this harness, and that refusal comes first.
    assert.equal(errorCode(r.stderr), engine === 'opencode' ? 'ENGINE_PREVIEW' : 'PORTABLE_ENGINE_NOT_LISTED', engine);
    assert.equal(r.stdout, '', 'nothing printed to stdout');
  }
  const mixed = bl(w, ['install', '--engine', 'codex', '--engine', 'opencode', '--approve', '0'.repeat(64)]);
  assert.equal(mixed.status, 1); assert.equal(errorCode(mixed.stderr), 'ENGINE_PREVIEW');
  assert.deepEqual(snapshot(w.base), before, 'the project and the private state are as they were');
  // Any value but the exact text 1 leaves the switch off.
  for (const value of ['true', '0', '', 'yes', '11']) {
    const r = bl(w, ['install', '--engine', 'opencode', '--json'], { BOWERLOOM_PREVIEW_ENGINES: value });
    assert.equal(errorCode(r.stderr), 'ENGINE_PREVIEW', JSON.stringify(value));
  }
});

test('the refusal reads in plain words with a next step', () => {
  const text = reportFailure(new EnginePreviewRefusal('opencode'), true).text;
  assert.match(text, /^Refused \(ENGINE_PREVIEW\): /);
  assert.match(text, /\nOpenCode is a preview engine in this beta\.\n/);
  assert.match(text, /\nNext: Install for claude-code or codex, or set BOWERLOOM_PREVIEW_ENGINES=1 to try it\.\n$/);
  assert.equal(reportFailure(new EnginePreviewRefusal('pi'), true).text.split('\n')[1], 'Pi is a preview engine in this beta.');
  assert.equal(reportFailure(new EnginePreviewRefusal('deepseek-harness'), true).text.split('\n')[1], 'DeepSeek Harness is a preview engine in this beta.');
  assert.equal(reportFailure(new EnginePreviewRefusal('opencode'), true).exitCode, 1);
});

test('install with no --engine installs the supported engines and names the skipped preview engines and the switch', t => {
  const w = world(t);
  adopt(w);
  const off = planInstall(w, [], {});
  assert.deepEqual(off.plan.engines.map(e => e.id), ['claude-code', 'codex']);
  assert.deepEqual(off.plan.skippedPreview, ['opencode']);
  assert.equal(off.plan.previewNotice, 'Preview engines skipped: opencode. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to it.', 'the --json plan names them too');
  assert.ok(!off.refusedEngines.includes('opencode'), 'no refused line for a skipped engine');
  const human = bl(w, ['install']);
  assert.equal(human.status, 3, human.stderr);
  assert.match(human.stdout, /^Install to claude-code 2\.1\.310, codex 0\.157\.0:/);
  assert.match(human.stdout, /Preview engines skipped: opencode\. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to it\./);
  assert.doesNotMatch(human.stdout, /opencode 1\.18\.30/);
});

test('the approval revision covers the engine set: a plan made with the switch off cannot be approved with it on, or the reverse', t => {
  const w = world(t);
  adopt(w);
  const off = planInstall(w, [], {});
  const on = planInstall(w, [], ON);
  assert.deepEqual(on.plan.engines.map(e => e.id), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(on.plan.skippedPreview, []);
  assert.equal(on.plan.previewNotice, null);
  assert.notEqual(off.revision, on.revision);
  const before = snapshot(w.dir, outsideDefinition);
  const wrongOn = bl(w, ['install', '--approve', off.revision], ON);
  assert.equal(wrongOn.status, 1, wrongOn.stderr); assert.equal(errorCode(wrongOn.stderr), 'STALE_APPROVAL');
  const wrongOff = bl(w, ['install', '--approve', on.revision]);
  assert.equal(wrongOff.status, 1, wrongOff.stderr); assert.equal(errorCode(wrongOff.stderr), 'STALE_APPROVAL');
  assert.deepEqual(snapshot(w.dir, outsideDefinition), before, 'nothing was written');
});

test('with the switch on, install plans every listed engine and skips none', t => {
  const w = world(t);
  adopt(w);
  const on = planInstall(w, [], ON);
  assert.ok(on.refusedEngines.includes('opencode'), 'OpenCode lines are checked');
  const named = planInstall(w, ['--engine', 'opencode'], ON);
  assert.deepEqual(named.plan.engines.map(e => e.id), ['opencode']);
  const human = bl(w, ['install'], ON);
  assert.equal(human.status, 3, human.stderr);
  assert.doesNotMatch(human.stdout, /Preview engines skipped/);
});

test('remove stays open: it removes the files a flagged install wrote for a preview engine, with the switch off', t => {
  const w = world(t);
  adopt(w);
  const originals = snapshot(w.dir, outsideDefinition);
  const on = planInstall(w, [], ON);
  const applied = bl(w, ['install', '--approve', on.revision], ON);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const installed = snapshot(w.dir, outsideDefinition);
  const opencodeFiles = Object.keys(installed).filter(rel => !(rel in originals) && /opencode/.test(rel));
  assert.ok(opencodeFiles.length > 0, `the flagged install wrote an OpenCode file: ${Object.keys(installed).filter(rel => !(rel in originals)).join(', ')}`);
  const status = bl(w, ['status', '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.ok(json<{ receipt: { engines: { id: string }[] } }>(status.stdout).receipt.engines.some(e => e.id === 'opencode'));
  assert.equal(bl(w, ['drift', '--check']).status, 0, 'drift reads the receipt with the switch off');
  const removal = bl(w, ['remove', '--json']);
  assert.equal(removal.status, 3, removal.stderr);
  const removed = bl(w, ['remove', '--approve', json<{ revision: string }>(removal.stdout).revision]);
  assert.equal(removed.status, 0, removed.stderr + removed.stdout);
  for (const rel of opencodeFiles) assert.equal(existsSync(join(w.dir, rel)), false, rel);
  assert.deepEqual(snapshot(w.dir, outsideDefinition), originals, 'every file outside .bowerloom is as it was');
});

test('help names the switch', () => {
  const r = run(process.cwd(), ['help', 'harness'], { HOME: process.env.HOME ?? '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BOWERLOOM_PREVIEW_ENGINES=1/);
  assert.match(r.stdout, /OpenCode, Pi, and DeepSeek Harness are preview engines/);
});

// ---- left alone, results, status, accept, and harnesses that list only preview engines ------------------------------------------

const harnessFile = (w: W): string => join(w.dir, '.bowerloom', 'harness.json');
function listEngines(w: W, engines: { id: string; version: string }[]): void {
  const file = harnessFile(w), harness = JSON.parse(readFileSync(file, 'utf8')) as { engines: unknown };
  harness.engines = [...engines].sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(file, `${JSON.stringify(harness, null, 2)}\n`);
}
const VERSIONS: Record<string, string> = { 'claude-code': '2.1.310', codex: '0.157.0', opencode: '1.18.30', pi: '1.4.0', 'deepseek-harness': '0.2.2-alpha.2' };
const listed = (...ids: string[]) => ids.map(id => ({ id, version: VERSIONS[id]! }));

/** Adopts, then installs everything with the switch on. */
function flaggedInstall(w: W): { opencodeFiles: string[]; bytes: Record<string, string> } {
  adopt(w);
  const originals = snapshot(w.dir, outsideDefinition);
  const on = planInstall(w, [], ON);
  assert.equal(bl(w, ['install', '--approve', on.revision], ON).status, 0);
  const installed = snapshot(w.dir, outsideDefinition);
  const opencodeFiles = Object.keys(installed).filter(rel => !(rel in originals) && /opencode/.test(rel));
  assert.ok(opencodeFiles.length > 0);
  return { opencodeFiles, bytes: Object.fromEntries(opencodeFiles.map(rel => [rel, installed[rel]!])) };
}

test('an install with the switch off leaves the OpenCode files of an earlier flagged install as they are, says so, and remove still takes them', t => {
  const w = world(t);
  const { opencodeFiles, bytes } = flaggedInstall(w);
  const off = planInstall(w, [], {});
  assert.deepEqual(off.plan.engines.map(e => e.id), ['claude-code', 'codex']);
  assert.deepEqual((off.plan as unknown as { keptPreview: { id: string }[] }).keptPreview.map(e => e.id), ['opencode']);
  assert.equal(off.plan.previewNotice, 'Preview engines skipped: opencode. Its files from an earlier install are left as they are. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to it.');
  for (const rel of opencodeFiles) assert.ok(!off.plan.changes.some(c => c.path === rel && c.action !== 'unchanged'), `${rel} is not touched`);
  // The result of the approved install names where it installed, and what it skipped and kept (item 3), in JSON and in words.
  const human = bl(w, ['install']);
  assert.equal(human.status, 3, human.stderr);
  assert.match(human.stdout, /Its files from an earlier install are left as they are\./);
  const applied = bl(w, ['install', '--approve', off.revision, '--json']);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  const result = json<{ result: { installed: string[]; skippedPreview: string[]; keptPreview: string[]; previewNotice: string } }>(applied.stdout).result;
  assert.deepEqual(result.installed, ['claude-code', 'codex']);
  assert.deepEqual(result.skippedPreview, ['opencode']);
  assert.deepEqual(result.keptPreview, ['opencode']);
  assert.match(result.previewNotice, /left as they are/);
  const after = snapshot(w.dir, outsideDefinition);
  for (const rel of opencodeFiles) assert.equal(after[rel], bytes[rel], `${rel} is byte for byte the same`);
  const status = json<{ receipt: { engines: { id: string }[] } }>(bl(w, ['status', '--json']).stdout);
  assert.ok(status.receipt.engines.some(e => e.id === 'opencode'), 'the receipt still lists OpenCode');
  assert.equal(bl(w, ['drift', '--check']).status, 0, 'drift with the switch off reports nothing');
  const again = bl(w, ['install', '--json']);
  assert.equal(again.status, 0, 'the next install has nothing to do'); assert.equal(json<{ nothingToDo?: boolean }>(again.stdout).nothingToDo, true);
  // Remove with the switch off still removes them.
  const removal = bl(w, ['remove', '--json']);
  assert.equal(removal.status, 3, removal.stderr);
  assert.equal(bl(w, ['remove', '--approve', json<{ revision: string }>(removal.stdout).revision]).status, 0);
  for (const rel of opencodeFiles) assert.equal(existsSync(join(w.dir, rel)), false, rel);
});

test('a human install result names where it installed and what it left out', t => {
  const w = world(t);
  adopt(w);
  const off = planInstall(w, [], {});
  const done = bl(w, ['install', '--approve', off.revision]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /Installed to: claude-code, codex\./);
  assert.match(done.stdout, /Preview engines skipped: opencode\. Set BOWERLOOM_PREVIEW_ENGINES=1 to install to it\./);
});

test('status says whether preview engines are on, which listed engines this environment will not install to, and which the receipt still holds', t => {
  const w = world(t);
  adopt(w);
  const off = json<{ previewEngines: { on: boolean; notInstalled: string[]; held: string[] } }>(bl(w, ['status', '--json']).stdout);
  assert.deepEqual(off.previewEngines, { on: false, notInstalled: ['opencode'], held: [] });
  assert.match(bl(w, ['status']).stdout, /Preview engines are off \(set BOWERLOOM_PREVIEW_ENGINES=1 to turn them on\)\. Not installed to: opencode\./);
  const on = json<{ previewEngines: { on: boolean; notInstalled: string[]; held: string[] } }>(bl(w, ['status', '--json'], ON).stdout);
  assert.deepEqual(on.previewEngines, { on: true, notInstalled: [], held: [] });
  assert.match(bl(w, ['status'], ON).stdout, /Preview engines are on\./);
  const p = planInstall(w, [], ON);
  assert.equal(bl(w, ['install', '--approve', p.revision], ON).status, 0);
  const held = json<{ previewEngines: { held: string[]; notInstalled: string[] } }>(bl(w, ['status', '--json']).stdout).previewEngines;
  assert.deepEqual(held.held, ['opencode']); assert.deepEqual(held.notInstalled, [], 'a held engine is not also listed as not installed to');
  const words = bl(w, ['status']).stdout;
  assert.match(words, /Installed earlier and left as they are: opencode\./);
  assert.doesNotMatch(words, /Not installed to/);
});

test('accept for a preview engine line is refused with ENGINE_PREVIEW while the switch is off', t => {
  const w = world(t);
  adopt(w);
  const first = bl(w, ['install', '--json'], ON);
  assert.equal(first.status, 1);
  const line = json<{ refused: { key: string; engine: string }[] }>(first.stdout).refused.find(l => l.engine === 'opencode');
  assert.ok(line, 'an OpenCode line is refused with the switch on');
  const accepted = bl(w, ['accept', line!.key, '--json']);
  assert.equal(accepted.status, 1, accepted.stderr + accepted.stdout);
  assert.equal(errorCode(accepted.stderr), 'ENGINE_PREVIEW');
  assert.equal(bl(w, ['accept', line!.key, '--json'], ON).status, 0, 'with the switch on it is accepted');
});

test('a harness that lists only OpenCode is refused with ENGINE_PREVIEW when no engine is named', t => {
  const w = world(t);
  const only = ['--engine', 'opencode@1.18.30'];
  const planned = bl(w, ['adopt', ...only, '--json']);
  assert.equal(planned.status, 3, planned.stderr + planned.stdout);
  const body = json<{ revision: string; plan: { approvalsRequired: string[]; ready: boolean } }>(planned.stdout);
  assert.equal(body.plan.ready, true, 'adopting OpenCode alone needs no answer');
  const done = bl(w, ['adopt', ...only, ...body.plan.approvalsRequired.flatMap(k => ['--confirm', k]), '--approve', body.revision]);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  assert.deepEqual(json<{ definition: { engines: { id: string }[] } }>(bl(w, ['status', '--json']).stdout).definition.engines.map(e => e.id), ['opencode']);
  const before = snapshot(w.base);
  const r = bl(w, ['install', '--json']);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.equal(errorCode(r.stderr), 'ENGINE_PREVIEW', r.stderr);
  assert.match(JSON.parse(r.stderr).error.message as string, /opencode is a preview engine in this beta/);
  assert.deepEqual(snapshot(w.base), before, 'nothing was written');
});

test('a harness that lists Pi and DeepSeek Harness refuses each with ENGINE_PREVIEW, not PORTABLE_ENGINE_NOT_LISTED', t => {
  const w = world(t);
  adopt(w);
  listEngines(w, listed('claude-code', 'codex', 'opencode', 'pi', 'deepseek-harness'));
  assert.equal(bl(w, ['status', '--json']).status, 0);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const r = bl(w, ['install', '--engine', engine, '--json']);
    assert.equal(r.status, 1, `${engine}: ${r.stderr}`);
    assert.equal(errorCode(r.stderr), 'ENGINE_PREVIEW', engine);
    assert.match(JSON.parse(r.stderr).error.message as string, new RegExp(`^${engine} is a preview engine in this beta`));
  }
});
