// A person's own folder, skill, agent, note type and hook event can be named like a property every object has (constructor, toString, __proto__, hasOwnProperty, valueOf).
// No lookup by such a name may answer with a function or an object: every screen model and screen still works and shows the name as text. Made-up folders only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createScanner } from '../main/real-scan.js';
import { agentCard, noteWords, ownedAgents, shelvesOf } from '../shared/home/cards.js';
import { detailsOf } from '../shared/home/details.js';
import { findAgents, findPlaces } from '../shared/home/find-model.js';
import { LIBRARY_KINDS, entriesOf, libraryDetails, libraryRows } from '../shared/home/library-model.js';
import { buildTopics, plainTitles } from '../shared/home/notes-topics.js';
import { plainOf } from '../shared/home/plain.js';
import { buildRealResult } from '../shared/real/map-world.js';
import { mergeResults } from '../shared/real/merge-result.js';
import { clearRealResult, realPlainOf, registerRealResult } from '../shared/real/plain-fallback.js';
import type { RealResult } from '../shared/real/types.js';
import { FindPanel } from '../renderer/home/first-run/FindPanel.js';
import { Tray } from '../renderer/home/kit/Tray.js';
import { DetailsPanel } from '../renderer/home/details/DetailsPanel.js';

const NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'] as const;
const NOW = Date.UTC(2026, 9, 26);
const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const none = (): void => undefined;

/** A made-up picked folder with one project for each hostile name: the folder, its agent, its skill, and notes whose type and sub-folder carry the same name. */
function hostileHome(t: TestContext): { home: string; picked: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-hostile-names-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), picked = join(home, 'wild');
  mkdirSync(home, { recursive: true });
  for (const n of NAMES) {
    const project = join(picked, n);
    put(join(project, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\ndescription: An agent called ${n}.\nskills: [${n}]\n---\nDo the work.\n`);
    put(join(project, '.claude', 'skills', n, 'SKILL.md'), `---\nname: ${n}\ndescription: A skill called ${n}.\n---\nSteps for ${n}.\n`);
    for (let i = 1; i <= 3; i += 1) {
      put(join(project, 'notes', `page-${i}.md`), `---\ntitle: ${n} page ${i}\ntype: ${n}\n---\nText ${i}.\n`);
      put(join(project, 'notes', n, `deep-${i}.md`), `---\ntitle: Deep ${n} ${i}\ntype: ${n}\n---\nText ${i}.\n`);
    }
  }
  // A hook whose event is named like a property: the table of hook events must not answer with a function.
  put(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { constructor: [{ hooks: [{ type: 'command', command: 'echo one' }] }], toString: [{ hooks: [{ type: 'command', command: 'echo two' }] }] } }));
  return { home, picked };
}

async function read(home: string, picked: string): Promise<RealResult> {
  const scanner = createScanner({ home });
  const found = await scanner.discover(), places = [...found.places, ...(await scanner.addFolder(picked)).places];
  const batch = await scanner.read(places.map(p => p.id));
  return buildRealResult(batch.reads, batch.tally, { nowMs: NOW, foldExtraApps: true });
}

test.afterEach(() => { clearRealResult(); });

test('names like constructor and __proto__ in folders, agents, skills, hooks and note types: Find, trays, details, Library and notes all work and show the names as text', async t => {
  const { home, picked } = hostileHome(t), result = await read(home, picked), world = result.world;
  registerRealResult(result);
  // Find: the sort of places and agents compares text, and every folder name is shown as the name it has.
  const places = findPlaces(world);
  for (const p of places) assert.equal(typeof p.name, 'string', `place ${String(p.name)}`);
  const names = places.map(p => p.name);
  for (const n of NAMES) assert.ok(names.some(x => x.toLowerCase().replace(/[^a-z]/g, '') === n.toLowerCase().replace(/[^a-z]/g, '')), `the folder ${n} is a place: ${names.join(' | ')}`);
  const list = findAgents(world);
  assert.equal(list.length, NAMES.length);
  for (const a of list) { assert.equal(typeof a.name, 'string'); assert.equal(typeof a.hint, 'string'); }
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);
  const panel = html(createElement(FindPanel, { world, skipped: [], onClose: none, onDone: none }));
  assert.doesNotMatch(panel, /function|\[object|undefined|NaN/);
  // The map, the tray and the details.
  const agents = ownedAgents(world);
  assert.equal(agents.length, NAMES.length);
  for (const agent of agents) {
    const card = agentCard(agent);
    assert.equal(typeof card.name, 'string'); assert.equal(typeof card.hint, 'string');
    const shelves = shelvesOf(world, agent);
    for (const [kind, entries] of [['skill', shelves.skills], ['tool', shelves.tools], ['note', shelves.notes]] as const) {
      const tray = html(createElement(Tray, { agentId: agent.id, agentName: card.name, kind, entries, open: true, onSelectItem: none }));
      assert.doesNotMatch(tray, /function|\[object|undefined|NaN/, `${card.name} ${kind}`);
    }
    for (const selected of [{ kind: 'agent' as const, id: agent.id }, ...shelves.skills.map(e => ({ kind: 'skill' as const, id: e.id })), ...shelves.notes.map(e => ({ kind: 'note' as const, id: e.id }))]) {
      const d = detailsOf(world, agents, selected);
      const markup = html(createElement(DetailsPanel, { details: d, onSelect: none, onRemove: none, onBadgePress: none, onChoose: none }));
      assert.doesNotMatch(markup, /function|\[object|undefined|NaN/, `${card.name} details`);
    }
  }
  // The Library: every kind lists, and each entry has details.
  for (const kind of LIBRARY_KINDS) {
    const rows = libraryRows(world, kind);
    for (const row of rows) {
      assert.equal(typeof row.name, 'string'); assert.equal(typeof row.hint, 'string');
      assert.notEqual(libraryDetails(world, kind, row.id), null);
    }
    assert.ok(entriesOf(world, kind).length >= 0);
  }
  assert.ok(libraryRows(world, 'note').length > 0);
  // Notes: the topics, the plain titles (the kind of a page is its own type as words) and the names of the sets.
  const topics = buildTopics(world.wikiPages), titles = plainTitles(world.wikiPages, topics);
  assert.equal(titles.size, world.wikiPages.length);
  for (const title of titles.values()) assert.doesNotMatch(title, /function|\[object|=>|native code|undefined/, title);
  for (const n of NAMES) assert.ok([...titles.values()].some(x => x.includes(n)), `a page title shows the type ${n} as text`);
  for (const s of world.slices) { const w = noteWords(s, world.wikiPages); assert.equal(typeof w.name, 'string'); assert.equal(typeof w.hint, 'string'); }
  // Hooks: an event named like a property is not a known event.
  const hooks = world.items.filter(i => i.kind === 'tool' && i.toolKind === 'hook');
  assert.ok(hooks.length >= 2, 'both hooks were read');
  for (const h of hooks) { const p = realPlainOf(h); assert.equal(typeof p.name, 'string'); assert.doesNotMatch(`${p.name} ${p.hint}`, /undefined|function|native code/); assert.equal(plainOf('tool', h.id) === null || typeof plainOf('tool', h.id)!.name === 'string', true); }
});

test('a second read with the same hostile names merges without losing or crashing', async t => {
  const { home, picked } = hostileHome(t), a = await read(home, picked), b = await read(home, picked);
  const merged = mergeResults(a, b);
  assert.equal(merged.world.items.length, a.world.items.length);
  assert.equal(new Set(merged.world.items.map(i => i.id)).size, merged.world.items.length);
});
