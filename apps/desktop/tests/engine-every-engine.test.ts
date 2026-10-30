// Decision D8B in the adopt sheet: one tick per part (guardrails, hooks, servers), "Use for every engine", off by default. A tick is a choice of the plan:
// main plans with it, the view counts what each part widens, the write must repeat it, and the sample launch answers the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkChoices, createEngineService } from '../main/engine-service.js';
import type { EngineService } from '../main/engine-service.js';
import { SAMPLE_FOLDERS, createSampleEngine } from '../shared/engine/sample.js';
import { EVERY_ENGINE_PARTS } from '../shared/engine/types.js';
import type { AdoptChoices, AdoptView, Answer, FolderInfo } from '../shared/engine/types.js';
import { everyEngineRows, toggleEveryEngine } from '../shared/engine/gates.js';
import { ENGINE_WORDS, everyEngineWords, notWidenedWords } from '../renderer/harness/words-engine.js';
import { LIMITS, bannedHere, countWords } from '../shared/harness/words.js';
import { tempDir } from './support.js';
import { engineFolder, homeFolder } from './helpers-engine/folders.js';

const value = <T>(a: Answer<T> | null): T => { assert.ok(a !== null, 'an answer'); if (!a.ok) assert.fail(`refused: ${a.refusal.code} ${a.refusal.message}`); return a.value; };
const all = (view: AdoptView): { key: string; hash: string }[] => view.approvals.map(a => ({ key: a.key, hash: a.hash }));
const rows = (view: AdoptView): [string, boolean, number][] => view.everyEngine.map(e => [e.part, e.chosen, e.widens]);

function setup(t: test.TestContext): { home: string; service: EngineService; pick(dir: string): void } {
  const home = homeFolder(tempDir(t, 'bowerloom-every-engine-'));
  let next: string | null = null;
  const service = createEngineService({ home, stateRoot: join(home, '.local', 'state', 'bowerloom'), chooseFolder: async () => next, confirm: async () => true, who: 'tester', now: () => new Date('2026-10-28T12:00:00Z') });
  return { home, service, pick: dir => { next = dir; } };
}

/** The choices that make the synthetic folder ready, with the parts to use for every engine. */
async function ready(service: EngineService, id: string, everyEngine: NonNullable<AdoptChoices['everyEngine']>): Promise<{ view: AdoptView; choices: AdoptChoices }> {
  const first = value(await service.planAdoption(id, { picks: {}, acknowledged: [], everyEngine }));
  const ack = first.unmapped.find(u => u.gate === 'acknowledge')!;
  const choices: AdoptChoices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: [{ id: ack.id, hash: ack.hash }], everyEngine };
  return { view: value(await service.planAdoption(id, choices)), choices };
}

test('main: off by default; the view counts each part; a tick plans the part for every engine and changes the revision', async t => {
  const { home, service, pick } = setup(t);
  pick(engineFolder(home));
  const folder: FolderInfo = value(await service.chooseFolder());
  const plain = value(await service.planAdoption(folder.id, { picks: {}, acknowledged: [] }));
  assert.deepEqual(rows(plain), [['guardrails', false, 1], ['hooks', false, 1], ['mcp', false, 1]]);
  for (const i of plain.items.filter(x => x.part === 'hooks')) assert.deepEqual(i.engines, ['claude-code']);
  const wide = value(await service.planAdoption(folder.id, { picks: {}, acknowledged: [], everyEngine: ['hooks'] }));
  assert.deepEqual(rows(wide), [['guardrails', false, 1], ['hooks', true, 1], ['mcp', false, 1]]);
  for (const i of wide.items.filter(x => x.part === 'hooks')) assert.equal(i.engines, null);
  for (const i of wide.items.filter(x => x.part === 'guardrails' || x.part === 'mcp')) assert.deepEqual(i.engines, ['claude-code']);
  assert.notEqual(wide.revision, plain.revision);
});

test('main: the write must repeat the ticks of the plan shown; then the hook is written with no engine filter', async t => {
  const { home, service, pick } = setup(t);
  const dir = engineFolder(home);
  pick(dir);
  const folder = value(await service.chooseFolder());
  const { view, choices } = await ready(service, folder.id, ['hooks', 'mcp']);
  assert.equal(view.ready, true);
  // The same revision with the ticks left out is not the plan shown.
  const without = await service.runAdoption(folder.id, view.revision, { picks: choices.picks, acknowledged: choices.acknowledged }, all(view));
  assert.ok(!without.ok); assert.equal(without.refusal.code, 'NOT_THE_PLAN_SHOWN');
  const done = value(await service.runAdoption(folder.id, view.revision, { ...choices, everyEngine: ['mcp', 'hooks'] }, all(view)));
  assert.ok(done.written.includes('.bowerloom/hooks.json'));
  const hooks = JSON.parse(readFileSync(join(dir, '.bowerloom', 'hooks.json'), 'utf8')) as { hooks: Record<string, unknown>[] };
  const servers = JSON.parse(readFileSync(join(dir, '.bowerloom', 'mcp.json'), 'utf8')) as { servers: Record<string, unknown>[] };
  const rules = JSON.parse(readFileSync(join(dir, '.bowerloom', 'guardrails.json'), 'utf8')) as { rules: Record<string, unknown>[] };
  assert.deepEqual([...hooks.hooks, ...servers.servers].map(e => 'engines' in e), [false, false]);
  assert.deepEqual(rules.rules.map(r => r.engines), [['claude-code']], 'a part not ticked keeps its filter');
});

