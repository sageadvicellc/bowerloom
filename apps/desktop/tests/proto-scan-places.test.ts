// The scan, step one: places and counts, worked out from the world's foundAt paths. Pure, deterministic, and it never reads a file's text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLACE_GROUPS, buildScan, placeIdOf } from '../shared/proto/scan-places.js';
import type { ScanPlace } from '../shared/proto/scan-places.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';
import type { HarnessItem, World } from '../shared/proto/types.js';
import { copy, found, skill } from './proto-testworld.js';

const world = generateWorld(1);
const scan = buildScan(world);

test('the scan is deterministic: the same world gives the same places in the same order', () => {
  assert.deepEqual(buildScan(generateWorld(1)), scan);
  assert.deepEqual(buildScan(world), scan);
});

test('it changes nothing and an empty world has no places', () => {
  const before = copy(world);
  buildScan(world);
  assert.deepEqual(world, before);
  assert.deepEqual(buildScan(createEmptyWorld()), []);
});

test('places come in the group order, and every group is one of the five', () => {
  const order = PLACE_GROUPS.map(g => g.id);
  assert.deepEqual(order, ['claude-code', 'codex', 'opencode', 'older', 'projects']);
  assert.deepEqual(PLACE_GROUPS.map(g => g.label), ['Claude Code', 'Codex', 'OpenCode', 'Older Bowerloom layouts', 'Project folders']);
  let last = -1;
  for (const p of scan) { const at = order.indexOf(p.group); assert.ok(at >= last, `${p.path} is out of order`); last = at; }
  assert.ok(new Set(scan.map(p => p.id)).size === scan.length, 'ids are unique');
  for (const g of ['claude-code', 'codex', 'opencode', 'projects']) assert.ok(scan.some(p => p.group === g), g);
});

test('the counts match an independent count of the foundAt paths', () => {
  const folder = { 'claude-code': '.claude', codex: '.codex', opencode: '.opencode', hermes: '.hermes', bowerloom: '.bowerloom' } as const;
  const expectedPlace = (path: string, face: keyof typeof folder): string => {
    const cache = path.match(/^(.*\/\.cache\/[^/]+\/[^/]+)\//);
    if (cache) return cache[1]!;
    const marked = path.match(/^(.*?\/\.(?:claude|codex|opencode|bowerloom))\//);
    return marked ? marked[1]! : `${path.slice(0, path.lastIndexOf('/'))}/${folder[face]}`;
  };
  const places = new Map<string, Set<HarnessItem>>();
  for (const item of world.items) for (const f of item.foundAt) {
    const id = expectedPlace(f.path, f.interface);
    places.set(id, (places.get(id) ?? new Set()).add(item));
  }
  assert.deepEqual(scan.map(p => p.id).sort(), [...places.keys()].sort());
  for (const p of scan) {
    const items = [...places.get(p.id)!];
    assert.equal(p.skills, items.filter(i => i.kind === 'skill').length, `${p.path} skills`);
    assert.equal(p.agents, items.filter(i => i.kind === 'agent').length, `${p.path} agents`);
    assert.equal(p.tools, items.filter(i => i.kind === 'tool').length, `${p.path} tools`);
    assert.deepEqual([...p.itemIds].sort(), items.map(i => i.id).sort(), `${p.path} items`);
  }
  // A context slice is found nowhere, so it is in no place.
  const listed = new Set(scan.flatMap(p => p.itemIds));
  for (const item of world.items) assert.equal(listed.has(item.id), item.foundAt.length > 0, item.id);
});

test('the library cache is one place with every library agent in it, in the Claude Code group', () => {
  const lib = scan.filter(p => p.library);
  assert.equal(lib.length, 1);
  assert.equal(lib[0]!.group, 'claude-code');
  assert.equal(lib[0]!.agents, 120);
  assert.equal(lib[0]!.skills + lib[0]!.tools, 0);
  assert.match(lib[0]!.label, /Evergreen Kit 2\.3\.0/);
  assert.equal(lib[0]!.path, '/Users/sample/.cache/evergreen-kit/2.3.0');
  const claude = scan.filter(p => p.group === 'claude-code');
  assert.equal(claude[claude.length - 1], lib[0], 'settings folders come before the cache');
});

test('a global settings folder and a project settings folder are told apart', () => {
  const global = scan.find(p => p.path === '/Users/sample/Studio/.claude')!;
  assert.equal(global.group, 'claude-code');
  assert.equal(global.label, 'Studio: .claude');
  // A root-level .mcp.json belongs to the .claude place beside it, and opencode.json to the .opencode place.
  assert.ok(global.itemIds.includes(CASE_IDS.mcpMissing));
  assert.ok(scan.find(p => p.path === '/Users/sample/Studio/.opencode')!.itemIds.includes(CASE_IDS.mcpPresent));
  const project = scan.find(p => p.path === '/Users/sample/Studio/reedmarsh/.claude')!;
  assert.equal(project.group, 'projects');
  assert.equal(project.label, 'Reedmarsh: .claude');
  assert.ok(!scan.some(p => p.group !== 'projects' && p.path.includes('/reedmarsh/')));
});

test('a path with a .bowerloom folder is an older layout', () => {
  const w: World = { ...createEmptyWorld(), items: [{ ...skill('old', 'Old one'), foundAt: [found('claude-code', '/Users/sample/Studio/.bowerloom/skills/old/SKILL.md', 'text')] }] };
  const [place, ...rest] = buildScan(w) as [ScanPlace, ...ScanPlace[]];
  assert.equal(rest.length, 0);
  assert.equal(place.group, 'older');
  assert.equal(place.groupLabel, 'Older Bowerloom layouts');
  assert.equal(place.path, '/Users/sample/Studio/.bowerloom');
  assert.equal(place.skills, 1);
});

test('placeIdOf agrees with the scan for every found path', () => {
  const ids = new Set(scan.map(p => p.id));
  for (const item of world.items) for (const f of item.foundAt) assert.ok(ids.has(placeIdOf(world, item, f)), f.path);
});

test('the scan shows places and counts only: no file text is in it', () => {
  const json = JSON.stringify(scan);
  for (const item of world.items) for (const f of item.foundAt) assert.ok(!json.includes(f.text.slice(0, 40)), `text of ${item.id} leaked`);
  for (const p of scan) assert.deepEqual(Object.keys(p).sort(), ['agents', 'group', 'groupLabel', 'id', 'itemIds', 'label', 'library', 'path', 'skills', 'tools']);
});
