// The dive, pure part (v0.9 lane 3): which parts a harness lists and in what order, and where each part comes from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIVE_KIND_ORDER, diveGroups, originLines, originOf } from '../shared/harness/harness-dive.js';
import type { Harness, Part } from '../shared/harness/types.js';
import { fixtureState } from './harness-dive-fixture.js';

const state = fixtureState();
const mixed = state.harnesses.find(h => h.id === 'harness-mixed')!;
const byName = (name: string, origin?: string): Part => state.parts.find(p => p.name === name && (origin === undefined || p.origin === origin))!;

test('the dive lists skills and agents first, then tools and context', () => {
  assert.deepEqual([...DIVE_KIND_ORDER], ['skill', 'agent', 'tool', 'context']);
  assert.deepEqual(diveGroups(state, mixed).map(g => g.kind), ['skill', 'agent', 'tool', 'context']);
});

test('each group holds the parts of its kind in manifest order, and the harness holds no other part', () => {
  const groups = diveGroups(state, mixed);
  const skills = groups.find(g => g.kind === 'skill')!, agents = groups.find(g => g.kind === 'agent')!;
  assert.deepEqual(skills.parts.map(p => p.name), ['Check facts', 'Alpha checklist']);
  assert.deepEqual(agents.parts.map(p => p.name), ['Reviewer', 'Release helper', 'Hidden agent']);
  assert.equal(groups.flatMap(g => g.parts).length, mixed.partIds.length);
});

test('a part the harness names and the state does not hold shows as missing, in the group of its kind', () => {
  const skills = diveGroups(state, mixed).find(g => g.kind === 'skill')!;
  assert.deepEqual(skills.missing.map(m => m.name), ['Gone skill']);
});

test('a kind with no part and nothing missing is left out; an empty harness has no group', () => {
  assert.deepEqual(diveGroups(state, state.harnesses.find(h => h.id === 'harness-empty')!), []);
  const agentsOnly: Harness = { ...mixed, partIds: ['agent-hidden'], missing: [] };
  assert.deepEqual(diveGroups(state, agentsOnly).map(g => g.kind), ['agent']);
});

test('a part id that the state does not hold is skipped, not thrown', () => {
  const odd: Harness = { ...mixed, partIds: ['nope', '', '__proto__', 'agent-hidden'], missing: [] };
  assert.deepEqual(diveGroups(state, odd).flatMap(g => g.parts.map(p => p.id)), ['agent-hidden']);
});

test('the dive does not change the state it reads', () => {
  const before = JSON.stringify(state);
  diveGroups(state, mixed);
  for (const p of state.parts) originLines(originOf(state, p));
  assert.equal(JSON.stringify(state), before);
});

test('a harness of 10,000 parts is grouped at once', () => {
  const parts: Part[] = Array.from({ length: 10000 }, (_, i) => ({ ...byName('Alpha checklist'), id: `skill-bulk-${i}`, name: `Bulk ${i}` }));
  const big = { ...state, parts: [...state.parts, ...parts] };
  const h: Harness = { ...mixed, partIds: parts.map(p => p.id), missing: [] };
  const t0 = Date.now();
  const groups = diveGroups(big, h);
  assert.equal(groups[0]!.parts.length, 10000);
  assert.ok(Date.now() - t0 < 2000);
});

test('a part found in a project folder names the folder, the scope, the program and the file', () => {
  const o = originOf(state, byName('Alpha checklist'));
  assert.equal(o.how, 'found');
  assert.equal(o.place, '~/Projects/weekly-report');
  assert.equal(o.scope, 'project');
  assert.equal(o.interfaceName, 'Claude Code');
  assert.equal(o.fileName, 'SKILL.md');
  assert.equal(o.version, null);
  assert.equal(o.folder, null);
});

test('a part found in the home folder says home, and keeps its label and version', () => {
  const o = originOf(state, state.parts.find(p => p.id === 'skill-check-facts')!);
  assert.equal(o.how, 'found');
  assert.equal(o.scope, 'home');
  assert.equal(o.place, '~');
  assert.equal(o.label, 'Caveman plug-in');
  assert.equal(o.version, '1.2');
});

test('a skill with the same text in other places counts them', () => {
  assert.equal(originOf(state, byName('Check facts', 'src-alpha')).sameTextElsewhere, 2);
  assert.equal(originOf(state, byName('Alpha checklist')).sameTextElsewhere, 0);
});

test('a part that only a folder harness names points to that folder and reads no file', () => {
  const o = originOf(state, state.parts.find(p => p.id === 'agent-folder-held')!);
  assert.equal(o.how, 'harness-folder');
  assert.equal(o.folder, 'weekly-report');
  assert.equal(o.place, null);
  assert.equal(o.fileName, null);
});

test('a part whose place the state does not hold is unknown, never guessed', () => {
  const o = originOf(state, { ...byName('Alpha checklist'), origin: 'src-nowhere' });
  assert.equal(o.how, 'unknown');
  assert.equal(o.place, null);
  assert.deepEqual(originLines(o).filter(l => /Found in/.test(l)), []);
  assert.ok(originLines(o).some(l => /no record/i.test(l)));
});

test('an empty path gives no file name, and a label with Unicode and markup passes through as text', () => {
  const o = originOf(state, { ...byName('Alpha checklist'), path: '', source: 'Café <b>🌿</b>' });
  assert.equal(o.fileName, null);
  assert.equal(o.label, 'Café <b>🌿</b>');
});

test('the lines are short, plain sentences with no full path and none of the banned words', () => {
  for (const p of state.parts) {
    const lines = originLines(originOf(state, p));
    assert.ok(lines.length >= 1);
    for (const line of lines) {
      assert.match(line, /\.$/);
      assert.doesNotMatch(line, /\b(should|may|might)\b/i);
      assert.doesNotMatch(line, /\/Users\/|\/home\/|[A-Z]:\\/);
      assert.ok(line.split(/\s+/).length <= 25);
    }
  }
});

test('the lines of a found part say where it was found, and those of a folder part say whose harness names it', () => {
  const found = originLines(originOf(state, byName('Alpha checklist'))).join(' ');
  assert.match(found, /Found in ~\/Projects\/weekly-report/);
  assert.match(found, /Claude Code/);
  const folder = originLines(originOf(state, state.parts.find(p => p.id === 'agent-folder-held')!)).join(' ');
  assert.match(folder, /harness of the folder weekly-report/);
  assert.match(folder, /did not read its file/);
  assert.match(originLines(originOf(state, byName('Check facts', 'src-alpha'))).join(' '), /Same text in 2 other places/);
});
