// `bowerloom events`: the local usage log, its weekly summary, and the scenario events that commands record.
import './support/isolate-home.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, world } from './support/config-cli.js';
import type { World } from './support/config-cli.js';
import { envFor, revisionIn, run as runSlice, sliceProject } from './support/slice-project.js';

interface Event { v: number; at: string; source: string; kind: string; scenario?: string; outcome?: string; code?: string; step?: string; engines?: string[]; plan?: string; target?: string }
const envOf = (w: World, extra: Record<string, string> = {}): Record<string, string> => ({ ...w.env, XDG_STATE_HOME: '', BOWERLOOM_EVENT_LOG: '', ...extra });
const logFile = (w: World): string => join(w.home, '.local', 'state', 'bowerloom', 'events', 'events.jsonl');
const events = (w: World): Event[] => (existsSync(logFile(w)) ? readFileSync(logFile(w), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Event) : []);
const json = <T>(text: string): T => JSON.parse(text) as T;

test('events with no log says so and names the log with ~', t => {
  const w = world(t), r = run(w.work, ['events'], envOf(w));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /No events yet\./);
  assert.match(r.stdout, /^Log: ~\/\.local\/state\/bowerloom\/events\/events\.jsonl$/m);
  assert.equal(r.stdout.includes(w.home), false);
});

test('a failing command records an error event with its code and a known first word as the step', t => {
  const w = world(t), env = envOf(w);
  assert.equal(run(w.work, ['skills', 'bogus'], env).status !== 0, true);
  assert.equal(run(w.work, ['Test-Person-Typo'], env).status, 2);
  const [first, second] = events(w);
  assert.equal(first!.kind, 'error'); assert.equal(first!.source, 'cli'); assert.equal(first!.step, 'skills');
  assert.match(first!.code!, /^[A-Z][A-Z0-9_]{2,63}$/);
  assert.equal(second!.code, 'USAGE'); assert.equal('step' in second!, false, 'a word that is not a command is never recorded');
  assert.equal(lstatSync(logFile(w)).mode & 0o777, 0o600);
  assert.equal(readFileSync(logFile(w), 'utf8').includes('Typo'), false);
});

test('BOWERLOOM_EVENT_LOG=off writes nothing and the command keeps its exit code', t => {
  const w = world(t);
  assert.equal(run(w.work, ['Test-Person-Typo'], envOf(w, { BOWERLOOM_EVENT_LOG: 'off' })).status, 2);
  assert.equal(existsSync(dirname(logFile(w))), false);
});

test('a log that cannot be written prints one stderr line and changes neither the output nor the exit code', t => {
  const w = world(t);
  // The state folder is a file, so no folder can be made in it.
  mkdirSync(join(w.home, '.local'), { recursive: true }); writeFileSync(join(w.home, '.local', 'state'), 'x');
  const r = run(w.work, ['Test-Person-Typo'], envOf(w));
  assert.equal(r.status, 2);
  assert.equal(r.stderr.split('\n').filter(l => l.startsWith('Bowerloom could not write its local event log: ')).length, 1);
  assert.match(r.stderr, /USAGE/, 'the real failure is still reported');
});

