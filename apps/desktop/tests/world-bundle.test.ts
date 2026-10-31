// Export and import (spec 6.7): a bundle holds items, tool references and slice rules, never a secret value or page text; import shows its effect first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildBundle, commitImport, parseBundle, previewImport } from '../shared/world/bundle.js';
import { bundleText, grantWords, openExportedFile } from '../shared/world/export-flow.js';
import { generateWorld } from '../shared/world/sample.js';
import { createStore } from '../shared/world/store.js';
import type { AgentItem, Bundle, McpTool, SkillItem, World } from '../shared/world/types.js';
import { createEmptyWorld } from '../renderer/common/empty-world.js';
import { DESKTOP } from './support.js';
import { agent, found, makeWorld, mcp, prompt, skill } from './testworld.js';

const RULE = { folders: ['notes'], pageTypesAndTags: { types: ['concept'], tags: ['a'] }, linksFromSeeds: { hops: 1 } } as const;

/** A source world with an agent that has a skill, a tool and a slice, and a secret value that must never travel. */
function source(): World {
  const store = createStore(makeWorld());
  store.dispatch({ type: 'createSlice', name: 'Notes', rule: RULE, seeds: ['p1'] });
  store.dispatch({ type: 'attachSkill', agentId: 'a1', skillId: 's2' });
  store.dispatch({ type: 'attachTool', agentId: 'a1', toolId: 't1', access: 'read-write' });
  store.dispatch({ type: 'assignSlice', agentId: 'a1', sliceId: 'slice-1' });
  store.dispatch({ type: 'apply', label: 'ready' });
  const w = store.getState().committed;
  // A value that a careless import of the real world could have put next to the reference. It must not leave the world.
  const leaky = { ...(w.items.find(i => i.id === 't1') as McpTool), secret: { kind: 'env', name: 'SEARCH_TOKEN', state: 'missing', value: 'sk-live-123456' } } as unknown as McpTool;
  return { ...w, items: w.items.map(i => (i.id === 't1' ? leaky : i)) };
}
const roundTrip = (b: Bundle): Bundle => JSON.parse(JSON.stringify(b)) as Bundle;
const target = (): World => ({ ...createEmptyWorld(), interfaces: makeWorld().interfaces });

test('a bundle holds skills and agents, tool references, and slice rules, from the chosen scopes only', () => {
  const b = buildBundle(source(), ['global']);
  assert.deepEqual(b.scopeIds, ['global']);
  assert.deepEqual(b.items.map(i => i.id), ['s1', 's2', 'a1', 'a2'], 'the library skill is left out, the project skill is not in this scope');
  assert.deepEqual(b.toolRefs.map(t => [t.toolId, t.name, t.toolKind]), [['t1', 'Search', 'mcp'], ['t2', 'Summarize', 'prompt'], ['t3', 'Format hook', 'hook']]);
  assert.deepEqual(b.toolRefs[0]!.secret, { kind: 'env', name: 'SEARCH_TOKEN' });
  assert.deepEqual(b.sliceRules, [{ sliceId: 'slice-1', name: 'Notes', rule: RULE }]);
  assert.deepEqual(buildBundle(source(), ['proj']).items.map(i => i.id), ['s3']);
  assert.deepEqual(buildBundle(source(), ['nope']), { scopeIds: [], items: [], toolRefs: [], sliceRules: [] });
});

test('a bundle carries no secret value, no secret state, no page text, no page title, no seeds and no frozen page list', () => {
  const w = source(), text = JSON.stringify(buildBundle(w, ['global', 'proj']));
  assert.doesNotMatch(text, /sk-live-123456/); assert.doesNotMatch(text, /"state"/); assert.doesNotMatch(text, /"value"/);
  for (const p of w.wikiPages) { assert.equal(text.includes(p.summary), false, p.id); assert.equal(text.includes(p.title), false, p.id); }
  assert.doesNotMatch(text, /seeds|pinnedPageIds|wikiPages|versions/);
});

