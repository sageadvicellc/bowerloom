// The sample launch's adopt and install calls: made-up folders in memory, plans shaped like the packages' own, the packages' own words, and the same gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AdoptionRefusal } from '../../../packages/adoption/src/index.js';
import { PortableRefusal } from '../../../packages/project-sync/src/index.js';
import type { AdoptionCode } from '../../../packages/adoption/src/index.js';
import type { PortableCode } from '../../../packages/project-sync/src/index.js';
import { SAMPLE_FOLDERS, SAMPLE_MESSAGES, createSampleEngine, sampleEngineFixtures } from '../shared/engine/sample.js';
import { createEngineService } from '../main/engine-service.js';
import type { Answer, ProjectAnswer, ProjectInput } from '../shared/engine/types.js';
import { tempDir } from './support.js';
import { definedFolder, engineFolder, homeFolder } from './helpers-engine/folders.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null); if (!a.ok) assert.fail(`${a.refusal.code}`); return a.value; };
const INPUT: ProjectInput = { engines: ['claude-code', 'codex', 'opencode'], reconcile: 'accept-agents', writeClaudeMd: false, approve: [] };

/** The key paths of a value: every object key, with arrays read through their first element. */
function shape(v: unknown, at = ''): string[] {
  if (Array.isArray(v)) return v.length === 0 ? [`${at}[]`] : shape(v[0], `${at}[]`);
  if (v === null || typeof v !== 'object') return [at];
  return Object.keys(v).sort().flatMap(k => shape((v as Record<string, unknown>)[k], `${at}.${k}`));
}
const keysOnly = (paths: string[]): Set<string> => new Set(paths.map(p => p.replace(/\[\]/g, '')));

test('the sample\'s words for each refusal are the packages\' own words', () => {
  for (const [code, words] of Object.entries(SAMPLE_MESSAGES)) {
    const made = code.startsWith('ADOPTION_') ? new AdoptionRefusal(code as AdoptionCode) : new PortableRefusal(code as PortableCode);
    assert.equal(made.message, words, code);
  }
});

test('the sample plans have every field of the plans the packages make from a synthetic folder', async t => {
  const home = homeFolder(tempDir(t, 'bowerloom-engine-sample-'));
  let next: string | null = engineFolder(home);
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, who: 't' });
  const a = value(await service.chooseFolder());
  const real = value(await service.planAdoption(a.id, { picks: {}, acknowledged: [] }));
  const sample = sampleEngineFixtures().adopt;
  for (const key of keysOnly(shape(real))) assert.ok([...keysOnly(shape(sample))].some(k => k === key || k.startsWith(`${key}.`) || key.startsWith(`${k}.`) || key.endsWith('.pointer')), `adopt ${key}`);
  next = definedFolder(home);
  const d = value(await service.chooseFolder());
  const ask = value(await service.planProjection(d.id, { ...INPUT, engines: ['claude-code', 'codex'] })) as Extract<ProjectAnswer, { kind: 'approve' }>;
  const plan = (value(await service.planProjection(d.id, { ...INPUT, engines: ['claude-code', 'codex'], approve: ask.lines.map(l => l.key) })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  const mine = keysOnly(shape(sampleEngineFixtures().project(INPUT)));
  for (const key of keysOnly(shape(plan))) assert.ok([...mine].some(k => k === key || k.startsWith(`${key}.`) || key.startsWith(`${k}.`)), `project ${key}`);
  assert.deepEqual(Object.keys(sampleEngineFixtures().approveLines[0]!).sort(), Object.keys(ask.lines[0]!).sort());
});

