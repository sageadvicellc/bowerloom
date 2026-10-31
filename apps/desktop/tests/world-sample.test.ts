// The seeded sample world of the prototype (spec 11, "Prototype rules"): scale, determinism, the four planted cases and a clean reference check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRng } from '../shared/world/rng.js';
import { CASE_IDS, SAMPLE_WORDS, generateWorld, hashText, validateWorld } from '../shared/world/sample.js';
import { matchPages } from '../shared/world/slicerule.js';
import { createEmptyWorld } from '../renderer/common/fakeApi.js';
import type { AgentItem, HarnessItem, HookTool, McpTool, SkillItem, World } from '../shared/world/types.js';
import { DESKTOP } from './support.js';

const world = generateWorld(1);
const skills = world.items.filter((i): i is SkillItem => i.kind === 'skill');
const agents = world.items.filter((i): i is AgentItem => i.kind === 'agent');
const tools = world.items.filter((i): i is Extract<HarnessItem, { kind: 'tool' }> => i.kind === 'tool');
const byId = (id: string): HarnessItem | undefined => world.items.find(i => i.id === id);

// ---- The seeded generator ----

test('createRng: the same seed gives the same numbers, another seed gives other numbers', () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const first = Array.from({ length: 20 }, () => a.next()), second = Array.from({ length: 20 }, () => b.next()), third = Array.from({ length: 20 }, () => c.next());
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, third);
  for (const n of first) assert.ok(n >= 0 && n < 1);
});

test('createRng: int stays inside its bounds and reaches both ends, pick takes from the list, shuffle keeps every element', () => {
  const rng = createRng(7), seen = new Set<number>();
  for (let i = 0; i < 500; i += 1) { const n = rng.int(3, 6); assert.ok(Number.isInteger(n) && n >= 3 && n <= 6); seen.add(n); }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
  assert.equal(rng.int(5, 5), 5);
  const list = ['a', 'b', 'c', 'd'];
  for (let i = 0; i < 50; i += 1) assert.ok(list.includes(rng.pick(list)));
  const input = Array.from({ length: 30 }, (_, i) => i), copy = [...input], out = rng.shuffle(input);
  assert.deepEqual(input, copy, 'the input is left alone');
  assert.deepEqual([...out].sort((x, y) => x - y), input);
  assert.notDeepEqual(out, input);
});

test('createRng: bad input is refused', () => {
  const rng = createRng(1);
  assert.throws(() => rng.pick([]));
  assert.throws(() => rng.int(5, 3));
  assert.throws(() => rng.int(1.5, 3));
  assert.throws(() => createRng(Number.NaN));
});

test('createRng: the numbers spread out (each tenth of the range gets between 5 and 15 percent of 5000 draws)', () => {
  const rng = createRng(99), buckets = new Array<number>(10).fill(0);
  for (let i = 0; i < 5000; i += 1) buckets[Math.floor(rng.next() * 10)]! += 1;
  for (const n of buckets) assert.ok(n > 250 && n < 750, String(n));
});

// ---- Determinism and shape ----

test('generateWorld: the same seed gives byte-identical JSON, the default seed is 1, another seed differs', () => {
  assert.equal(JSON.stringify(generateWorld(1)), JSON.stringify(generateWorld(1)));
  assert.equal(JSON.stringify(generateWorld()), JSON.stringify(generateWorld(1)));
  assert.notEqual(JSON.stringify(generateWorld(2)), JSON.stringify(generateWorld(1)));
  assert.equal(JSON.stringify(generateWorld(2)), JSON.stringify(generateWorld(2)));
});

test('generateWorld: the world is plain JSON that round-trips unchanged and has the same keys as an empty world', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(world)), world);
  assert.deepEqual(Object.keys(world).sort(), Object.keys(createEmptyWorld()).sort());
});

test('interfaces: all three installed, with the enforcement labels an empty world sets', () => {
  const empty = createEmptyWorld();
  assert.deepEqual(world.interfaces.map(i => i.id), ['claude-code', 'codex', 'opencode']);
  for (const i of world.interfaces) {
    assert.equal(i.installed, 'installed');
    assert.equal(i.enforcement, empty.interfaces.find(e => e.id === i.id)?.enforcement, i.id);
  }
});