test('the preview lists the files, the secrets to add, and nothing else when the target is empty', () => {
  const p = previewImport(roundTrip(buildBundle(source(), ['global'])), target());
  assert.deepEqual(p.secretsToAdd, [{ kind: 'env', name: 'SEARCH_TOKEN' }]); assert.deepEqual(p.clashes, []);
  assert.deepEqual(p.files.map(f => f.path), [
    '/sample/harness/.bowerloom/tools/Search.json', '/sample/harness/.bowerloom/tools/Summarize.md',
    '/sample/harness/.bowerloom/skills/Review/SKILL.md', '/sample/harness/.bowerloom/skills/Plan/SKILL.md',
    '/sample/harness/.bowerloom/agents/Planner.md', '/sample/harness/.bowerloom/agents/Checker.md', '/sample/harness/.bowerloom/slices/Notes.json']);
  assert.ok(p.files.every(f => f.action === 'add'));
  assert.equal(p.files.some(f => /hook/i.test(f.path)), false, 'a hook is a reference only and writes no file');
});

test('the preview names a clash for the same name, and says whether the text differs', () => {
  const w = source(), bundle = roundTrip(buildBundle(w, ['global']));
  const same = previewImport(bundle, w);
  assert.deepEqual(same.clashes.map(c => [c.itemId, c.name, c.reason]), [['s1', 'Review', 'same-name'], ['s2', 'Plan', 'same-name'], ['a1', 'Planner', 'same-name'], ['a2', 'Checker', 'same-name']]);
  assert.deepEqual(same.files, [], 'identical items are already there, so nothing is written');
  assert.deepEqual(same.secretsToAdd, [{ kind: 'env', name: 'SEARCH_TOKEN' }], 'the secret the tool needs is still not present');
  const edited: World = { ...w, items: w.items.map(i => (i.id === 's1' ? skill('s1', 'Review', 'global', 'A different text.') : i)) };
  const diff = previewImport(bundle, edited);
  assert.deepEqual(diff.clashes.find(c => c.itemId === 's1'), { itemId: 's1', name: 'Review', reason: 'different-text' });
  assert.deepEqual(diff.files.map(f => f.path), ['/sample/harness/.bowerloom/skills/Review (imported)/SKILL.md', '/sample/harness/.bowerloom/agents/Planner (imported).md'], 'the planner now points at a different skill, so it differs too');
});

test('a secret that is already present in the target is not asked for again', () => {
  const w = source(), present: World = { ...w, items: w.items.map(i => (i.id === 't1' ? { ...(i as McpTool), secret: { kind: 'env' as const, name: 'SEARCH_TOKEN', state: 'present' as const } } : i)) };
  assert.deepEqual(previewImport(roundTrip(buildBundle(w, ['global'])), present).secretsToAdd, []);
});

