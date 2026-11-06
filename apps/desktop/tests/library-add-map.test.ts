// Library Add (issue 148): a part the Library adds to a folder's `.bowerloom` (a skill copied in, the Notes keeper from the kit, an attached notes folder) is in the Library after the next read.
// It runs on small homes made here. It never reads the real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createScanner } from '../main/real-scan.js';
import { buildRealResult } from '../shared/real/map-world.js';
import type { RealPlace, RealResult } from '../shared/real/types.js';
import { realToHarnessState } from '../shared/harness/real-map.js';
import { overviewOf } from '../shared/harness/overview.js';
import { harnessesHolding, usedCount } from '../shared/harness/status.js';
import { unreadableHarnesses } from '../shared/harness/library-add.js';
import { tempDir } from './support.js';

const NOW_MS = Date.UTC(2026, 10, 6);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const harness = (id: string): string => json({ format: 'bowerloom/harness/v1beta1', id, description: 'A harness.', engines: [{ id: 'claude-code' }], parts: { skills: 'skills/', subagents: 'agents/' } });
const skill = (name: string): string => `---\nname: ${name}\ndescription: Does ${name}.\n---\nBody.\n`;
const agent = (name: string): string => `---\nname: ${name}\ndescription: Is ${name}.\n---\nBody.\n`;

async function readHome(home: string, folders: readonly string[]): Promise<{ result: RealResult; places: readonly RealPlace[] }> {
  const scanner = createScanner({ home });
  const found = await scanner.discover();
  const places: RealPlace[] = [...found.places];
  for (const dir of folders) places.push(...(await scanner.addFolder(dir)).places);
  const batch = await scanner.read(places.map(p => p.id));
  return { result: buildRealResult(batch.reads, batch.tally, { nowMs: NOW_MS, foldExtraApps: true }), places };
}
const stateOf = async (t: TestContext, setup: (home: string) => void) => {
  const home = tempDir(t, 'bowerloom-add-map-');
  setup(home);
  const read = await readHome(home, [join(home, 'work')]);
  return realToHarnessState(read.result, read.places);
};

test('a skill, the Notes keeper and an attached notes folder in a folder\'s .bowerloom are all in the Library after a read', async t => {
  const state = await stateOf(t, home => {
    const dir = join(home, 'work', 'proj', '.bowerloom');
    put(join(dir, 'harness.json'), harness('proj'));
    put(join(dir, 'skills', 'summarize', 'SKILL.md'), skill('summarize'));
    put(join(dir, 'agents', 'wiki-keeper.md'), agent('wiki-keeper'));
    put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
  });
  const library = state.parts.filter(p => p.inLibrary);
  assert.ok(library.some(p => p.kind === 'skill' && p.name === 'summarize'), 'the skill');
  assert.ok(library.some(p => p.kind === 'agent' && p.name === 'wiki-keeper'), 'the agent');
  const notes = library.find(p => p.kind === 'context' && p.name === 'journal');
  assert.ok(notes, 'the attached notes folder');
  assert.match(notes.source, /proj/, 'it says which folder holds it');
  assert.equal(new Set(state.parts.map(p => p.id)).size, state.parts.length, 'every id is used once');
});

test('two folders that each attach a notes folder keep two parts with two ids', async t => {
  const state = await stateOf(t, home => {
    for (const name of ['one', 'two']) {
      const dir = join(home, 'work', name, '.bowerloom');
      put(join(dir, 'harness.json'), harness(name));
      put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
    }
  });
  const notes = state.parts.filter(p => p.kind === 'context' && p.name === 'journal');
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0]!.id, notes[1]!.id);
});

test('the Overview still lists a folder\'s notes and agent once', async t => {
  const state = await stateOf(t, home => {
    const dir = join(home, 'work', 'proj', '.bowerloom');
    put(join(dir, 'harness.json'), harness('proj'));
    put(join(dir, 'agents', 'wiki-keeper.md'), agent('wiki-keeper'));
    put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
  });
  const nodes = overviewOf(state, []).groups.flatMap(g => g.nodes);
  assert.equal(nodes.filter(n => n.name === 'journal').length, 1);
  assert.equal(nodes.filter(n => n.name === 'wiki-keeper').length, 1);
});

test('a folder with no harness adds nothing of this kind', async t => {
  const state = await stateOf(t, home => { put(join(home, 'work', 'plain', '.claude', 'skills', 'a', 'SKILL.md'), skill('a')); });
  assert.equal(state.parts.filter(p => p.kind === 'context').length, 0);
});

