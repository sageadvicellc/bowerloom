// Fix pass A2: export and import. A landed slice is an item, a one-scope export carries what its agents use, a bundle from outside is
// checked for control characters, file-name clashes, secret names, ids, repeats and size, and the export says only what is true.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle, commitImport, parseBundle, previewImport } from '../shared/proto/bundle.js';
import { EXPORT_PROMISE, bundleText, describeExport, grantWords, openExportedFile } from '../shared/proto/export-flow.js';
import { planProjection } from '../shared/proto/plan.js';
import { buildHarnessMap } from '../shared/proto/harnessmodel.js';
import { attachableSlices } from '../shared/proto/agents-logic.js';
import { generateWorld } from '../shared/proto/sample.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';
import type { AgentItem, Bundle, SkillItem, World } from '../shared/proto/types.js';
import { agent, found, hook, makeWorld, mcp, prompt, skill } from './proto-testworld.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const empty = (): World => createEmptyWorld();
const good = (): Record<string, any> => clone(buildBundle(makeWorld(), ['global'])) as unknown as Record<string, any>;
const refuses = (bad: unknown, pattern: RegExp): void => assert.throws(() => parseBundle(bad), (e: unknown) => e instanceof Error && /^This is not a Bowerloom bundle: .+\.$/.test(e.message) && pattern.test(e.message), String(pattern));

// ---- 6. a landed slice shows in the harness

test('importing a slice rule also creates its slice item, so the Agents screen and the graph show it', () => {
  const world = generateWorld(1), bundle = clone(buildBundle(world, ['global']));
  assert.ok(bundle.sliceRules.length >= 3);
  const landed = commitImport(bundle, empty());
  assert.equal(landed.slices.length, bundle.sliceRules.length);
  const items = landed.items.filter(i => i.kind === 'context-slice');
  assert.equal(items.length, landed.slices.length, 'one slice item per slice');
  for (const s of landed.slices) assert.deepEqual(items.find(i => i.kind === 'context-slice' && i.sliceId === s.id), { id: `${s.id}-item`, kind: 'context-slice', sliceId: s.id, scopeId: 'global', foundAt: [], library: null, name: s.name });
  const reader = landed.items.find((i): i is AgentItem => i.kind === 'agent' && i.definition.sliceId !== undefined)!;
  assert.ok(attachableSlices(landed, reader).length >= 3);
  const map = buildHarnessMap(landed, { scopeId: 'global', showInherited: true, expandedGroups: [] });
  assert.ok(map.edges.some(e => e.rel === 'reads' && e.from === reader.id), 'the graph has a reads edge');
  assert.equal(commitImport(bundle, landed).items.length, landed.items.length, 'a second import adds no second slice item');
});

// ---- 7. a one-scope export carries what its agents use

test('exporting one project carries the owned skills its agents use, and the preview has no missing reference', () => {
  const world = generateWorld(1), bundle = clone(buildBundle(world, ['scope-reedmarsh']));
  const ids = new Set(bundle.items.map(i => i.id)), tools = new Set(bundle.toolRefs.map(t => t.toolId));
  const byId = new Map(world.items.map(i => [i.id, i]));
  const agents = bundle.items.filter((i): i is AgentItem => i.kind === 'agent');
  assert.ok(agents.length > 0);
  for (const a of agents) {
    for (const s of a.definition.skillIds) assert.ok(ids.has(s) || byId.get(s)?.library !== null, `skill ${s} is in the bundle or a library reference`);
    for (const t of a.definition.toolAttachments) assert.ok(tools.has(t.toolId), `tool ${t.toolId}`);
  }
  const p = previewImport(bundle, empty());
  assert.deepEqual(p.missingRefs, []);
  assert.ok(p.grants.length >= 1);
});

test('a reference to a library item that the target lacks is listed as missing; the target that has it lists nothing', () => {
  const lonely: AgentItem = { ...agent('a9', 'Lonely'), definition: { ...agent('a9', 'Lonely').definition, skillIds: ['lib-skill'], toolAttachments: [{ toolId: 'lib-tool', access: 'read-only' }], sliceId: 'lib-slice' } };
  const bundle = clone(buildBundle({ ...makeWorld(), items: [lonely] }, ['global']));
  const p = previewImport(bundle, empty());
  assert.equal(p.missingRefs.length, 3);
  for (const word of ['lib-skill', 'lib-tool', 'lib-slice', 'Lonely']) assert.ok(p.missingRefs.some(r => r.includes(word)), word);
  const has: World = { ...empty(), items: [{ ...skill('lib-skill', 'Lib skill'), library: { library: 'x', pinnedVersion: '1' } }, { ...mcp('lib-tool', 'Lib tool', null), library: { library: 'x', pinnedVersion: '1' } }], slices: [{ id: 'lib-slice', name: 'L', seeds: [], rule: { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null }, pinned: false }] };
  assert.deepEqual(previewImport(bundle, has).missingRefs, []);
  assert.ok(p.missingRefs.every(r => /^.+\.$/.test(r)), 'each one is a plain sentence');
});

