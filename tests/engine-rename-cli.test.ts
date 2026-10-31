// Step 0 of Bowerloom 0.8, run as a person or an agent runs it: the engine rename at the command line.
// Old skills.json and bowerloom.json files read and stay byte for byte unchanged; a file the CLI creates uses the new
// names; an engine with no writer is refused with a typed refusal.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestContext } from 'node:test';

const cli = fileURLToPath(new URL('../apps/cli/src/main.js', import.meta.url));
const preload = pathToFileURL(fileURLToPath(new URL('./support/fake-network.js', import.meta.url))).href;

function folder(t: TestContext) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-engine-cli-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function run(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, ['--import', preload, cli, ...args], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, ...env } });
  assert.equal(r.error, undefined); return r;
}
/** A project made by the real init, with the network denied. */
function project(t: TestContext) {
  const home = folder(t), dir = join(home, 'studio'); mkdirSync(dir);
  const log = join(home, 'network.log'), plan = join(home, 'network.json'); writeFileSync(plan, JSON.stringify({ log })); writeFileSync(log, '');
  const env = { HOME: home, XDG_STATE_HOME: join(home, 'state'), TEST_FAKE_NETWORK_PLAN: plan };
  const args = ['--mode', 'existing', '--target', dir, '--name', 'Studio handbook', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  const planned = run(home, ['init', 'plan', ...args, '--json'], env); assert.equal(planned.status, 0, planned.stderr);
  const applied = run(home, ['init', 'apply', ...args, '--approve', JSON.parse(planned.stdout).revision], env); assert.equal(applied.status, 0, applied.stderr);
  return { home, dir, env, manifest: join(dir, '.bowerloom', 'skills.json') };
}
const LOCAL = [{ id: 'house-style', source: { kind: 'local', path: 'skills/house-style' } }];
const OLD = `${JSON.stringify({ format: 'bowerloom/skills/v1beta1', harnesses: ['claude', 'codex'], skills: LOCAL }, null, 2)}\n`;
const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: { code: string; message: string } }).error;

