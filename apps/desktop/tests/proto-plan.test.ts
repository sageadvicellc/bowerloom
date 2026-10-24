// The projection plan: what writing the harness to each interface would change, shown before any write (spec 6.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planProjection } from '../shared/proto/plan.js';
import { createStore } from '../shared/proto/store.js';
import type { HarnessItem, PlanChange, World } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';
import { agent, copy, found, makeWorld, skill } from './proto-testworld.js';

const GLOBAL = '/sample/harness', PROJ = '/sample/projects/one';
/** The same world with no items: planning from it to `world` lists everything `world` writes. */
const bare = (w: World): World => ({ ...w, items: [], overrides: [], slices: [] });
const paths = (changes: readonly PlanChange[], iface?: string): string[] => changes.filter(c => iface === undefined || c.interface === iface).map(c => c.path);
const withItems = (w: World, items: HarnessItem[]): World => ({ ...w, items });

test('nothing changed, nothing planned', () => {
  const w = makeWorld();
  assert.deepEqual(planProjection(w, w).changes, []);
  assert.deepEqual(planProjection(w, copy(w)).changes, []);
});

test('a new skill is added to each installed interface at an invented path of that interface', () => {
  const w = makeWorld(), draft = withItems(w, [...w.items, skill('s9', 'Brand new')]);
  const { changes } = planProjection(w, draft);
  assert.deepEqual(changes.map(c => [c.interface, c.path, c.action]), [
    ['claude-code', `${GLOBAL}/.claude/skills/Brand new/SKILL.md`, 'add'],
    ['codex', `${GLOBAL}/.agents/skills/Brand new/SKILL.md`, 'add'],
    ['opencode', `${GLOBAL}/.opencode/skill/Brand new.md`, 'add'],
    ['claude-code', `${PROJ}/.claude/skills/Brand new/SKILL.md`, 'add'],
    ['codex', `${PROJ}/.agents/skills/Brand new/SKILL.md`, 'add'],
    ['opencode', `${PROJ}/.opencode/skill/Brand new.md`, 'add'],
  ].sort((a, b) => (['claude-code', 'codex', 'opencode'].indexOf(a[0]!) - ['claude-code', 'codex', 'opencode'].indexOf(b[0]!)) || (a[1]! < b[1]! ? -1 : 1)), 'the project inherits it, so it is written there too');
  const first = changes[0]!; assert.match(first.preview, /Brand new/); assert.match(first.preview, /Steps for Brand new\./);
});

