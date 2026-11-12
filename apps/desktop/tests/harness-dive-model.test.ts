// The dive, pure part (v0.9 lane 3): which parts a harness lists and in what order, and where each part comes from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DIVE_KIND_ORDER, diveGroups, diveView, originLines, originOf } from '../shared/harness/harness-dive.js';
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

test('a part id that the state does not hold is reported, never dropped, also an empty id and __proto__', () => {
  const odd: Harness = { ...mixed, partIds: ['nope', '', '__proto__', 'agent-hidden'], missing: [] };
  const view = diveView(state, odd);
  assert.deepEqual(view.unresolved, ['nope', '', '__proto__']);
  assert.deepEqual(view.groups.flatMap(g => g.parts.map(p => p.id)), ['agent-hidden']);
  assert.equal(view.empty, false);
});

test('an id that harness.missing names is shown as missing, and is not also unresolved', () => {
  const h: Harness = { ...mixed, partIds: ['skill-gone'], missing: [{ id: 'skill-gone', kind: 'skill', name: 'Gone skill' }] };
  const view = diveView(state, h);
  assert.deepEqual(view.unresolved, []);
  assert.deepEqual(view.groups[0]!.missing.map(m => m.name), ['Gone skill']);
  assert.equal(view.empty, false);
});

test('the dive is empty only when the manifest lists no part and names none as missing', () => {
  assert.equal(diveView(state, state.harnesses.find(h => h.id === 'harness-empty')!).empty, true);
  assert.equal(diveView(state, { ...mixed, partIds: ['nope'], missing: [] }).empty, false);
  assert.equal(diveView(state, { ...mixed, partIds: [], missing: [{ id: 'x', kind: 'tool', name: 'X' }] }).empty, false);
});

test('a repeated id in the manifest gives one row, and an id that two parts share is reported', () => {
  const dup = { ...byName('Alpha checklist') };
  const twice = { ...state, parts: [...state.parts, { ...dup, name: 'Second copy' }] };
  const view = diveView(twice, { ...mixed, partIds: [dup.id, dup.id], missing: [] });
  assert.equal(view.groups.flatMap(g => g.parts).length, 1);
  assert.equal(view.groups[0]!.parts[0]!.name, 'Alpha checklist');
  assert.deepEqual(view.duplicates, [dup.id]);
  assert.deepEqual(diveView(state, mixed).duplicates, []);
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

test('a part whose source the scan does not hold says so, and is never guessed', () => {
  const o = originOf(state, { ...byName('Alpha checklist'), origin: 'src-nowhere' });
  assert.equal(o.how, 'source-missing');
  assert.equal(o.place, null);
  assert.deepEqual(originLines(o).filter(l => /Found in/.test(l)), []);
  assert.ok(originLines(o).includes('The source of this part is not in the scan.'));
});

test('a part that names no place at all keeps the unknown branch', () => {
  const o = originOf(state, { ...byName('Alpha checklist'), origin: '' });
  assert.equal(o.how, 'unknown');
  assert.ok(originLines(o).some(l => /no record/i.test(l)));
});

test('a source with no label reads "Found in the source X", never "a folder"', () => {
  for (const label of [undefined, '']) {
    const sources = state.sources.map(s => (s.id === 'src-alpha' ? { ...s, label } : s));
    const lines = originLines(originOf({ ...state, sources } as typeof state, byName('Alpha checklist')));
    assert.ok(lines.includes('Found in the source alpha (Claude Code).'), JSON.stringify(lines));
    assert.ok(!lines.some(l => /a folder/.test(l)));
  }
});

test('the file name is never a path: both slashes, a context part, no extension, and an empty name give no folder name', () => {
  const part = byName('Alpha checklist');
  const lines = (path: string, kind: Part['kind'] = 'skill'): string[] => originLines(originOf(state, { ...part, kind, path }));
  assert.equal(originOf(state, { ...part, path: 'C:\\Users\\x\\p' }).fileName, null);
  assert.equal(originOf(state, { ...part, kind: 'context', path: '/Users/x/p' }).fileName, null);
  assert.equal(originOf(state, { ...part, kind: 'context', path: '/Users/x/notes.md' }).fileName, null);
  assert.equal(originOf(state, { ...part, path: 'C:\\Users\\x\\SKILL.md' }).fileName, 'SKILL.md');
  assert.equal(originOf(state, { ...part, path: '/Users/x/dir/' }).fileName, null);
  assert.equal(originOf(state, { ...part, path: 'a/b/.' }).fileName, null);
  for (const l of [...lines('C:\\Users\\x\\p'), ...lines('/Users/x/p', 'context'), ...lines('/Users/x/dir/')]) { assert.doesNotMatch(l, /Users/); assert.doesNotMatch(l, /File: \.$/); }
  assert.ok(!lines('/Users/x/dir/').some(l => l.startsWith('File:')));
});

test('the same-text count is for skills with a non-empty hash, and no other kind', () => {
  const tool = byName('Tracker');
  const tools = { ...state, parts: [...state.parts, { ...tool, id: 'tool-a', contentHash: 'h1' }, { ...tool, id: 'tool-b', contentHash: 'h1' }] };
  assert.equal(originOf(tools, tools.parts.find(p => p.id === 'tool-a')!).sameTextElsewhere, 0);
  const skill = byName('Alpha checklist');
  const empties = { ...state, parts: [...state.parts, { ...skill, id: 'skill-e1', contentHash: '' }, { ...skill, id: 'skill-e2', contentHash: '' }] };
  assert.equal(originOf(empties, empties.parts.find(p => p.id === 'skill-e1')!).sameTextElsewhere, 0);
  const hash = byName('Check facts', 'src-alpha').contentHash;
  const agentLike = { ...state, parts: [...state.parts, { ...skill, id: 'agent-h', kind: 'agent' as const, contentHash: hash! }] };
  assert.equal(originOf(agentLike, byName('Check facts', 'src-alpha')).sameTextElsewhere, 2);
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