test('an invalid bundle is refused with plain words, whatever is wrong', () => {
  const good = roundTrip(buildBundle(source(), ['global'])) as unknown as Record<string, unknown>;
  const cases: unknown[] = [
    null, undefined, 5, 'text', [], {}, { ...good, items: 'no' }, { ...good, scopeIds: [1] }, { ...good, toolRefs: {} }, { ...good, sliceRules: null },
    { ...good, items: [null] }, { ...good, items: [{ kind: 'team' }] }, { ...good, items: [{ ...(good.items as object[])[0], foundAt: 'x' }] },
    { ...good, items: [{ ...(good.items as object[])[0], name: '' }] }, { ...good, items: [(good.items as object[])[0], (good.items as object[])[0]] },
    { ...good, items: [{ ...(good.items as object[])[2], definition: null }] },
    { ...good, toolRefs: [{ toolId: 'x', name: 'x', toolKind: 'plugin', secret: null }] },
    { ...good, toolRefs: [{ toolId: 'x', name: 'x', toolKind: 'mcp', secret: { kind: 'file', name: 'x' } }] },
    { ...good, toolRefs: [{ toolId: 'x', name: 'x', toolKind: 'mcp', secret: { kind: 'env', name: 'X', value: 'sk-1' } }] },
    { ...good, toolRefs: [{ toolId: 'x', name: 'x', toolKind: 'hook', secret: { kind: 'env', name: 'X' } }] },
    { ...good, sliceRules: [{ sliceId: 's', name: 'n', rule: { folders: 'x' } }] },
  ];
  const world = makeWorld();
  for (const [i, bad] of cases.entries()) {
    for (const act of [() => previewImport(bad as Bundle, world), () => commitImport(bad as Bundle, world), () => parseBundle(bad)]) {
      assert.throws(act, (e: unknown) => e instanceof Error && /^This is not a Bowerloom bundle: .+\.$/.test(e.message) && !/undefined|\[object|JSON|TypeError|terminal|command line|npm /i.test(e.message), `case ${i}`);
    }
  }
  assert.doesNotThrow(() => parseBundle(good));
});

test('a refused secret value says so and names no value', () => {
  const bad = { scopeIds: [], items: [], sliceRules: [], toolRefs: [{ toolId: 'x', name: 'x', toolKind: 'mcp', secret: { kind: 'env', name: 'X', value: 'sk-live-999' } }] };
  assert.throws(() => parseBundle(bad), (e: unknown) => e instanceof Error && /secret value/i.test(e.message) && !e.message.includes('sk-live-999'));
});

test('unknown extra fields on an item are dropped, not carried into the world', () => {
  const good = roundTrip(buildBundle(source(), ['global'])), dirty = { ...good, items: good.items.map(i => ({ ...i, sneaky: '<script>x</script>' })) };
  const next = commitImport(dirty as unknown as Bundle, target());
  assert.equal(JSON.stringify(next).includes('sneaky'), false);
});

test('export, then a plain JSON round trip, then import into a second store gives back the exported items', () => {
  const exported = buildBundle(source(), ['global']);
  const second = createStore(target());
  second.dispatch({ type: 'apply', label: 'empty' });
  const landed = commitImport(roundTrip(exported), second.getState().committed);
  const got = landed.items.filter(i => i.kind === 'skill' || i.kind === 'agent');
  const rooted = (items: readonly (typeof got)[number][]) => items.map(i => ({ ...i, foundAt: i.foundAt.map(f => ({ ...f, path: f.path.replace('/sample/harness/', '') })) }));
  assert.deepEqual(rooted(got), exported.items, 'the same items, except that a found path now sits under the receiving harness');
  assert.ok(got.every(i => i.foundAt.every(f => f.path.startsWith('/sample/harness/'))));
  assert.deepEqual(landed.slices.map(s => ({ id: s.id, name: s.name, rule: s.rule, seeds: s.seeds, pinned: s.pinned })), [{ id: 'slice-1', name: 'Notes', rule: RULE, seeds: [], pinned: false }]);
  const tools = landed.items.filter(i => i.kind === 'tool');
  assert.deepEqual(tools.map(t => [t.id, t.name]), [['t1', 'Search'], ['t2', 'Summarize'], ['t3', 'Format hook']]);
  assert.equal(landed.items.filter(i => i.kind === 'context-slice').length, 1, 'the slice rule arrives with its slice item');
  const mcp = tools[0] as McpTool;
  assert.deepEqual(mcp.secret, { kind: 'env', name: 'SEARCH_TOKEN', state: 'missing' }, 'the secret is still to be added');
  assert.equal(JSON.stringify(landed).includes('sk-live-123456'), false);
  assert.equal(tools[2]!.kind === 'tool' && tools[2]!.toolKind === 'hook' && tools[2]!.foundAt.length === 0, true, 'a hook arrives with no code');
  // Through a store: the import is one more edit of a world, and the bundle of the second world matches the first.
  assert.deepEqual(buildBundle(landed, ['global']).items, exported.items);
});

test('the import into a world that already has the same name keeps both: the new one is renamed, its references follow, and nothing is lost', () => {
  const w = source(), exported = roundTrip(buildBundle(w, ['global']));
  const base = makeWorld(), existing: World = { ...base, items: [skill('s1', 'Review', 'global', 'Another text.'), skill('x', 'Other')] };
  const landed = commitImport(exported, existing);
  assert.equal(landed.items.length, 2 + 3 + 4 + 1, 'two existing, three tools, four items and one slice item; nothing dropped');
  const names = landed.items.filter(i => i.kind === 'skill').map(i => i.name);
  assert.deepEqual(names, ['Review', 'Other', 'Review (imported)', 'Plan']);
  const renamed = landed.items.find(i => i.name === 'Review (imported)') as SkillItem;
  assert.notEqual(renamed.id, 's1'); assert.equal(landed.items.find(i => i.id === 's1')!.name, 'Review');
  const planner = landed.items.find(i => i.name === 'Planner') as AgentItem;
  assert.deepEqual(planner.definition.skillIds, [renamed.id, 's2'], 'the agent points at the renamed copy');
  assert.equal(new Set(landed.items.map(i => i.id)).size, landed.items.length);
});

test('an item that is already there with the same text is not added twice', () => {
  const w = source(), landed = commitImport(roundTrip(buildBundle(w, ['global'])), w);
  assert.deepEqual(landed.items.map(i => i.id), w.items.map(i => i.id));
  assert.equal(landed.slices.length, w.slices.length);
});

test('an item of a scope the target does not have goes into the target global scope; a scope it has is kept', () => {
  const w = source(), bundle = roundTrip(buildBundle(w, ['proj']));
  assert.equal((commitImport(bundle, target()).items[0] as SkillItem).scopeId, 'global');
  const withProj: World = { ...target(), scopes: [...target().scopes, { id: 'proj', kind: 'project', name: 'P', parentId: 'global', path: '/sample/p' }] };
  assert.equal((commitImport(bundle, withProj).items[0] as SkillItem).scopeId, 'proj');
  assert.deepEqual(previewImport(bundle, withProj).files.map(f => f.path), ['/sample/p/.bowerloom/skills/Local/SKILL.md']);
  const noScopes: World = { ...target(), scopes: [] };
  assert.throws(() => commitImport(bundle, noScopes), /place to put/);
});

test('a name cannot send a file outside the harness folder', () => {
  const evil = roundTrip(buildBundle({ ...makeWorld(), items: [skill('e1', '../../etc/passwd')] }, ['global']));
  const p = previewImport(evil, target());
  assert.equal(p.files.length, 1); assert.equal(p.files[0]!.path.includes('..'), false); assert.ok(p.files[0]!.path.startsWith('/sample/harness/.bowerloom/skills/'));
});

test('import and export change neither input, and are deterministic', () => {
  const w = source(), t = target(), wText = JSON.stringify(w), tText = JSON.stringify(t);
  const a = buildBundle(w, ['global']), b = buildBundle(w, ['global']);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const before = JSON.stringify(a);
  const one = commitImport(a, t), two = commitImport(a, t);
  previewImport(a, t);
  assert.equal(JSON.stringify(one), JSON.stringify(two)); assert.equal(JSON.stringify(w), wText); assert.equal(JSON.stringify(t), tText); assert.equal(JSON.stringify(a), before);
});

test('a bundle of 2,000 skills previews and imports quickly', () => {
  const items = Array.from({ length: 2000 }, (_, i) => skill(`k${i}`, `Bulk ${i}`));
  const bundle = buildBundle({ ...makeWorld(), items }, ['global']);
  const started = performance.now();
  assert.equal(previewImport(bundle, target()).files.length, 2000);
  assert.equal(commitImport(bundle, target()).items.length, 2000);
  assert.ok(performance.now() - started < 3000);
});

test('special characters survive an export and an import', () => {
  const name = "Réseau \u{1F33F} '; DROP TABLE x; --", text = 'Zeile eins\n‮ line \u0000 two';
  const w: World = { ...makeWorld(), items: [{ ...skill('u1', name), foundAt: [found('claude-code', '/sample/u', text, 'h-u')] }] };
  const landed = commitImport(roundTrip(buildBundle(w, ['global'])), target());
  assert.equal(landed.items[0]!.name, name); assert.equal((landed.items[0] as SkillItem).foundAt[0]!.text, text);
});

test('an agent with an unknown skill or tool id keeps the id it had (library references stay)', () => {
  const a: AgentItem = { ...agent('a9', 'Lonely', ['lib-skill']), definition: { ...agent('a9', 'Lonely').definition, skillIds: ['lib-skill'], toolAttachments: [{ toolId: 'lib-tool', access: 'read-only' }] } };
  const landed = commitImport(roundTrip(buildBundle({ ...makeWorld(), items: [a] }, ['global'])), target());
  assert.deepEqual((landed.items[0] as AgentItem).definition, a.definition);
});

test('the bundle source reads no clock and no random number, and touches no window or file', () => {
  const text = readFileSync(join(DESKTOP, 'shared', 'world', 'bundle.ts'), 'utf8');
  for (const word of ['Date.', 'new Date', 'Math.random', 'window.bowerloom', 'node:fs', 'innerHTML', 'crypto']) assert.equal(text.includes(word), false, word);
});

// ---- Lost in the cleanup and restored: what a bundle from outside may hold, and what a landed import shows.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const empty = (): World => createEmptyWorld();
const good = (): Record<string, any> => clone(buildBundle(makeWorld(), ['global'])) as unknown as Record<string, any>;
const refuses = (bad: unknown, pattern: RegExp): void => assert.throws(() => parseBundle(bad), (e: unknown) => e instanceof Error && /^This is not a Bowerloom bundle: .+\.$/.test(e.message) && pattern.test(e.message), String(pattern));
const RULE_EMPTY = { folders: [], pageTypesAndTags: { types: [], tags: [] }, linksFromSeeds: null };

test('importing a slice rule also creates its slice item, so the Agents screen and the graph show it', () => {
  const world = generateWorld(1), bundle = clone(buildBundle(world, ['global']));
  assert.ok(bundle.sliceRules.length >= 3);
  const landed = commitImport(bundle, empty());
  assert.equal(landed.slices.length, bundle.sliceRules.length);
  const items = landed.items.filter(i => i.kind === 'context-slice');
  assert.equal(items.length, landed.slices.length, 'one slice item per slice');
  for (const s of landed.slices) assert.deepEqual(items.find(i => i.kind === 'context-slice' && i.sliceId === s.id), { id: `${s.id}-item`, kind: 'context-slice', sliceId: s.id, scopeId: 'global', foundAt: [], library: null, name: s.name });
  assert.equal(commitImport(bundle, landed).items.length, landed.items.length, 'a second import adds no second slice item');
});

test('exporting one project carries the owned skills its agents use, and the preview has no missing reference', () => {
  const world = generateWorld(1), scope = world.scopes.find(s => s.kind === 'project')!;
  const bundle = clone(buildBundle(world, [scope.id]));
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
  const has: World = { ...empty(), items: [{ ...skill('lib-skill', 'Lib skill'), library: { library: 'x', pinnedVersion: '1' } }, { ...mcp('lib-tool', 'Lib tool', null), library: { library: 'x', pinnedVersion: '1' } }], slices: [{ id: 'lib-slice', name: 'L', seeds: [], rule: RULE_EMPTY, pinned: false }] };
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

test('two tools or two slices whose file names meet are kept apart, in lower case too', () => {
  const b = good();
  b.toolRefs = [
    { toolId: 'ta', name: 'a/b', toolKind: 'mcp', secret: null }, { toolId: 'tb', name: 'a-b', toolKind: 'mcp', secret: null },
    { toolId: 'tc', name: 'Foo', toolKind: 'prompt', secret: null }, { toolId: 'td', name: 'foo', toolKind: 'prompt', secret: null }];
  b.sliceRules = [{ sliceId: 'x1', name: 'a/b', rule: RULE_EMPTY }, { sliceId: 'x2', name: 'a-b', rule: { ...RULE_EMPTY, folders: ['n'] } }, { sliceId: 'x3', name: 'Foo', rule: { ...RULE_EMPTY, folders: ['m'] } }, { sliceId: 'x4', name: 'foo', rule: { ...RULE_EMPTY, folders: ['o'] } }];
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

test('an id used by an item and by a tool is refused; an agent cannot be wired to a hook', () => {
  const b = good(); b.toolRefs[0].toolId = b.items[0].id;
  refuses(b, /same id/);
  const c = good(), agentItem = c.items.find((i: any) => i.kind === 'agent');
  agentItem.definition.toolAttachments = [{ toolId: c.toolRefs.find((t: any) => t.toolKind === 'hook').toolId, access: 'read-only' }];
  refuses(c, /hook/);
});

test('item ids and tool ids are mapped apart: a renamed skill never changes a tool id', () => {
  const into: World = { ...empty(), items: [skill('s1', 'Review', 'global', 'Other text'), mcp('t1', 'Existing tool', null)] };
  const landed = commitImport(clone(buildBundle({ ...makeWorld(), items: [skill('s1', 'Review'), mcp('t1', 'Search', null), { ...agent('a1', 'Planner', ['s1']), definition: { ...agent('a1', 'Planner').definition, skillIds: ['s1'], toolAttachments: [{ toolId: 't1', access: 'read-only' }] } }] }, ['global'])), into);
  const planner = landed.items.find(i => i.name === 'Planner') as AgentItem;
  const renamedSkill = landed.items.find(i => i.name === 'Review (imported)')!, search = landed.items.find(i => i.name === 'Search')!;
  assert.deepEqual(planner.definition.skillIds, [renamedSkill.id]);
  assert.deepEqual(planner.definition.toolAttachments.map(t => t.toolId), [search.id]);
  assert.notEqual(search.id, 't1'); assert.notEqual(renamedSkill.id, 's1');
});

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

test('a bundle past a size, count or depth limit is refused in plain words', () => {
  const many = (n: number, make: (i: number) => unknown): unknown[] => Array.from({ length: n }, (_, i) => make(i));
  const b = (patch: Record<string, unknown>): unknown => ({ scopeIds: [], items: [], toolRefs: [], sliceRules: [], ...patch });
  const skillAt = (i: number): unknown => ({ kind: 'skill', id: `k${i}`, name: `n${i}`, scopeId: 'global', foundAt: [], library: null, description: '' });
  refuses(b({ items: many(2001, skillAt) }), /too many items/);
  refuses(b({ toolRefs: many(501, i => ({ toolId: `t${i}`, name: `n${i}`, toolKind: 'prompt', secret: null })) }), /too many tools/);
  refuses(b({ sliceRules: many(201, i => ({ sliceId: `s${i}`, name: `n${i}`, rule: RULE_EMPTY })) }), /too many slice/);
  let deep: unknown = {}; for (let i = 0; i < 9; i += 1) deep = { deeper: deep };
  refuses(b({ extra: deep }), /nested too deeply/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  refuses(b({ extra: cyclic }), /nested too deeply/);
  assert.doesNotThrow(() => parseBundle(b({ items: many(2000, skillAt) })));
});

test('a file past 2 MB is refused before anything is installed, and a good file opens', () => {
  const big = JSON.stringify({ scopeIds: [], items: [], toolRefs: [], sliceRules: [], pad: 'x'.repeat(2 * 1024 * 1024 + 1) });
  const r = openExportedFile(big, empty());
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /larger than 2 MB.*Nothing was installed\.$/);
  assert.equal(openExportedFile(bundleText(buildBundle(makeWorld(), ['global'])), empty()).ok, true);
});

test('no absolute path leaves the export, and a path outside the scope is made relative and lands under the receiving scope', () => {
  const world = generateWorld(1), bundle = buildBundle(world, world.scopes.map(s => s.id));
  assert.ok(bundle.items.length > 0);
  for (const i of bundle.items) for (const f of i.foundAt) { assert.equal(f.path.startsWith('/'), false, f.path); assert.doesNotMatch(f.path, /Users|home|^[A-Za-z]:|\\/, f.path); assert.ok(f.path.length > 0); }
  assert.doesNotMatch(bundleText(bundle), /"path":"\//);
  const w: World = { ...makeWorld(), items: [{ ...skill('s1', 'Away'), foundAt: [found('claude-code', '/home/someone/.claude/skills/Away/SKILL.md', 'x'), found('codex', 'C:\\Users\\someone\\x\\SKILL.md', 'x')] }] };
  const own = clone(buildBundle(w, ['global']));
  for (const f of (own.items[0] as SkillItem).foundAt) assert.doesNotMatch(f.path, /someone|^\/|^[A-Za-z]:/);
  const landed = commitImport(own, empty());
  for (const f of (landed.items[0] as SkillItem).foundAt) assert.ok(f.path.startsWith('/sample/harness/'), f.path);
  assert.deepEqual((buildBundle(landed, ['global']).items[0] as SkillItem).foundAt.map(f => f.path), (own.items[0] as SkillItem).foundAt.map(f => f.path));
});
