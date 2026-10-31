// The ids of things read from files: long enough that two files do not meet by chance, and a second read ("Find more") never overwrites a different file that happens to have the same id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { validateWorld } from '../shared/world/sample.js';
import type { AgentItem, HarnessItem, SkillItem } from '../shared/world/types.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { mergeResults } from '../shared/real/merge-result.js';
import type { RealResult } from '../shared/real/types.js';

const NOW = Date.UTC(2026, 9, 26);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

async function readHome(t: TestContext): Promise<RealResult> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-ids-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), claude = join(home, '.claude');
  put(join(claude, 'agents', 'ledger-keeper.md'), '---\nname: Ledger keeper\ndescription: Keeps the ledger.\nskills: [pantry-check]\n---\nKeep it.\n');
  put(join(claude, 'skills', 'pantry-check', 'SKILL.md'), '---\nname: Pantry check\ndescription: Lists what is low.\n---\nLook.\n');
  put(join(home, 'proj', 'notes', 'one.md'), '---\ntitle: One\n---\nText.\n');
  const scanner = createScanner({ home }), found = await scanner.discover(), places = [...found.places, ...(await scanner.addFolder(join(home, 'proj'))).places];
  const batch = await scanner.read(places.map(p => p.id));
  return buildRealResult(batch.reads, batch.tally, { nowMs: NOW, foldExtraApps: true });
}

/** A copy of a result with the file of one skill at another path: the same id for a different file, as a crafted pair of files could make. */
function withSkillMoved(result: RealResult, name: string): RealResult {
  const copy: RealResult = JSON.parse(JSON.stringify(result));
  const items = copy.world.items.map(i => (i.kind === 'skill' && i.name === name ? { ...i, foundAt: i.foundAt.map(f => ({ ...f, path: `${f.path}.other` })) } : i)) as HarnessItem[];
  return { ...copy, world: { ...copy.world, items } };
}

test('an id carries at least 16 hex digits of the hash, for an item, a page, a set of notes and a folder', async t => {
  const { world } = await readHome(t);
  for (const i of world.items.filter(x => x.kind !== 'context-slice')) assert.match(i.id, /^real-(skill|agent|tool)-[0-9a-f]{16}(-\d+)?$/, i.name);
  for (const p of world.wikiPages) assert.match(p.id, /^real-page-[0-9a-f]{16}(-\d+)?$/);
  for (const s of world.slices) assert.match(s.id, /^real-notes-[0-9a-f]{16}(-[0-9a-f]{16})?$/);
  for (const s of world.scopes.filter(x => x.kind !== 'global')) assert.match(s.id, /^scope-real-[0-9a-f]{16}$/);
});

test('the same file read again is one item (the newer read wins), and nothing is added', async t => {
  const a = await readHome(t), merged = mergeResults(a, JSON.parse(JSON.stringify(a)) as RealResult);
  assert.equal(merged.world.items.length, a.world.items.length);
  assert.equal(merged.world.wikiPages.length, a.world.wikiPages.length);
  assert.equal(merged.world.slices.length, a.world.slices.length);
  assert.deepEqual(merged.world.items.map(i => i.id).sort(), a.world.items.map(i => i.id).sort());
});

test('a different file with the same id is kept next to the first, with an id of its own, and what its read linked to follows it', async t => {
  const a = await readHome(t), b = withSkillMoved(a, 'Pantry check');
  const merged = mergeResults(a, b), items = merged.world.items;
  const skills = items.filter((i): i is SkillItem => i.kind === 'skill' && i.name === 'Pantry check');
  assert.equal(skills.length, 2, 'both files stay');
  assert.equal(new Set(items.map(i => i.id)).size, items.length, 'every id is used once');
  assert.notEqual(skills[0]!.id, skills[1]!.id);
  assert.deepEqual(skills.map(s => s.foundAt[0]!.path).sort(), [a.world.items.find(i => i.name === 'Pantry check')!.foundAt[0]!.path, `${a.world.items.find(i => i.name === 'Pantry check')!.foundAt[0]!.path}.other`].sort());
  const first = a.world.items.find(i => i.name === 'Pantry check')!;
  assert.equal(skills.some(s => s.id === first.id && s.foundAt[0]!.path === first.foundAt[0]!.path), true, 'the first file keeps its id');
  const moved = skills.find(s => s.id !== first.id)!;
  assert.equal(merged.ages[moved.id]?.length, first.foundAt.length, 'the ages follow the new id');
  const agent = items.find((i): i is AgentItem => i.kind === 'agent')!;
  assert.deepEqual(agent.definition.skillIds, [moved.id], 'the agent of the newer read links to the skill of that read');
  assert.deepEqual(validateWorld(merged.world), []);
  assert.equal(merged.counts.skills, 2);
});