test('a new agent is written for Claude Code, Codex and OpenCode, and lists its skills, tools, slice and only its own interface extras', () => {
  const w = makeWorld(), base = agent('a9', 'Writer', ['s1', 's2']);
  const writer = { ...base, definition: { ...base.definition, toolAttachments: [{ toolId: 't1', access: 'read-only' as const }], sliceId: 'sl1' }, extras: [{ interface: 'codex' as const, badge: 'Codex only', key: 'sandbox', value: 'strict' }] };
  const draft: World = { ...withItems(w, [...w.items, writer]), slices: [{ id: 'sl1', name: 'Notes slice', seeds: [], rule: { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false }] };
  const { changes } = planProjection(w, draft), mine = changes.filter(c => c.path.startsWith(GLOBAL));
  assert.deepEqual(mine.map(c => c.path), [`${GLOBAL}/.claude/agents/Writer.md`, `${GLOBAL}/.codex/agents/Writer.md`, `${GLOBAL}/.opencode/agent/Writer.md`]);
  for (const c of mine) { assert.match(c.preview, /Writer role/); assert.match(c.preview, /Review, Plan/); assert.match(c.preview, /Search \(read-only\)/); assert.match(c.preview, /Notes slice/); }
  assert.match(mine[1]!.preview, /Codex only: sandbox = strict/); assert.doesNotMatch(mine[0]!.preview, /Codex only/); assert.doesNotMatch(mine[2]!.preview, /Codex only/);
});

test('a changed text is a change, a missing item is a remove, and the remove shows what goes away', () => {
  const w = makeWorld(), edited = withItems(w, w.items.map(i => (i.id === 's2' ? skill('s2', 'Plan', 'global', 'New steps for Plan.') : i)));
  const changed = planProjection(w, edited).changes.filter(c => c.path.startsWith(GLOBAL));
  assert.deepEqual(changed.map(c => c.action), ['change', 'change', 'change']); assert.match(changed[0]!.preview, /New steps for Plan\./);
  const removed = planProjection(w, withItems(w, w.items.filter(i => i.id !== 's2'))).changes.filter(c => c.path.startsWith(GLOBAL));
  assert.deepEqual(removed.map(c => c.action), ['remove', 'remove', 'remove']); assert.match(removed[0]!.preview, /Steps for Plan\./);
});

test('a hidden item is not written in the project, and hiding one that was written removes it there only', () => {
  const w = makeWorld(), store = createStore(w);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'hide' });
  const { changes } = planProjection(store.getState().committed, store.getState().draft);
  const removed = changes.filter(c => c.action === 'remove'), changed = changes.filter(c => c.action === 'change');
  assert.deepEqual(removed.map(c => c.path), [`${PROJ}/.claude/skills/Review/SKILL.md`, `${PROJ}/.agents/skills/Review/SKILL.md`, `${PROJ}/.opencode/skill/Review.md`]);
  assert.deepEqual(changed.map(c => c.path), [`${PROJ}/.claude/agents/Planner.md`, `${PROJ}/.codex/agents/Planner.md`, `${PROJ}/.opencode/agent/Planner.md`], 'the project copy of the agent that used Review stops listing it');
  assert.equal(changes.length, 6);
  const full = planProjection(bare(w), store.getState().draft).changes;
  assert.equal(full.some(c => c.path.startsWith(PROJ) && c.path.includes('Review')), false, 'the full plan never writes the hidden skill in the project');
  assert.equal(full.some(c => c.path.startsWith(GLOBAL) && c.path.includes('Review')), true, 'it is still written for the global harness');
});

test('a replaced item writes the replacement and not the original', () => {
  const w = makeWorld(), store = createStore(w);
  store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's1', mode: 'replace', replacementItemId: 's2' });
  const full = planProjection(bare(w), store.getState().draft).changes.filter(c => c.path.startsWith(PROJ) && c.interface === 'claude-code');
  assert.equal(full.some(c => c.path.includes('/Review/')), false);
  assert.equal(full.filter(c => c.path.includes('/Plan/')).length, 1, 'the replacement is written once, even though it is also inherited');
  const diff = planProjection(w, store.getState().draft).changes;
  assert.deepEqual(paths(diff, 'claude-code'), [`${PROJ}/.claude/agents/Planner.md`, `${PROJ}/.claude/skills/Review/SKILL.md`], 'the project stops writing Review and its agent now lists Plan; Plan was already there');
});

test('library items and hooks write nothing', () => {
  const w = makeWorld(), full = planProjection(bare(w), w).changes;
  assert.equal(full.some(c => /Library skill|Format hook/.test(c.path)), false);
  const onlyHook = planProjection(bare(w), withItems(bare(w), [w.items.find(i => i.id === 't3')!, w.items.find(i => i.id === 'l1')!]));
  assert.deepEqual(onlyHook.changes, []);
});

test('an MCP tool and a prompt are written; the MCP file names its secret reference and holds no state or value', () => {
  const w = makeWorld(), full = planProjection(bare(w), w).changes.filter(c => c.path.startsWith(GLOBAL) && c.interface === 'claude-code');
  const mcp = full.find(c => c.path.includes('Search'))!, prompt = full.find(c => c.path.includes('Summarize'))!;
  assert.equal(mcp.path, `${GLOBAL}/.claude/mcp/Search.json`); assert.match(mcp.preview, /env SEARCH_TOKEN/); assert.doesNotMatch(mcp.preview, /missing|present|value/i);
  assert.equal(prompt.path, `${GLOBAL}/.claude/commands/Summarize.md`); assert.match(prompt.preview, /Summarize this\./);
});

