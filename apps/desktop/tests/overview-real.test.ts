// The real reader feeds the Overview (Task 2 lane G). A made-up home folder is built in a temporary folder and read with the real scanner; the home folder of the
// person running the test is never read. The first test is the check the plan asks for: does the reader already merge one skill held in the home and in two projects?
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace } from '../shared/real/types.js';
import { folderLabelOf, realToHarnessState } from '../shared/harness/real-map.js';
import { overviewOf } from '../shared/harness/overview.js';
import type { HarnessState } from '../shared/harness/types.js';
import { buildFixture } from './fixtures-real/build.js';
import { tempDir } from './support.js';

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const skill = (name: string, body: string): string => `---\nname: ${name}\ndescription: ${name} does one job.\n---\n\n${body}\n`;
const NOW_MS = Date.UTC(2026, 9, 26);

async function read(home: string, picked: readonly string[]): Promise<{ state: HarnessState; places: readonly RealPlace[] }> {
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places];
  for (const dir of picked) places.push(...(await scanner.addFolder(dir)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return { state: realToHarnessState(buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places), places };
}

/** A home with one skill in the home folder and the same skill in two projects, a different skill in a third, an agent that names a skill, a hook and a connection. */
function build(t: TestContext): { home: string; work: string } {
  const home = join(tempDir(t), 'home'), work = join(home, 'work');
  put(join(home, '.claude', 'skills', 'check-totals', 'SKILL.md'), skill('Check totals', 'Add each column.'));
  put(join(home, '.claude', 'skills', 'home-only', 'SKILL.md'), skill('Home only', 'Only here.'));
  put(join(home, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reads a change.\nmodel: sonnet\nskills: [check-totals]\n---\nReview.\n');
  put(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: './format.sh' }] }] } }));
  put(join(home, '.claude.json'), JSON.stringify({ mcpServers: { tracker: { command: 'node', args: ['server.js'] } } }));
  put(join(work, 'alpha', '.claude', 'skills', 'check-totals', 'SKILL.md'), skill('Check totals', 'Add each column.'));
  put(join(work, 'beta', '.claude', 'skills', 'check-totals', 'SKILL.md'), skill('Check totals', 'Add each column.'));
  put(join(work, 'gamma', '.claude', 'skills', 'check-totals', 'SKILL.md'), skill('Check totals', 'Add each column twice.'));
  return { home, work };
}

test('the reader does not merge a skill held in the home folder and in two projects: each place keeps its own part, equal text gives an equal content hash, so the Overview merges by hash', async t => {
  const { home, work } = build(t), { state } = await read(home, [work]);
  const totals = state.parts.filter(p => p.kind === 'skill' && p.name === 'Check totals');
  assert.equal(totals.length, 4, 'one part for each place that holds it');
  assert.equal(new Set(totals.map(p => p.id)).size, 4);
  const hashes = totals.map(p => p.contentHash);
  assert.ok(hashes.every(h => typeof h === 'string' && h !== ''));
  assert.equal(new Set(hashes).size, 2, 'three copies read the same, the fourth differs');
  const o = overviewOf(state, []);
  assert.equal(o.sharedKeys.size, 1);
  const nodes = [...o.sharedKeys.values()][0]!;
  assert.equal(nodes.length, 3);
  const holders = new Set(nodes.map(id => id.slice(0, id.indexOf('/'))));
  assert.equal(holders.size, 3, 'three different places');
  for (const g of o.groups) for (const n of g.nodes) assert.equal(n.sharedWith.length > 0, nodes.includes(n.id), n.id);
  const copy = o.groups.flatMap(g => g.nodes).find(n => nodes.includes(n.id))!;
  assert.equal(copy.sharedWith.length, 2, 'also in 2 places');
});