test('skills check reads an old skills.json, reports engines, and leaves the file byte for byte unchanged', t => {
  const p = project(t); writeFileSync(p.manifest, OLD, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const before = readFileSync(p.manifest), stat = statSync(p.manifest);
  const json = run(p.dir, ['skills', 'check', '--json'], p.env); assert.equal(json.status, 0, json.stderr);
  const check = JSON.parse(json.stdout) as { engines: string[]; harnesses?: unknown };
  assert.deepEqual(check.engines, ['claude-code', 'codex']); assert.equal(check.harnesses, undefined);
  const words = run(p.dir, ['skills', 'check'], p.env); assert.equal(words.status, 0, words.stderr); assert.match(words.stdout, /for Claude Code and Codex/);
  assert.deepEqual(readFileSync(p.manifest), before); assert.equal(statSync(p.manifest).mtimeMs, stat.mtimeMs);
});

test('apply names its engines with the new ids, takes the old id claude, and leaves an old skills.json unchanged', t => {
  const p = project(t); writeFileSync(p.manifest, OLD, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const before = readFileSync(p.manifest);
  for (const flag of ['claude-code', 'claude']) {
    const plan = run(p.dir, ['apply', '--harness', flag, '--json'], p.env); assert.equal(plan.status, 0, plan.stdout + plan.stderr);
    const out = JSON.parse(plan.stdout) as { plan: { engines: string[]; harnesses?: unknown } };
    assert.deepEqual(out.plan.engines, ['claude-code'], flag); assert.equal(out.plan.harnesses, undefined);
  }
  assert.deepEqual(readFileSync(p.manifest), before);
});

test('apply refuses an engine with no writer, by name, before it reads the project', t => {
  const p = project(t);
  for (const engine of ['opencode', 'pi', 'deepseek-harness']) {
    const r = run(p.dir, ['apply', '--harness', engine, '--json'], p.env);
    assert.notEqual(r.status, 0, engine); assert.equal(r.stdout, '');
    assert.deepEqual(errorOf(r.stderr), { code: 'ENGINE_NO_WRITER', message: `no writer for engine ${engine} yet` }, engine);
  }
  const unknown = run(p.dir, ['apply', '--harness', 'hermes'], p.env); assert.notEqual(unknown.status, 0); assert.equal(errorOf(unknown.stderr).code, 'USAGE');
});

test('skills sync refuses a skills.json that names an engine with no writer, and leaves the file unchanged', t => {
  const p = project(t); writeFileSync(p.manifest, `${JSON.stringify({ format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'pi'], skills: LOCAL }, null, 2)}\n`, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const before = readFileSync(p.manifest);
  for (const args of [['skills', 'sync', '--json']]) {
    const r = run(p.dir, args, p.env);
    assert.notEqual(r.status, 0, args.join(' ')); assert.deepEqual(errorOf(r.stderr), { code: 'ENGINE_NO_WRITER', message: 'no writer for engine pi yet' }, args.join(' '));
  }
  assert.deepEqual(readFileSync(p.manifest), before);
});

// ---- Review of e1bbce9: L1, H1, M2, CR4 and the status line.
import { discoverProject } from '../packages/project-context/src/index.js';
import { EngineWriterRefusal } from '../packages/skill-manifest/src/engine.js';
import { copyPlaces } from '../apps/cli/src/use.js';
import { renderRefusal, reportFailure } from '../apps/cli/src/human.js';

const PI = `${JSON.stringify({ format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'pi'], skills: LOCAL }, null, 2)}\n`;

test('H1. apply with no --harness refuses a skills.json that names an engine with no writer', t => {
  const p = project(t); writeFileSync(p.manifest, PI, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const before = readFileSync(p.manifest);
  for (const args of [['apply', '--json'], ['apply', '--harness', 'codex', '--json']]) {
    const r = run(p.dir, args, p.env);
    assert.notEqual(r.status, 0, args.join(' ')); assert.deepEqual(errorOf(r.stderr), { code: 'ENGINE_NO_WRITER', message: 'no writer for engine pi yet' }, args.join(' '));
  }
  assert.deepEqual(readFileSync(p.manifest), before);
});

test('H1. status names the refusal in the plan line and does not call the project ready', t => {
  const p = project(t); writeFileSync(p.manifest, PI, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const words = run(p.dir, ['status'], p.env); assert.equal(words.status, 0, words.stderr);
  assert.match(words.stdout, /plan unavailable \(ENGINE_NO_WRITER: pi\)/); assert.match(words.stdout, /Setup: drifted/);
});

test('H1. up --team refuses by name before any step, so no step is applied and then refused', t => {
  const p = project(t), up = ['up', '--team', 'studio-crew', '--goal', 'Prepare a fictional onboarding kit for an independent design studio.'];
  writeFileSync(p.manifest, PI, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const listing = () => JSON.stringify(readdirSync(p.dir, { recursive: true }).map(String).sort()), before = listing();
  const r = run(p.dir, up, p.env);
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.deepEqual(errorOf(r.stderr), { code: 'ENGINE_NO_WRITER', message: 'no writer for engine pi yet' });
  assert.equal(listing(), before, 'no step was applied');
  assert.deepEqual(readFileSync(p.manifest, 'utf8'), PI);
});

test('M2. a catalog that names an engine it cannot is refused by file; a catalog that is not JSON gives the default places', t => {
  const p = project(t), catalog = join(p.dir, '.bowerloom', 'managed', 'catalog', 'house-style.json');
  mkdirSync(join(p.dir, '.bowerloom', 'managed', 'catalog'), { recursive: true });
  const ctx = discoverProject(p.dir, p.home);
  writeFileSync(catalog, JSON.stringify({ skill: { name: 'house-style' }, harnesses: ['hermes'] }));
  assert.throws(() => copyPlaces(ctx, 'skill', 'house-style'), (e: { code?: string; message: string }) => e.code === 'MANAGED_SKILL_REFUSED' && e.message.includes('.bowerloom/managed/catalog/house-style.json') && e.message.includes('"hermes"'));
  writeFileSync(catalog, '{not json');
  assert.ok(copyPlaces(ctx, 'skill', 'house-style').length > 0, 'the default places');
  writeFileSync(catalog, JSON.stringify({ skill: { name: 'house-style' }, harnesses: ['claude'] }));
  assert.deepEqual(copyPlaces(ctx, 'skill', 'house-style'), ['.bowerloom/managed/skills/house-style', '.claude/skills/house-style']);
});

test('CR4. the words of the refusal name the engine', () => {
  const error = new EngineWriterRefusal('pi');
  const words = renderRefusal(error.code, error.message, { engine: 'pi' }).split('\n');
  assert.match(words[1]!, /\bpi\b/, words.join(' | '));
  const shown = reportFailure(error, true).text.split('\n'); assert.match(shown[1]!, /\bpi\b/); assert.match(shown[0]!, /ENGINE_NO_WRITER/);
  assert.doesNotMatch(renderRefusal(error.code, error.message, { engine: 'x\u001b[31m' as never }), /\u001b/);
});

// ---- Last round: M2 (read errors), bowerloom.json detail, context commands.
test('M2. a catalog that cannot be read (not a syntax error) is refused by file, not left to escape uncoded', t => {
  const p = project(t), catalog = join(p.dir, '.bowerloom', 'managed', 'catalog', 'house-style.json');
  mkdirSync(catalog, { recursive: true });
  const ctx = discoverProject(p.dir, p.home);
  assert.throws(() => copyPlaces(ctx, 'skill', 'house-style'), (e: { code?: string; message: string }) => e.code === 'MANAGED_SKILL_REFUSED' && e.message.includes('.bowerloom/managed/catalog/house-style.json') && /EISDIR/.test(e.message));
});

test('bowerloom.json with a bad engine id: the refusal names the id, in the JSON and the words', t => {
  const p = project(t);
  writeFileSync(join(p.dir, 'bowerloom.json'), `${JSON.stringify({ format: 'bowerloom/project/v1beta1', harnesses: ['pi'], skills: [], prompts: [], teams: [] }, null, 2)}\n`, { mode: 0o644 });
  const r = run(p.dir, ['skills', 'check', '--json'], p.env);
  assert.notEqual(r.status, 0); const e = errorOf(r.stderr);
  assert.equal(e.code, 'CONFIG_INVALID'); assert.match(e.message, /"pi"/);
  // Without a terminal the refusal is the JSON envelope, which escapes the quotes; with one, renderRefusal prints the same message.
  const plain = run(p.dir, ['skills', 'check'], p.env); assert.ok(plain.stderr.includes('names \\"pi\\"'), plain.stderr);
  assert.match(renderRefusal(e.code, e.message), /names "pi"/);
});

test('item 4. context measure and context show run when a file lists an engine with no writer, and say so in one note on stderr', t => {
  const p = project(t); writeFileSync(p.manifest, PI, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const measure = run(p.dir, ['context', 'measure', '--json'], p.env);
  assert.equal(measure.status, 0, measure.stderr); assert.doesNotThrow(() => JSON.parse(measure.stdout));
  const notes = measure.stderr.split('\n').filter(l => l.startsWith('Note:'));
  assert.equal(notes.length, 1); assert.match(notes[0]!, /\bpi\b/); assert.match(notes[0]!, /no writer/);
  const show = run(p.dir, ['context', 'show', 'nope', '--json'], p.env);
  assert.notEqual(show.status, 0); assert.doesNotMatch(show.stderr, /ENGINE_NO_WRITER/); assert.match(show.stderr, /Note: .*\bpi\b/);
  const explain = run(p.dir, ['context', 'guard', '--agent', 'nobody', '--explain', 'x.md'], p.env);
  assert.doesNotMatch(explain.stderr + explain.stdout, /ENGINE_NO_WRITER/); assert.match(explain.stderr + explain.stdout, /Note: .*\bpi\b/);
});

test('item 4. a file with two engines that have no writer gets one note for each', t => {
  const p = project(t); writeFileSync(p.manifest, `${JSON.stringify({ format: 'bowerloom/skills/v1beta1', engines: ['claude-code', 'opencode', 'pi'], skills: LOCAL }, null, 2)}\n`, { mode: 0o644 }); chmodSync(p.manifest, 0o644);
  const measure = run(p.dir, ['context', 'measure', '--json'], p.env);
  assert.equal(measure.status, 0, measure.stderr);
  const notes = measure.stderr.split('\n').filter(l => l.startsWith('Note:'));
  assert.equal(notes.length, 2); assert.match(notes[0]!, /opencode/); assert.match(notes[1]!, /\bpi\b/);
});