test('the preview lists every access class the import would grant, and the size of every file', () => {
  const w: World = { ...makeWorld(), items: [skill('s1', 'Review', 'global', 'abcdef'), mcp('t1', 'Search'), prompt('t2', 'Summarize', 'Say hi'), { ...agent('a1', 'Planner', ['s1']), definition: { ...agent('a1', 'Planner').definition, skillIds: ['s1'], toolAttachments: [{ toolId: 't1', access: 'read-write' }, { toolId: 't2', access: 'read-only' }] } }] };
  const p = previewImport(clone(buildBundle(w, ['global'])), empty());
  assert.deepEqual(p.grants, [{ agent: 'Planner', tool: 'Search', access: 'read-write' }, { agent: 'Planner', tool: 'Summarize', access: 'read-only' }]);
  assert.match(grantWords(p.grants[0]!), /^Planner may use Search: read and write\.$/);
  assert.equal(p.files.length, 4);
  for (const f of p.files) assert.ok(Number.isInteger(f.characters) && f.characters > 0, f.path);
  const skillFile = p.files.find(f => f.path.endsWith('SKILL.md'))!;
  assert.ok(skillFile.characters >= 'abcdef'.length);
});

test('a plan preview that is cut says how many characters the file holds', () => {
  const w = makeWorld(), long = 'word '.repeat(300);
  const draft: World = { ...w, items: [...w.items, { ...skill('s9', 'Long'), foundAt: [found('claude-code', '/sample/f', long)] }] };
  const cut = planProjection(w, draft).changes.find(c => c.path.endsWith('Long/SKILL.md') && c.interface === 'claude-code')!;
  const whole = `Skill: Long\nAbout Long\n\n${long}`.length;
  assert.match(cut.preview, new RegExp(`${whole.toLocaleString('en-US').replace(',', ',')} characters`));
  const small = planProjection(w, { ...w, items: [...w.items, skill('s8', 'Small')] }).changes[0]!;
  assert.doesNotMatch(small.preview, /characters/, 'a file that is not cut says nothing about its size');
});

// ---- 8. control characters

test('a short field with a control character is refused; newlines and tabs stay in the text fields', () => {
  for (const [path, value] of [['role', 'Plan\u0007r'], ['name', 'Plan\u0000'], ['extra key', 'k\u001b[31m'], ['extra value', 'v\u0085']] as const) {
    const b = good(), a = b.items.find((i: any) => i.kind === 'agent');
    if (path === 'role') a.definition.role = value; else if (path === 'name') a.definition.name = value;
    else a.extras = [{ interface: 'codex', badge: 'Codex only', key: path === 'extra key' ? value : 'k', value: path === 'extra value' ? value : 'v' }];
    refuses(b, /control character|not usable/i);
  }
  const b = good(), a = b.items.find((i: any) => i.kind === 'agent');
  a.definition.role = 'Line one\nline\ttwo'; a.definition.instructions = 'Do this.\nThen this.\u0000';
  b.items.find((i: any) => i.kind === 'skill').foundAt[0].text = 'Steps\n1. a\n2. b';
  assert.doesNotThrow(() => parseBundle(b));
});

// ---- 9. file-name collisions of tools and slices