test('every source gets a scope and a ~ label; the home folder is ~ and a project is under it', async t => {
  const { home, work } = build(t), { state } = await read(home, [work]);
  assert.ok(state.sources.length >= 4);
  for (const s of state.sources) { assert.ok(s.scope === 'home' || s.scope === 'project', s.id); assert.equal(typeof s.label, 'string', s.id); assert.ok(s.label!.startsWith('~') , `${s.id}: ${s.label}`); }
  const homeSources = state.sources.filter(s => s.scope === 'home');
  assert.ok(homeSources.length >= 1); assert.ok(homeSources.every(s => s.label === '~'));
  const labels = state.sources.filter(s => s.scope === 'project').map(s => s.label).sort();
  assert.deepEqual([...new Set(labels)], ['~/work/alpha', '~/work/beta', '~/work/gamma']);
  const o = overviewOf(state, []);
  assert.equal(o.groups[0]!.scope, 'home'); assert.equal(o.groups[0]!.label, '~');
  assert.deepEqual(o.groups.filter(g => g.scope === 'project').map(g => g.label).sort(), labels);
  // The temporary folder, which holds the whole path, appears nowhere in the model.
  assert.ok(!JSON.stringify(o).includes(home), 'no full path');
  assert.doesNotMatch(JSON.stringify(o), /\/private\/|\/var\/|\/tmp\//);
});

test('a tool carries its kind from the reader: a connection is mcp, a hook is hook and runs code', async t => {
  const { home, work } = build(t), { state } = await read(home, [work]);
  const tools = state.parts.filter(p => p.kind === 'tool');
  assert.ok(tools.every(p => p.toolKind === 'mcp' || p.toolKind === 'prompt' || p.toolKind === 'hook'));
  assert.ok(tools.some(p => p.toolKind === 'mcp') && tools.some(p => p.toolKind === 'hook'));
  assert.ok(state.parts.filter(p => p.kind !== 'tool').every(p => p.toolKind === undefined));
  const nodes = overviewOf(state, []).groups.flatMap(g => g.nodes).filter(n => n.kind === 'tool');
  assert.deepEqual(nodes.filter(n => n.runsCode === true).map(n => n.toolKind), ['hook']);
  assert.ok(nodes.some(n => n.toolKind === 'mcp' && n.runsCode === undefined));
});

test('an agent that names a skill gets an edge to it in its own place only', async t => {
  const { home, work } = build(t), { state } = await read(home, [work]);
  const o = overviewOf(state, []);
  const holder = o.groups.find(g => g.nodes.some(n => n.kind === 'agent' && n.name.toLowerCase() === 'reviewer'))!;
  assert.equal(holder.scope, 'home');
  const agent = holder.nodes.find(n => n.kind === 'agent')!, target = holder.nodes.find(n => n.kind === 'skill' && n.name === 'Check totals')!;
  assert.deepEqual(holder.edges.filter(e => e.from === agent.id).map(e => e.to), [target.id]);
  for (const g of o.groups) for (const e of g.edges) assert.ok(e.from.startsWith(`${g.id}/`) && e.to.startsWith(`${g.id}/`));
});

test('the made-up fixture of the reader tests also gives sources with scopes, and a part keeps a hash only when the reader read a file', async t => {
  const f = buildFixture(); t.after(() => f.cleanup());
  const { state } = await read(f.home, [f.work]);
  assert.ok(state.sources.every(s => s.scope !== undefined && s.label !== undefined));
  for (const p of state.parts) {
    if (p.kind === 'context') assert.equal(p.contentHash, undefined, p.id); else assert.match(p.contentHash ?? '', /^[0-9a-f]{16}$/, p.id);
  }
  // The fixture holds one skill in the home (two programs) and in a work folder with equal text: the Overview finds it shared.
  const o = overviewOf(state, []);
  assert.ok([...o.sharedKeys.values()].some(ids => ids.length >= 2));
  assert.ok(!JSON.stringify(o).includes(f.root), 'no full path');
});

test('a folder outside the home folder keeps only its last name in the label', () => {
  assert.equal(folderLabelOf('~'), '~'); assert.equal(folderLabelOf('~/Projects/alpha'), '~/Projects/alpha');
  assert.equal(folderLabelOf('/Volumes/Disk/work/alpha'), '…/alpha'); assert.equal(folderLabelOf('C:\\work\\beta'), '…/beta'); assert.equal(folderLabelOf(''), '…');
});