test('events lists the newest events without targets or notes; --json gives the same events', t => {
  const w = world(t), env = envOf(w);
  mkdirSync(dirname(logFile(w)), { recursive: true, mode: 0o700 });
  const lines = Array.from({ length: 60 }, (_, i) => JSON.stringify({ v: 1, at: `2026-10-30T10:${String(i).padStart(2, '0')}:00Z`, source: 'cli', kind: i === 59 ? 'check' : 'error', code: 'LINE_NUMBER', ...(i === 59 ? { answer: 'no', note: 'private words', target: 'a'.repeat(16) } : {}) }));
  writeFileSync(logFile(w), `${lines.join('\n')}\nnot json\n`, { mode: 0o600 });
  const r = run(w.work, ['events'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter(l => l.startsWith('  2026-')).length, 50);
  assert.match(r.stdout, /10:59:00Z cli check LINE_NUMBER no/);
  assert.doesNotMatch(r.stdout, /private words|aaaaaaaa/);
  assert.match(r.stdout, /1 line could not be read\./);
  const j = json<{ events: Event[]; malformed: number }>(run(w.work, ['events', '--json'], env).stdout);
  assert.equal(j.events.length, 50); assert.equal(j.malformed, 1);
  assert.doesNotMatch(JSON.stringify(j), /private words|aaaaaaaa/);
});

test('events summary prints counts, hides notes unless asked, and --out refuses an existing file and writes mode 0600', t => {
  const w = world(t), env = envOf(w), now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  mkdirSync(dirname(logFile(w)), { recursive: true, mode: 0o700 });
  const rows = [
    { kind: 'scenario', scenario: 'S1', outcome: 'done', step: 'adopt' }, { kind: 'scenario', scenario: 'S5', outcome: 'refused', code: 'PORTABLE_DRIFT' },
    { kind: 'error', code: 'USAGE' }, { kind: 'check', answer: 'partly', note: 'wanted a shared setup' },
  ].map(r => JSON.stringify({ v: 1, at: now, source: 'cli', ...r }));
  writeFileSync(logFile(w), `${rows.join('\n')}\n`, { mode: 0o600 });
  const plain = json<{ schema: string; scenarios: Record<string, { done: number; refused: number }>; notes?: string[]; checks: { partly: number } }>(run(w.work, ['events', 'summary', '--json'], env).stdout);
  assert.equal(plain.schema, 'bowerloom/usage-summary/v1'); assert.deepEqual(plain.scenarios.S1, { done: 1, refused: 0 }); assert.equal(plain.checks.partly, 1);
  assert.equal('notes' in plain, false);
  const human = run(w.work, ['events', 'summary'], env);
  assert.equal(human.status, 0, human.stderr); assert.match(human.stdout, /S1 .*1 done/); assert.doesNotMatch(human.stdout, /shared setup/);
  const withNotes = json<{ notes: string[] }>(run(w.work, ['events', 'summary', '--with-notes', '--json'], env).stdout);
  assert.deepEqual(withNotes.notes, ['wanted a shared setup']);
  const out = join(w.work, 'summary.json');
  const saved = run(w.work, ['events', 'summary', '--out', out], env);
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(lstatSync(out).mode & 0o777, 0o600);
  assert.equal(json<{ schema: string }>(readFileSync(out, 'utf8')).schema, 'bowerloom/usage-summary/v1');
  const again = run(w.work, ['events', 'summary', '--out', out], env);
  assert.equal(again.status, 1); assert.match(again.stderr, /TARGET_EXISTS/);
  assert.equal(run(w.work, ['events', 'summary', '--out', 'relative.json'], env).status, 2);
});

// ---- scenario events from the harness commands ----
const FIXTURE = JSON.parse(readFileSync(fileURLToPath(new URL('../../tests/fixtures/harness-08/project.json', import.meta.url)), 'utf8')) as { files: Record<string, string> };
const ADOPT = ['adopt', '--engine', 'claude-code@2.1.310', '--engine', 'codex@0.157.0', '--pick', 'system-prompt/AGENTS.md=AGENTS.md', '--every-engine', 'guardrails', '--every-engine', 'hooks', '--every-engine', 'mcp'];

function project(w: World): string {
  const dir = join(w.home, 'Projects', 'e2e'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [rel, text] of Object.entries(FIXTURE.files)) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); }
  return dir;
}