test('scopes: one global scope with an invented path and three project scopes under it', () => {
  const globals = world.scopes.filter(s => s.kind === 'global'), projects = world.scopes.filter(s => s.kind === 'project');
  assert.equal(globals.length, 1); assert.equal(projects.length, 3);
  assert.equal(globals[0]!.parentId, null);
  assert.match(globals[0]!.path, /^\/Users\/sample\//);
  for (const p of projects) { assert.equal(p.parentId, globals[0]!.id); assert.ok(p.path.startsWith(`${globals[0]!.path}/`), p.path); }
});

test('wiki pages: exactly 700, in a domain tree of 8 domains with 3 to 6 subfolders each', () => {
  assert.equal(world.wikiPages.length, 700);
  const domains = new Map<string, Set<string>>();
  for (const p of world.wikiPages) {
    const [domain, sub, ...rest] = p.folder.split('/');
    assert.ok(domain !== undefined && domain !== '' && rest.length === 0, p.folder);
    if (!domains.has(domain)) domains.set(domain, new Set());
    if (sub !== undefined) domains.get(domain)!.add(sub);
  }
  assert.equal(domains.size, 8);
  for (const [domain, subs] of domains) assert.ok(subs.size >= 3 && subs.size <= 6, `${domain} has ${subs.size}`);
});

test('wiki pages: unique ids, bytes from 600 to 24000, a few types and tags, exactly 3 joined since the last visit', () => {
  assert.equal(new Set(world.wikiPages.map(p => p.id)).size, 700);
  for (const p of world.wikiPages) { assert.ok(Number.isInteger(p.bytes) && p.bytes >= 600 && p.bytes <= 24000, `${p.id} ${p.bytes}`); assert.ok(p.title.length > 0 && p.summary.length > 0); assert.ok(p.tags.length <= 3); }
  const types = new Set(world.wikiPages.map(p => p.type)), tags = new Set(world.wikiPages.flatMap(p => p.tags));
  assert.ok(types.size >= 4 && types.size <= 8, `${types.size} types`); assert.ok(tags.size >= 8 && tags.size <= 16, `${tags.size} tags`);
  assert.equal(world.wikiPages.filter(p => p.joinedSinceVisit).length, 3);
  assert.ok(Math.max(...world.wikiPages.map(p => p.bytes)) > 18000 && Math.min(...world.wikiPages.map(p => p.bytes)) < 2000, 'the sizes use the range');
});

test('wiki links: no dangling link, no self link, no repeat, 1 to 8 links on a linked page, and two thirds of the pages have none (within 5 points)', () => {
  const ids = new Set(world.wikiPages.map(p => p.id));
  let none = 0;
  for (const p of world.wikiPages) {
    if (p.links.length === 0) { none += 1; continue; }
    assert.ok(p.links.length >= 1 && p.links.length <= 8, `${p.id} has ${p.links.length}`);
    assert.equal(new Set(p.links).size, p.links.length, `${p.id} repeats a link`);
    for (const t of p.links) { assert.ok(ids.has(t), `${p.id} links to missing ${t}`); assert.notEqual(t, p.id); }
  }
  const share = none / world.wikiPages.length * 100;
  assert.ok(Math.abs(share - 66.67) <= 5, `${share.toFixed(1)} percent have no links`);
});

test('items: about 50 owned skills, 120 library agents, 8 to 12 owned agents, and tools of each kind, all with unique ids', () => {
  assert.equal(new Set(world.items.map(i => i.id)).size, world.items.length);
  const ownedSkills = skills.filter(s => s.library === null);
  assert.ok(ownedSkills.length >= 50 && ownedSkills.length <= 56, `${ownedSkills.length} owned skills`);
  assert.equal(agents.filter(a => a.library !== null).length, 120);
  const owned = agents.filter(a => a.library === null).length;
  assert.ok(owned >= 8 && owned <= 12, `${owned} owned agents`);
  assert.ok(tools.filter(t => t.toolKind === 'mcp').length >= 2); assert.ok(tools.filter(t => t.toolKind === 'prompt').length >= 2); assert.ok(tools.filter(t => t.toolKind === 'hook').length >= 1);
  assert.ok(world.items.some(i => i.kind === 'context-slice'));
});

test('items: each has found-at entries with an invented path per interface, a matching hash, and a known scope', () => {
  const scopeIds = new Set(world.scopes.map(s => s.id));
  for (const item of world.items) {
    assert.ok(scopeIds.has(item.scopeId), item.id);
    if (item.kind === 'context-slice') continue;
    assert.ok(item.foundAt.length >= 1, `${item.id} was found nowhere`);
    assert.equal(new Set(item.foundAt.map(f => f.interface)).size, item.foundAt.length, `${item.id} repeats an interface`);
    for (const f of item.foundAt) { assert.match(f.path, /^\/Users\/sample\//, f.path); assert.equal(f.contentHash, hashText(f.text), f.path); assert.ok(f.text.length > 0); }
  }
  const ownedSkills = skills.filter(s => s.library === null);
  assert.ok(ownedSkills.some(s => s.foundAt.length === 1) && ownedSkills.some(s => s.foundAt.length >= 2), 'skills are in one place or in several');
  const first = ownedSkills.find(s => s.foundAt.length >= 2 && s.id !== CASE_IDS.tripleSkill)!;
  assert.equal(new Set(first.foundAt.map(f => f.contentHash)).size, 1, 'a skill found twice usually has one text');
});

test('agents: owned agents name skills, tools with an access class, and some a slice; every reference exists', () => {
  const owned = agents.filter(a => a.library === null);
  assert.ok(owned.some(a => a.definition.skillIds.length > 0));
  assert.ok(owned.some(a => a.definition.toolAttachments.length > 0));
  assert.ok(owned.some(a => a.definition.sliceId !== undefined));
  assert.ok(owned.some(a => a.extras.length > 0));
  const sliceIds = new Set(world.slices.map(s => s.id));
  for (const a of agents) {
    for (const id of a.definition.skillIds) assert.equal(byId(id)?.kind, 'skill', `${a.id} -> ${id}`);
    for (const t of a.definition.toolAttachments) { assert.equal(byId(t.toolId)?.kind, 'tool', `${a.id} -> ${t.toolId}`); assert.ok(t.access === 'read-only' || t.access === 'read-write'); }
    if (a.definition.sliceId !== undefined) assert.ok(sliceIds.has(a.definition.sliceId));
  }
});

test('slices: 2 or 3, with different rules (folder only, types and tags, seeds with hops), each matching something and no more than the whole', () => {
  assert.ok(world.slices.length === 2 || world.slices.length === 3);
  const [folderOnly, typesTags, seedsHops] = world.slices;
  assert.ok(folderOnly!.rule.folders.length > 0 && folderOnly!.rule.pageTypesAndTags.types.length === 0 && folderOnly!.rule.pageTypesAndTags.tags.length === 0 && folderOnly!.rule.linksFromSeeds === null);
  assert.ok(typesTags!.rule.folders.length === 0 && (typesTags!.rule.pageTypesAndTags.types.length > 0 || typesTags!.rule.pageTypesAndTags.tags.length > 0));
  if (seedsHops !== undefined) { assert.ok(seedsHops.seeds.length > 0); assert.ok(seedsHops.rule.linksFromSeeds?.hops === 1 || seedsHops.rule.linksFromSeeds?.hops === 2); }
  for (const s of world.slices) {
    const n = matchPages(s.rule, s.seeds, world.wikiPages).size;
    assert.ok(n > 0 && n < 700, `${s.id} matches ${n}`);
    assert.ok(world.items.some(i => i.kind === 'context-slice' && i.sliceId === s.id), `${s.id} has no item`);
  }
});

test('versions: an empty array, because the store creates them', () => {
  assert.deepEqual(world.versions, []);
});

test('validateWorld: a generated world has no problem, for several seeds', () => {
  for (const seed of [1, 2, 3, 17, 4242]) assert.deepEqual(validateWorld(generateWorld(seed)), [], `seed ${seed}`);
  assert.deepEqual(validateWorld(world), []);
});

test('validateWorld: it names a dangling link, a repeated id, a missing scope, a bad hash and a missing reference', () => {
  const clone = (): World => structuredClone(world) as World;
  const edit = (change: (w: { -readonly [K in keyof World]: World[K] }) => void): string[] => { const w = clone() as { -readonly [K in keyof World]: World[K] }; change(w); return validateWorld(w); };
  assert.ok(edit(w => { (w.wikiPages[0]!.links as string[]).push('no-such-page'); }).length > 0);
  assert.ok(edit(w => { (w.wikiPages as unknown[]).push(w.wikiPages[0]); }).length > 0);
  assert.ok(edit(w => { (w.items as unknown[]).push(w.items[0]); }).length > 0);
  assert.ok(edit(w => { (w.items[0]! as { scopeId: string }).scopeId = 'no-scope'; }).length > 0);
  assert.ok(edit(w => { (w.items.find(i => i.foundAt.length > 0)!.foundAt[0] as { contentHash: string }).contentHash = 'bad'; }).length > 0);
  assert.ok(edit(w => { (w.overrides as unknown[]).push({ scopeId: 'scope-none', itemId: 'item-none', mode: 'hide' }); }).length > 0);
  assert.ok(edit(w => { (w.slices[0]!.seeds as string[]).push('no-such-page'); }).length > 0);
  assert.ok(edit(w => { (w.libraries as unknown[]).length = 0; }).length > 0);
  assert.ok(edit(w => { (w.scopes as unknown[]).push({ id: 'second-global', kind: 'global', name: 'x', parentId: null, path: '/x' }); }).length > 0);
  assert.ok(validateWorld(createEmptyWorld()).length === 0, 'an empty world is valid');
});

// ---- The four planted cases ----

test('case (a): one skill found in three interfaces with three different texts and three different hashes', () => {
  const s = byId(CASE_IDS.tripleSkill) as SkillItem;
  assert.equal(s.kind, 'skill'); assert.equal(s.library, null);
  assert.deepEqual(s.foundAt.map(f => f.interface).sort(), ['claude-code', 'codex', 'opencode']);
  assert.equal(new Set(s.foundAt.map(f => f.text)).size, 3);
  assert.equal(new Set(s.foundAt.map(f => f.contentHash)).size, 3);
  assert.equal(new Set(s.foundAt.map(f => f.path)).size, 3);
  assert.equal(skills.filter(x => x.foundAt.length === 3 && new Set(x.foundAt.map(f => f.contentHash)).size === 3).length, 1, 'only one such skill');
});

test('case (b): a library item with a newer version (and its source), and a project override that hides one global skill', () => {
  const item = byId(CASE_IDS.newerLibraryItem)!;
  assert.ok(item.library !== null && item.library.newerVersion !== undefined);
  assert.equal(item.library.library, CASE_IDS.newerLibrary);
  const source = world.libraries.find(l => l.id === CASE_IDS.newerLibrary)!;
  assert.equal(source.name, 'Evergreen Kit');
  assert.equal(source.newerVersion, item.library.newerVersion);
  assert.notEqual(source.newerVersion, source.installedVersion);
  assert.equal(world.items.filter(i => i.library?.newerVersion !== undefined).length, 1, 'one item only');
  const hid = world.overrides.filter(o => o.mode === 'hide' && o.itemId === CASE_IDS.hiddenSkill);
  assert.equal(hid.length, 1);
  assert.equal(hid[0]!.scopeId, CASE_IDS.hidingScope);
  assert.equal(world.scopes.find(s => s.id === hid[0]!.scopeId)?.kind, 'project');
  const target = byId(CASE_IDS.hiddenSkill)!;
  assert.equal(target.kind, 'skill'); assert.equal(target.scopeId, world.scopes.find(s => s.kind === 'global')!.id);
});

test('case (c): a hook that runs code', () => {
  const h = byId(CASE_IDS.hook) as HookTool;
  assert.equal(h.kind, 'tool'); assert.equal(h.toolKind, 'hook'); assert.equal(h.runsCode, true);
  assert.ok(h.foundAt.length >= 1);
  for (const t of tools.filter(x => x.toolKind === 'hook')) assert.equal((t as HookTool).runsCode, true);
});

test('case (d): one MCP tool whose secret is missing, and another whose secret is present; no secret value anywhere', () => {
  const missing = byId(CASE_IDS.mcpMissing) as McpTool, present = byId(CASE_IDS.mcpPresent) as McpTool;
  assert.equal(missing.toolKind, 'mcp'); assert.equal(missing.secret?.state, 'missing');
  assert.equal(present.toolKind, 'mcp'); assert.equal(present.secret?.state, 'present');
  assert.equal(tools.filter(t => t.toolKind === 'mcp' && t.secret?.state === 'missing').length, 1);
  for (const t of tools) if (t.toolKind === 'mcp' && t.secret !== null) { assert.deepEqual(Object.keys(t.secret).sort(), ['kind', 'name', 'state']); assert.match(t.secret.name, /^[A-Z][A-Z_]*$/); }
  assert.ok(agents.some(a => a.definition.toolAttachments.some(t => t.toolId === CASE_IDS.mcpMissing)), 'an agent uses the tool with the missing secret');
});

test('the case ids are fixed text, so every other seed keeps the same ids', () => {
  for (const seed of [2, 9]) {
    const w = generateWorld(seed);
    for (const id of [CASE_IDS.tripleSkill, CASE_IDS.newerLibraryItem, CASE_IDS.hiddenSkill, CASE_IDS.hook, CASE_IDS.mcpMissing, CASE_IDS.mcpPresent]) assert.ok(w.items.some(i => i.id === id), `${id} in seed ${seed}`);
    assert.ok(w.scopes.some(s => s.id === CASE_IDS.hidingScope)); assert.ok(w.libraries.some(l => l.id === CASE_IDS.newerLibrary));
  }
});

// ---- Invented names only ----

const KNOWN = new Set(Object.values(SAMPLE_WORDS).flat().flatMap(w => w.toLowerCase().split(/[^a-z]+/)).filter(w => w !== ''));
const tokens = (name: string): string[] => name.toLowerCase().split(/[^a-z]+/).filter(w => w !== '');

test('every name in the world is made of words from the invented lists', () => {
  const names: string[] = [];
  for (const i of world.items) { names.push(i.name); if (i.kind === 'agent') names.push(i.definition.name, i.definition.role); }
  for (const s of world.scopes) names.push(s.name);
  for (const s of world.slices) names.push(s.name);
  for (const l of world.libraries) names.push(l.name);
  for (const p of world.wikiPages) { names.push(p.title, p.folder, p.type, ...p.tags); }
  for (const name of names) for (const t of tokens(name)) assert.ok(KNOWN.has(t), `"${t}" in "${name}" is not in the invented lists`);
});

// The real names are kept out of this file on purpose: the list holds the sha256 of each lowercased word, so the repository does not spell them out.
const REAL_WORD_HASHES = new Set([
  'b0d95c5ce67c5daa6f260599c718ee0f11e8a2908d1f77d7f43c1024d41a3551',
  '7e5d4325a44714fc86a9b6989e41e966a7297bfe7e913c15fb9ab19588e33d61',
  '3a4ad37e305ff3bb775fb38a93345aa1f29961fcf88e9415a093d9e6eec8c65a',
  '23eeb69c681dfdb8eacc7ce9e55ea007d41c2dd5273848c597f1b3e49dbd86e1',
  'f300f10844ecfc75f12a0deb789ce9ddb41209c38307e65436e81d43ad4658d9',
  '333cf441e801498cbdf69da7c8388373813ce38f0b1f330f8480b81a97aefa9b',
  '3b9c2144ccfa84fcb90406914c128f88f7bd23cd42161c591ec6fb9258e8d8a2',
  '177a7ea3611fe6b138557deaf44941614b66c0ece1766308044c8b65c8ba2123',
  'b5679ea7383b47df1553f6c89e6d73d26aab70e5ea2b4344fed5c66553ef4a67',
  'c70eca6b0f88f44d81a41311647e50fda1ac454ec04ffd442b0eb4743a993131',
  '7d3194f79e645c42e4396dda38be04766810ec6a00d00aced3ffc2a0a1f1a9ef',
  '2f7875656a69466cfdff4d57082ce7bbb1ef49284e5b5d26de2d0e0662e0ba31',
  '5b79d0d574eedd091c02692026ecfa1c617af2432c0a9b401e623e67d78a179c',
  'c0b0109d9439de57fe3cf03abeccbc52f4c98170c732d3b69af5e6395ace574e',
  '1b250ea199bec73d392caad39d1167d6edc43c81f20edead86eea52c52b94fc1',
  '14fa01effbe8567b0cea4798dea7bf85b3b598777878e7e971401d24f56ab8d3',
]);
const realWords = (text: string): string[] => (text.match(/\w+/g) ?? []).filter(w => REAL_WORD_HASHES.has(createHash('sha256').update(w.toLowerCase()).digest('hex')));

test('the invented lists hold no real name from the project, the practice or its clients', () => {
  for (const [key, list] of Object.entries(SAMPLE_WORDS)) for (const w of list) assert.deepEqual(realWords(w), [], `${key}: ${w}`);
  assert.deepEqual(realWords(JSON.stringify(world)), []);
});

test('the sample world is not rendered with a secret value, an e-mail address, a web address or a home folder other than /Users/sample', () => {
  const text = JSON.stringify(world);
  assert.doesNotMatch(text, /https?:\/\/|@[a-z0-9-]+\.[a-z]{2,}|\bsk-[A-Za-z0-9]{8}|\/Users\/(?!sample)|\/home\//);
});

// ---- The source files stay pure ----

test('shared/world/rng.ts and sample.ts use no file, no clock, no random number, no markup string and no bridge', () => {
  for (const file of ['rng.ts', 'sample.ts']) {
    const code = readFileSync(join(DESKTOP, 'shared', 'world', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /node:|Math\.random|Date\.|\bnew Date\b|innerHTML|window\.bowerloom|\beval\(/, file);
    for (const m of code.matchAll(/^import[\s\S]*?;$/gm)) assert.match(m[0], /from '\.\/(types|rng|slicerule|words)\.js';$/, `${file}: ${m[0]}`);
  }
});