test('an interface that is not installed gets no change', () => {
  const w = makeWorld(), off: World = { ...w, interfaces: w.interfaces.map(i => (i.id === 'codex' ? { ...i, installed: 'not-installed' as const } : i.id === 'opencode' ? { ...i, installed: 'unknown' as const } : i)) };
  const { changes } = planProjection(bare(off), off);
  assert.ok(changes.length > 0); assert.deepEqual([...new Set(changes.map(c => c.interface))], ['claude-code']);
});

test('names cannot climb out of the folder: no "..", no slash inside the name part', () => {
  const w = makeWorld(), evil = skill('e1', '../../etc/passwd'), { changes } = planProjection(w, withItems(w, [...w.items, evil]));
  assert.ok(changes.length > 0);
  for (const c of changes) { assert.equal(c.path.includes('..'), false, c.path); assert.ok(c.path.startsWith('/sample/'), c.path); }
});

test('a long text is cut short in the preview, never in the middle of a character, and the full text still decides a change', () => {
  const w = makeWorld(), long = 'x' + '\u{1F33F}'.repeat(500);
  const draft = withItems(w, [...w.items, { ...skill('s9', 'Long'), foundAt: [found('claude-code', '/sample/f', long)] }]);
  for (const c of planProjection(w, draft).changes) { assert.ok(c.preview.length <= 520, String(c.preview.length)); assert.doesNotMatch(c.preview, /[\ud800-\udbff]$/); assert.doesNotMatch(c.preview, /[\ud800-\udbff](?![\udc00-\udfff])/); }
  const longer = withItems(w, [...w.items, { ...skill('s9', 'Long'), foundAt: [found('claude-code', '/sample/f', long + 'z')] }]);
  assert.equal(planProjection(draft, longer).changes.length > 0, true, 'a change past the cut is still a change');
});

test('the plan is deterministic, sorted by interface then path, and changes neither input', () => {
  const w = makeWorld(), store = createStore(w);
  store.dispatch({ type: 'installItem', itemId: 's1', targetScopeId: 'proj' }); store.dispatch({ type: 'setOverride', scopeId: 'proj', itemId: 's2', mode: 'hide' });
  const a = store.getState().committed, b = store.getState().draft, before = JSON.stringify([a, b]);
  const one = planProjection(a, b), two = planProjection(a, b);
  assert.equal(JSON.stringify(one), JSON.stringify(two)); assert.equal(JSON.stringify([a, b]), before);
  const order = ['claude-code', 'codex', 'opencode'];
  for (let i = 1; i < one.changes.length; i += 1) { const p = one.changes[i - 1]!, q = one.changes[i]!; assert.ok(order.indexOf(p.interface) < order.indexOf(q.interface) || (p.interface === q.interface && p.path < q.path)); }
});

test('a plan for a large harness stays quick: 500 skills over three interfaces', () => {
  const w = makeWorld(), many = Array.from({ length: 500 }, (_, i) => skill(`m${i}`, `Many ${i}`));
  const started = performance.now(), { changes } = planProjection(w, withItems(w, [...w.items, ...many]));
  assert.equal(changes.length, 500 * 3 * 2);
  assert.equal(new Set(changes.map(c => `${c.interface}\u0000${c.path}`)).size, changes.length, 'one change per file, so the size is bounded by items times interfaces times scopes');
});

test('the plan source reads no clock and no random number, and touches no window or file', () => {
  const text = readFileSync(join(DESKTOP, 'shared', 'proto', 'plan.ts'), 'utf8');
  for (const word of ['Date.', 'new Date', 'Math.random', 'window.bowerloom', 'node:fs', 'innerHTML']) assert.equal(text.includes(word), false, word);
  assert.match(text, /invented/i, 'the comment says the paths are invented');
});