test('sample adoption: picks, acknowledgements and approvals gate the write exactly as the package does, and the folder then holds a definition', async () => {
  const e = createSampleEngine();
  assert.equal(e.mode, 'sample');
  assert.equal(await e.chooseFolder(), null);
  const id = SAMPLE_FOLDERS.adopt;
  let plan = value(await e.planAdoption(id, { picks: {}, acknowledged: [] }));
  assert.equal(plan.ready, false);
  assert.deepEqual(plan.approvals.map(x => x.key), ['hooks/pre-tool-use-9c03e1f2', 'mcp/mail', 'mcp/search']);
  assert.deepEqual(plan.approvals.find(x => x.key === 'mcp/search')!.secrets.map(s => s.reference), ['${SEARCH_KEY}']);
  const choices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: plan.unmapped.filter(u => u.gate === 'acknowledge').map(u => u.id) };
  plan = value(await e.planAdoption(id, choices));
  assert.equal(plan.ready, true);
  assert.equal(plan.conflicts[0]!.picked, 'AGENTS.md');
  const short = await e.runAdoption(id, plan.revision, choices, ['mcp/mail']);
  assert.ok(!short.ok); assert.equal(short.refusal.code, 'ADOPTION_APPROVAL_REQUIRED');
  const stale = await e.runAdoption(id, '0'.repeat(64), choices, plan.approvals.map(x => x.key));
  assert.ok(!stale.ok); assert.equal(stale.refusal.code, 'ADOPTION_STALE_APPROVAL');
  const done = value(await e.runAdoption(id, plan.revision, choices, plan.approvals.map(x => x.key)));
  assert.ok(done.written.includes('.bowerloom/harness.json'));
  const info = (await e.folders()).find(f => f.id === id)!;
  assert.equal(info.hasDefinition, true);
  const again = await e.planAdoption(id, choices);
  assert.ok(!again.ok); assert.equal(again.refusal.code, 'ADOPTION_DEFINED');
});

test('sample install: approvals first, the drift report with Accept AGENTS.md as the default, then a write, a no-change plan, and a removal', async () => {
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.defined;
  const ask = value(await e.planProjection(id, INPUT));
  assert.equal(ask.kind, 'approve');
  const keys = (ask as Extract<ProjectAnswer, { kind: 'approve' }>).lines.map(l => l.key);
  assert.equal(keys.length, 3);
  const merge = await e.planProjection(id, { ...INPUT, reconcile: 'merge', approve: keys });
  assert.ok(!merge.ok); assert.equal(merge.refusal.code, 'PORTABLE_MERGE_NOT_BUILT');
  const plan = (value(await e.planProjection(id, { ...INPUT, approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(plan.drift?.defaultAction, 'accept-agents');
  assert.equal(plan.reconcile, 'accept-agents');
  assert.ok(plan.changes.some(c => c.path === 'CLAUDE.md' && c.action === 'replace'));
  const words = new Set(plan.engines.flatMap(x => x.parts.flatMap(p => p.lines.map(l => l.result))));
  assert.deepEqual([...words].sort(), ['absent', 'exact', 'translated', 'weakened'], 'every result word is in the sample');
  assert.equal(plan.partial, true);
  assert.ok(plan.review.some(r => r.kind === 'code' && r.text.includes('export const BowerloomHooks')));
  const keep = (value(await e.planProjection(id, { ...INPUT, reconcile: 'keep-both', approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.ok(!keep.changes.some(c => c.path === 'CLAUDE.md'));
  assert.equal(keep.engines[0]!.parts[0]!.lines[0]!.result, 'weakened');
  assert.notEqual(keep.revision, plan.revision);
  const stale = await e.runProjection(id, keep.revision, { ...INPUT, approve: keys });
  assert.ok(!stale.ok);
  value(await e.runProjection(id, plan.revision, { ...INPUT, approve: keys }));
  const after = (value(await e.planProjection(id, { ...INPUT, approve: keys })) as Extract<ProjectAnswer, { kind: 'plan' }>).plan;
  assert.equal(after.noop, true);
  const removal = value(await e.planRemoval(id));
  assert.ok(removal.changes.some(c => c.action === 'restore'));
  value(await e.runRemoval(id, removal.revision));
  assert.equal((await e.folders()).find(f => f.id === id)!.projected, false);
});

test('sample recovery: the stopped folder refuses a plan until its recovery runs', async () => {
  const e = createSampleEngine(), id = SAMPLE_FOLDERS.stopped;
  const blocked = await e.planProjection(id, { ...INPUT, engines: ['claude-code'] });
  assert.ok(!blocked.ok); assert.equal(blocked.refusal.code, 'PORTABLE_RECOVERY_REQUIRED');
  const rec = value(await e.planRecovery(id, []));
  assert.equal(rec.action, 'rollback');
  value(await e.runRecovery(id, rec.revision, []));
  assert.equal((await e.folders()).find(f => f.id === id)!.unfinished.projection, false);
  assert.equal(value(await e.planProjection(id, { ...INPUT, engines: ['claude-code'] })).kind, 'plan');
});