test('harness commands record S1, a refused install, S2 with both engines, and S5, and never put a path in the log', t => {
  const w = world(t), env = envOf(w), dir = project(w), bl = (args: string[]) => run(dir, ['harness', ...args], env);
  const planned = bl([...ADOPT, '--json']); assert.equal(planned.status, 3, planned.stderr);
  const body = json<{ revision: string; plan: { approvalsRequired: string[] } }>(planned.stdout);
  assert.equal(events(w).length, 0, 'a plan that waits for approval records nothing');
  const applied = bl([...ADOPT, ...body.plan.approvalsRequired.flatMap(k => ['--confirm', k]), '--approve', body.revision]);
  assert.equal(applied.status, 0, applied.stderr + applied.stdout);
  assert.deepEqual(events(w).map(e => [e.kind, e.scenario, e.outcome, e.step]), [['scenario', 'S1', 'done', 'adopt']]);
  const first = bl(['install', '--engine', 'claude-code', '--engine', 'codex', '--json']);
  assert.equal(first.status, 1, first.stderr + first.stdout);
  {
    const refusal = events(w).filter(e => e.kind === 'scenario').at(-1)!;
    assert.deepEqual([refusal.kind, refusal.outcome, refusal.step, refusal.code], ['scenario', 'refused', 'install', 'PORTABLE_FIDELITY']);
    for (const line of json<{ refused: { key: string }[] }>(first.stdout).refused) assert.equal(bl(['accept', line.key]).status, 0);
  }
  const plan = json<{ revision: string }>(bl(['install', '--engine', 'claude-code', '--engine', 'codex', '--json']).stdout);
  const done = bl(['install', '--engine', 'claude-code', '--engine', 'codex', '--approve', plan.revision, '--json']);
  assert.equal(done.status, 0, done.stderr + done.stdout);
  const install = events(w).filter(e => e.kind === 'scenario').at(-1)!;
  assert.deepEqual([install.scenario, install.outcome, install.step, install.engines, install.plan], ['S2', 'done', 'install', ['claude-code', 'codex'], plan.revision]);
  assert.match(install.target!, /^[0-9a-f]{16}$/);
  const removal = json<{ revision: string }>(bl(['remove', '--json']).stdout);
  assert.equal(bl(['remove', '--approve', removal.revision]).status, 0);
  const last = events(w).filter(e => e.kind === 'scenario').at(-1)!;
  assert.deepEqual([last.scenario, last.outcome, last.step], ['S5', 'done', 'remove']);
  const text = readFileSync(logFile(w), 'utf8');
  assert.equal(events(w).some(e => e.kind === 'error' && e.step === 'harness'), true, 'the refusal is also an error event');
  assert.equal(text.includes(w.home), false); assert.equal(text.includes('e2e'), false);
  const summary = json<{ s2BothEngines: boolean; scenarios: Record<string, { done: number }> }>(run(w.work, ['events', 'summary', '--json'], env).stdout);
  assert.equal(summary.s2BothEngines, true); assert.equal(summary.scenarios.S1!.done, 1); assert.equal(summary.scenarios.S5!.done, 1);
  // With the log off, the same command records nothing more.
  const before = readFileSync(logFile(w), 'utf8');
  run(dir, ['harness', 'status'], { ...env, BOWERLOOM_EVENT_LOG: 'off' });
  assert.equal(readFileSync(logFile(w), 'utf8'), before);
});

test('slice create records S7 only when applied; a refusal records refused; skills add records S3 refused', t => {
  const p = sliceProject(t, { apply: false }), env = { ...envFor(p.home), BOWERLOOM_EVENT_LOG: '' };
  const file = join(p.home, 'state', 'bowerloom', 'events', 'events.jsonl');
  const scenarios = (): Event[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Event) : []).filter(e => e.kind === 'scenario');
  const planned = runSlice(p.dir, ['slice', 'create', 'other'], p.home, { env });
  assert.equal(planned.status, 3); assert.deepEqual(scenarios(), [], 'a plan that waits records nothing');
  const revision = revisionIn(planned.stdout);
  assert.equal(runSlice(p.dir, ['slice', 'create', 'other', '--approve', revision], p.home, { env }).status, 0);
  assert.deepEqual(scenarios().map(e => [e.scenario, e.outcome, e.step]), [['S7', 'done', 'create']]);
  assert.equal(runSlice(p.dir, ['slice', 'create', 'other', '--approve', revision], p.home, { env }).status, 1);
  assert.deepEqual(scenarios().at(-1) && [scenarios().at(-1)!.outcome, scenarios().at(-1)!.code], ['refused', 'SLICE_EXISTS']);
  assert.notEqual(runSlice(p.dir, ['skills', 'add', 'not-a-source'], p.home, { env }).status, 0);
  assert.deepEqual([scenarios().at(-1)!.scenario, scenarios().at(-1)!.outcome, scenarios().at(-1)!.step], ['S3', 'refused', 'add']);
});