test('main: a tick names a known part once; anything else is a bad argument', () => {
  assert.deepEqual(checkChoices({ picks: {}, acknowledged: [] }).everyEngine, []);
  assert.deepEqual(checkChoices({ picks: {}, acknowledged: [], everyEngine: ['mcp', 'guardrails'] }).everyEngine, ['guardrails', 'mcp'], 'kept in the order of the parts');
  for (const bad of [['skills'], ['hooks', 'hooks'], 'hooks', [1], null, { hooks: true }]) assert.throws(() => checkChoices({ picks: {}, acknowledged: [], everyEngine: bad }), /BAD_ARGUMENT/, JSON.stringify(bad));
});

test('sample: the same counts and gates; a tick widens the part and the write needs the plan with it', async () => {
  const e = createSampleEngine();
  const id = SAMPLE_FOLDERS.adopt;
  const plain = value(await e.planAdoption(id, { picks: {}, acknowledged: [] }));
  assert.deepEqual(rows(plain), [['guardrails', false, 1], ['hooks', false, 1], ['mcp', false, 1]]);
  assert.deepEqual(plain.everyEngine[0]!.notWidened.map(n => n.id), ['ask-shell-17a2d0c4', 'deny-shell-60f3e9b1']);
  const wide = value(await e.planAdoption(id, { picks: {}, acknowledged: [], everyEngine: ['guardrails'] }));
  assert.deepEqual(rows(wide), [['guardrails', true, 1], ['hooks', false, 1], ['mcp', false, 1]]);
  assert.equal(wide.items.find(i => i.key === 'guardrails/deny-shell-4be1c2aa')!.engines, null);
  assert.notEqual(wide.revision, plain.revision);
  const choices: AdoptChoices = { picks: { 'system-prompt/AGENTS.md': 'AGENTS.md' }, acknowledged: plain.unmapped.filter(u => u.gate === 'acknowledge').map(u => ({ id: u.id, hash: u.hash })), everyEngine: ['guardrails'] };
  const readyPlan = value(await e.planAdoption(id, choices));
  const stale = await e.runAdoption(id, readyPlan.revision, { ...choices, everyEngine: [] }, all(readyPlan));
  assert.ok(!stale.ok); assert.equal(stale.refusal.code, 'ADOPTION_STALE_APPROVAL');
  value(await e.runAdoption(id, readyPlan.revision, choices, all(readyPlan)));
});

test('the tick rows: one per part in order, off by default, each with its count; a tick toggles only its part', async () => {
  const e = createSampleEngine();
  const view = value(await e.planAdoption(SAMPLE_FOLDERS.adopt, { picks: {}, acknowledged: [] }));
  const list = everyEngineRows(view);
  assert.deepEqual(list.map(r => [r.part, r.checked, r.count]), EVERY_ENGINE_PARTS.map(p => [p, false, 1]));
  const start: AdoptChoices = { picks: {}, acknowledged: [] };
  const on = toggleEveryEngine(start, 'mcp', true);
  assert.deepEqual(on.everyEngine, ['mcp']);
  assert.deepEqual(toggleEveryEngine(toggleEveryEngine(on, 'guardrails', true), 'mcp', false).everyEngine, ['guardrails']);
  assert.deepEqual(toggleEveryEngine(on, 'mcp', true).everyEngine, ['mcp'], 'a second tick is the same choice');
  assert.equal(start.everyEngine, undefined, 'the choices are never changed in place');
});

test('the words of the ticks: "Use for every engine", counts that read right, within the limits and with no banned word', () => {
  assert.equal(ENGINE_WORDS.label.everyEngine, 'Use for every engine');
  assert.equal(everyEngineWords(1, false), '1 item reaches only some engines.');
  assert.equal(everyEngineWords(2, true), '2 items now reach every engine.');
  assert.equal(everyEngineWords(0, false), 'Nothing here to widen.');
  assert.equal(notWidenedWords(2), '2 items keep their engines, because they differ.');
  assert.equal(notWidenedWords(1), '1 item keeps its engines, because it differs.');
  for (const text of [ENGINE_WORDS.label.everyEngine, ENGINE_WORDS.label.everyEngineTitle, ENGINE_WORDS.paragraph.everyEngineIntro, everyEngineWords(3, true), everyEngineWords(3, false), everyEngineWords(0, true), notWidenedWords(2)]) {
    assert.equal(bannedHere(text), null, text);
  }
  for (const text of [everyEngineWords(12, false), notWidenedWords(12)]) assert.ok(countWords(text) <= LIMITS.hint, text);
});