test('two tools or two slices whose file names meet are kept apart, in lower case too', () => {
  const rule = { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null };
  const b = good();
  b.toolRefs = [
    { toolId: 'ta', name: 'a/b', toolKind: 'mcp', secret: null }, { toolId: 'tb', name: 'a-b', toolKind: 'mcp', secret: null },
    { toolId: 'tc', name: 'Foo', toolKind: 'prompt', secret: null }, { toolId: 'td', name: 'foo', toolKind: 'prompt', secret: null }];
  b.sliceRules = [{ sliceId: 'x1', name: 'a/b', rule }, { sliceId: 'x2', name: 'a-b', rule: { ...rule, folders: ['n'] } }, { sliceId: 'x3', name: 'Foo', rule: { ...rule, folders: ['m'] } }, { sliceId: 'x4', name: 'foo', rule: { ...rule, folders: ['o'] } }];
  b.items = []; 
  const bundle = parseBundle(b), p = previewImport(bundle, empty());
  const lower = p.files.map(f => f.path.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, 'no two files meet, even on a disk that ignores case');
  assert.equal(p.files.length, 8);
  const landed = commitImport(bundle, empty());
  assert.equal(landed.items.filter(i => i.kind === 'tool').length, 4);
  assert.equal(new Set(landed.items.filter(i => i.kind === 'tool').map(i => i.name.toLowerCase())).size, 4);
  assert.ok(p.clashes.length >= 4, 'each renamed one is told');
});

// ---- 10. secret names

test('a secret name must look like what it names', () => {
  const ref = (kind: string, name: string) => { const b = good(); b.toolRefs = [{ toolId: 'x', name: 'x', toolKind: 'mcp', secret: { kind, name } }]; b.items = []; return b; };
  for (const [kind, name] of [['env', 'lower'], ['env', '1BAD'], ['env', 'HAS SPACE'], ['env', 'A-B'], ['env', ''], ['env', 'X'.repeat(65)], ['keychain', 'a/b'], ['keychain', 'x'.repeat(65)], ['keychain', 'semi;colon'], ['keychain', '']] as const) {
    refuses(ref(kind, name), /secret/i);
  }
  for (const [kind, name] of [['env', 'LANTERN_TOKEN'], ['env', '_X1'], ['keychain', 'My key.v2-a_b'], ['keychain', 'x'.repeat(64)]] as const) assert.doesNotThrow(() => parseBundle(ref(kind, name)), `${kind} ${name}`);
});

test('every secret name of the sample worlds passes the check', () => {
  for (const seed of [1, 2, 3]) {
    const world = generateWorld(seed);
    assert.doesNotThrow(() => parseBundle(clone(buildBundle(world, world.scopes.map(s => s.id)))), `seed ${seed}`);
  }
});

// ---- 11. ids

test('an id used by an item and by a tool is refused; an agent cannot be wired to a hook', () => {
  const b = good(); b.toolRefs[0].toolId = b.items[0].id;
  refuses(b, /same id/);
  const c = good(), agentItem = c.items.find((i: any) => i.kind === 'agent');
  agentItem.definition.toolAttachments = [{ toolId: c.toolRefs.find((t: any) => t.toolKind === 'hook').toolId, access: 'read-only' }];
  refuses(c, /hook/);
});

test('item ids and tool ids are mapped apart: a renamed skill never changes a tool id', () => {
  const target: World = { ...empty(), items: [skill('s1', 'Review', 'global', 'Other text'), mcp('t1', 'Existing tool', null)] };
  const landed = commitImport(clone(buildBundle({ ...makeWorld(), items: [skill('s1', 'Review'), mcp('t1', 'Search', null), { ...agent('a1', 'Planner', ['s1']), definition: { ...agent('a1', 'Planner').definition, skillIds: ['s1'], toolAttachments: [{ toolId: 't1', access: 'read-only' }] } }] }, ['global'])), target);
  const planner = landed.items.find(i => i.name === 'Planner') as AgentItem;
  const renamedSkill = landed.items.find(i => i.name === 'Review (imported)')!, search = landed.items.find(i => i.name === 'Search')!;
  assert.deepEqual(planner.definition.skillIds, [renamedSkill.id]);
  assert.deepEqual(planner.definition.toolAttachments.map(t => t.toolId), [search.id]);
  assert.notEqual(search.id, 't1'); assert.notEqual(renamedSkill.id, 's1');
});

// ---- 12. the same bundle twice

test('importing the same bundle again adds nothing, even when the first import was renamed', () => {
  const w: World = { ...makeWorld(), items: [skill('s1', 'Review'), { ...agent('a1', 'Planner', ['s1']) }] };
  const bundle = clone(buildBundle(w, ['global']));
  const base: World = { ...empty(), items: [skill('x1', 'Review', 'global', 'A different text.')] };
  const once = commitImport(bundle, base), twice = commitImport(bundle, once), thrice = commitImport(bundle, twice);
  assert.deepEqual(once.items.map(i => i.name), ['Review', 'Review (imported)', 'Planner']);
  assert.deepEqual(twice.items.map(i => i.id), once.items.map(i => i.id));
  assert.deepEqual(thrice.items.map(i => i.id), once.items.map(i => i.id));
  assert.equal(previewImport(bundle, once).files.length, 0);
});