test('a part from a folder\'s settings says so, was not read, and counts the folder\'s harness as holding it', async t => {
  const state = await stateOf(t, home => {
    const dir = join(home, 'work', 'proj', '.bowerloom');
    put(join(dir, 'harness.json'), harness('proj'));
    put(join(dir, 'agents', 'wiki-keeper.md'), agent('wiki-keeper'));
    put(join(dir, 'skills', 'summarize', 'SKILL.md'), skill('summarize'));
    put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
  });
  for (const name of ['wiki-keeper', 'journal']) {
    const part = state.parts.find(p => p.name === name)!;
    assert.equal(part.fromHarness, 'proj', name);
    assert.equal(part.fileText, '', 'its file was not read');
    assert.equal(harnessesHolding(state, part.id).length, 0, 'no harness the person made holds it');
    assert.equal(usedCount(state, part), 1, 'the folder\'s own harness holds it');
  }
  const skillOnly = state.parts.filter(p => p.fromHarness === undefined);
  assert.ok(skillOnly.some(p => p.kind === 'skill' && p.name === 'summarize'), 'the fixture holds a skill the reader found itself');
  for (const p of skillOnly) assert.equal(usedCount(state, p), harnessesHolding(state, p.id).length);
});

test('a folder outside the home folder never shows as an absolute path', async t => {
  const home = tempDir(t, 'bowerloom-add-map-'), far = tempDir(t, 'bowerloom-add-far-');
  const dir = join(far, 'elsewhere', '.bowerloom');
  put(join(dir, 'harness.json'), harness('far'));
  put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'journal', kind: 'wiki-folder', path: '~/journal' }] }));
  const read = await readHome(home, [join(far, 'elsewhere')]);
  const state = realToHarnessState(read.result, read.places);
  const part = state.parts.find(p => p.name === 'journal')!;
  assert.ok(part, 'the notes are listed');
  assert.equal(part.path.includes(far), false, part.path);
  assert.match(part.path, /^…\/elsewhere\/\.bowerloom\/knowledge\.json$/);
});

test('a harness that cannot be read is named in the Library with a reason, and adds no part', async t => {
  const cases: [string, (dir: string) => void][] = [
    ['malformed knowledge.json', dir => put(join(dir, 'knowledge.json'), '{ not json')],
    ['a source name used twice', dir => put(join(dir, 'knowledge.json'), json({ sources: [{ name: 'a', kind: 'wiki-folder', path: '~/a' }, { name: 'a', kind: 'wiki-folder', path: '~/b' }] }))],
    ['a source with an empty name', dir => put(join(dir, 'knowledge.json'), json({ sources: [{ name: '', kind: 'wiki-folder', path: '~/a' }] }))],
    ['a source whose name is not text', dir => put(join(dir, 'knowledge.json'), json({ sources: [{ name: 7, kind: 'wiki-folder', path: '~/a' }] }))],
    ['a source whose name is only a zero-width space', dir => put(join(dir, 'knowledge.json'), json({ sources: [{ name: '\u200b', kind: 'wiki-folder', path: '~/a' }] }))],
    ['a source whose name is only a bidi mark', dir => put(join(dir, 'knowledge.json'), json({ sources: [{ name: '\u202e\u202c', kind: 'wiki-folder', path: '~/a' }] }))],
    ['a connection whose name is only a zero-width space', dir => put(join(dir, 'mcp.json'), json({ servers: [{ name: '\u200b', transport: 'stdio', command: 'x' }] }))],
    ['a hook whose id is only a zero-width space', dir => put(join(dir, 'hooks.json'), json({ hooks: [{ id: '\u200b', event: 'PreToolUse', command: 'x' }] }))],
    ['an engine with an empty id', dir => put(join(dir, 'harness.json'), json({ format: 'bowerloom/harness/v1beta1', id: 'broken', description: 'x', engines: [{ id: 'claude-code' }, { id: '' }], parts: {} }))],
    ['a source list that is not a list', dir => put(join(dir, 'knowledge.json'), json({ sources: 'journal' }))],
  ];
  for (const [label, make] of cases) {
    const state = await stateOf(t, home => { const dir = join(home, 'work', 'broken', '.bowerloom'); put(join(dir, 'harness.json'), harness('broken')); make(dir); });
    assert.equal(state.parts.some(p => p.kind === 'context'), false, label);
    const notes = unreadableHarnesses(state);
    assert.equal(notes.length, 1, label);
    assert.equal(notes[0]!.name, 'broken', label);
    assert.equal(notes[0]!.label, '~/work/broken', `${label}: the folder is named in full, so two folders with one name differ`);
    assert.match(notes[0]!.why, /could not read/i, label);
  }
  const fine = await stateOf(t, home => { const dir = join(home, 'work', 'fine', '.bowerloom'); put(join(dir, 'harness.json'), harness('fine')); });
  assert.deepEqual(unreadableHarnesses(fine), []);
});

test('two unreadable harnesses with one folder name are told apart by their folder', async t => {
  const state = await stateOf(t, home => {
    for (const parent of ['one', 'two']) {
      const dir = join(home, 'work', parent, 'app', '.bowerloom');
      put(join(dir, 'harness.json'), harness('app')); put(join(dir, 'knowledge.json'), '{ not json');
    }
  });
  const notes = unreadableHarnesses(state);
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map(n => n.label).sort(), ['~/work/one/app', '~/work/two/app']);
});