// ---- 13. limits

test('a bundle past a size, count or depth limit is refused in plain words', () => {
  const rule = { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null };
  const many = (n: number, make: (i: number) => unknown): unknown[] => Array.from({ length: n }, (_, i) => make(i));
  const b = (patch: Record<string, unknown>): unknown => ({ scopeIds: [], items: [], toolRefs: [], sliceRules: [], ...patch });
  refuses(b({ items: many(2001, i => ({ kind: 'skill', id: `k${i}`, name: `n${i}`, scopeId: 'global', foundAt: [], library: null, description: '' })) }), /too many items/);
  refuses(b({ toolRefs: many(501, i => ({ toolId: `t${i}`, name: `n${i}`, toolKind: 'prompt', secret: null })) }), /too many tools/);
  refuses(b({ sliceRules: many(201, i => ({ sliceId: `s${i}`, name: `n${i}`, rule })) }), /too many slice/);
  let deep: unknown = {}; for (let i = 0; i < 9; i += 1) deep = { deeper: deep };
  refuses(b({ extra: deep }), /nested too deeply/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  refuses(b({ extra: cyclic }), /nested too deeply/);
  assert.doesNotThrow(() => parseBundle(b({ items: many(2000, i => ({ kind: 'skill', id: `k${i}`, name: `n${i}`, scopeId: 'global', foundAt: [], library: null, description: '' })) })));
  const big = JSON.stringify(b({ pad: 'x'.repeat(2 * 1024 * 1024 + 1) }));
  const r = openExportedFile(big, empty());
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /larger than 2 MB.*Nothing was installed\.$/);
  assert.equal(openExportedFile(bundleText(buildBundle(makeWorld(), ['global'])), empty()).ok, true);
});

// ---- 14. what the export says and holds

test('the promise says what is true, and no absolute path leaves the export', () => {
  assert.doesNotMatch(EXPORT_PROMISE, /^No secrets and no wiki page text are in this file\.$/);
  for (const phrase of [/no secret value/i, /no wiki page text/i, /text of (your )?skills/i, /agents/i, /where they were found|file locations|locations/i]) assert.match(EXPORT_PROMISE, phrase);
  const world = generateWorld(1), bundle = buildBundle(world, world.scopes.map(s => s.id));
  assert.ok(bundle.items.length > 0);
  for (const i of bundle.items) for (const f of i.foundAt) { assert.equal(f.path.startsWith('/'), false, f.path); assert.doesNotMatch(f.path, /Users|home|^[A-Za-z]:|\\/, f.path); assert.ok(f.path.length > 0); }
  const text = bundleText(bundle);
  assert.doesNotMatch(text, /"path":"\//);
  assert.doesNotMatch(text, /\/Users\/sample/);
  const studio = bundle.items.find(i => i.id === 'skill-triple')!;
  assert.deepEqual(studio.foundAt.map(f => f.interface), ['claude-code', 'codex', 'opencode']);
  assert.match(studio.foundAt[0]!.path, /^\.claude\//);
  assert.equal(describeExport(bundle, world).promise, EXPORT_PROMISE);
});

test('a path outside the scope is made relative too, and the import puts it under the receiving scope', () => {
  const w: World = { ...makeWorld(), items: [{ ...skill('s1', 'Away'), foundAt: [found('claude-code', '/Users/jane/.claude/skills/Away/SKILL.md', 'x'), found('codex', 'C:\\Users\\jane\\x\\SKILL.md', 'x')] }] };
  const bundle = clone(buildBundle(w, ['global']));
  for (const f of (bundle.items[0] as SkillItem).foundAt) { assert.doesNotMatch(f.path, /jane|^\/|^[A-Za-z]:/); }
  const landed = commitImport(bundle, empty());
  for (const f of (landed.items[0] as SkillItem).foundAt) assert.ok(f.path.startsWith('/sample/harness/'), f.path);
  const again = buildBundle(landed, ['global']);
  assert.deepEqual((again.items[0] as SkillItem).foundAt.map(f => f.path), (bundle.items[0] as SkillItem).foundAt.map(f => f.path));
});

void hook; void ({} as Bundle);
