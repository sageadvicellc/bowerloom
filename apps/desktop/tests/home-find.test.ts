// U3, the first minute. The tool tiles and the places of the Find screen come from the sample world, and the flow that walks them is a pure machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../shared/proto/sample.js';
import type { InterfaceId, World } from '../shared/proto/types.js';
import { ownedAgents } from '../shared/home/cards.js';
import { withSampleCopies } from '../shared/home/sample-copies.js';
import { FIND_TOOLS, findPlaces, skippedAgents, toolTiles, unsavedAgents } from '../shared/home/find-model.js';
import { createStore, reduceStore } from '../shared/proto/store.js';
import { unsavedHere } from '../renderer/home/first-run/find-words.js';
import { findReduce, readTotal, startFind } from '../shared/home/find-flow.js';
import type { FindAction, FindState } from '../shared/home/find-flow.js';
import { assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';

const world = (): World => withSampleCopies(generateWorld(1));
const run = (state: FindState, ...actions: FindAction[]): FindState => actions.reduce(findReduce, state);

// ---- The tool tiles.
test('the three tiles are Claude Code, Codex and OpenCode, in that order', () => {
  assert.deepEqual(FIND_TOOLS.map(t => t.id), ['claude-code', 'codex', 'opencode']);
  assert.deepEqual(toolTiles(world()).map(t => t.name), ['Claude Code', 'Codex', 'OpenCode']);
});

test('each tile counts the agents the person owns that were found for that tool, and the counts match the world', () => {
  const w = world();
  const owned = ownedAgents(w);
  assert.equal(owned.length, 10);
  const expected = (id: InterfaceId): number => owned.filter(a => a.foundAt.some(f => f.interface === id)).length;
  const tiles = toolTiles(w);
  assert.deepEqual(tiles.map(t => t.agents), [expected('claude-code'), expected('codex'), expected('opencode')]);
  assert.deepEqual(tiles.map(t => t.agents), [9, 4, 4]);
  assert.ok(tiles.every(t => t.found));
  // An agent found for two tools counts for both, so the tiles add up to more than the agents: the total is not the sum.
  assert.ok(tiles.reduce((n, t) => n + t.agents, 0) > owned.length);
});

test('a tool that is not on the computer says so: not found, no agents, and the others are not touched', () => {
  const w = world();
  const gone: World = { ...w, interfaces: w.interfaces.map(i => (i.id === 'codex' ? { ...i, installed: 'not-installed' as const } : i)) };
  const tiles = toolTiles(gone);
  assert.deepEqual(tiles.map(t => t.found), [true, false, true]);
  assert.equal(tiles[1]!.agents, 0);
  assert.deepEqual([tiles[0]!.agents, tiles[2]!.agents], [9, 4]);
  const unknown: World = { ...w, interfaces: w.interfaces.filter(i => i.id !== 'opencode') };
  assert.equal(toolTiles(unknown)[2]!.found, false, 'a tool the world does not list is not found');
});

test('the tile model never changes the world', () => {
  const w = world(); const before = JSON.stringify(w);
  toolTiles(w); findPlaces(w);
  assert.equal(JSON.stringify(w), before);
});

// ---- The places.
test('the places are plain: the home folder first, then one per folder that holds agents, and the counts add up to the agents', () => {
  const w = world();
  const places = findPlaces(w);
  assert.deepEqual(places.map(p => p.name), ['Your home folder', 'Client site', 'Holiday trips']);
  assert.deepEqual(places.map(p => p.agents), [8, 1, 1]);
  assert.equal(places.reduce((n, p) => n + p.agents, 0), ownedAgents(w).length);
  const ids = places.flatMap(p => p.agentIds);
  assert.equal(new Set(ids).size, ids.length, 'an agent is in one place');
  assert.deepEqual([...ids].sort(), ownedAgents(w).map(a => a.id).sort());
});

test('no place name holds a path or a banned word, and every name is at most five words', () => {
  for (const p of findPlaces(world())) {
    assert.doesNotMatch(p.name, /[/\\.]/, p.name);
    assert.equal(bannedIn(p.name), null, p.name);
    assert.ok(countWords(p.name) <= 5, p.name);
  }
});

test('the real folders sit in each place, for "Show details" only, one per settings folder, sorted', () => {
  const places = findPlaces(world());
  const home = places[0]!;
  assert.deepEqual(home.paths, ['/Users/sample/Studio/.claude', '/Users/sample/Studio/.codex', '/Users/sample/Studio/.opencode']);
  assert.deepEqual(places[1]!.paths.length, 3);
  for (const p of places) for (const path of p.paths) assert.match(path, /^\//);
  // The ready-made agents of a library cache are not a place the person owns.
  assert.ok(places.every(p => p.paths.every(path => !path.includes('.cache'))));
});

test('a place with no agent of the person is left out, and a world with no agents has no places', () => {
  const w = world();
  assert.ok(findPlaces(w).every(p => p.agents > 0));
  const none: World = { ...w, items: w.items.filter(i => i.kind !== 'agent') };
  assert.deepEqual(findPlaces(none), []);
  assert.deepEqual(toolTiles(none).map(t => t.agents), [0, 0, 0]);
});

test('an unticked place skips its agents, and only its own', () => {
  const places = findPlaces(world());
  const all = places.map(p => p.id);
  assert.deepEqual(skippedAgents(places, all), []);
  assert.deepEqual(skippedAgents(places, []).length, 10);
  const without = all.filter(id => id !== places[1]!.id);
  assert.deepEqual(skippedAgents(places, without), [...places[1]!.agentIds]);
});

// ---- The flow.
const ids = ['a', 'b', 'c'];
test('the flow starts looking, with nothing lit and every place ticked', () => {
  const s = startFind(3, ids);
  assert.deepEqual({ step: s.step, lit: s.lit, ticked: s.ticked, read: s.read }, { step: 'looking', lit: 0, ticked: ids, read: 0 });
  assert.equal(Object.isFrozen(s), true);
});

test('the tiles light one by one, and the places show after the last one settles', () => {
  let s = startFind(3, ids);
  s = run(s, { type: 'light' }); assert.deepEqual([s.step, s.lit], ['looking', 1]);
  s = run(s, { type: 'light' }); assert.equal(s.lit, 2);
  assert.equal(findReduce(s, { type: 'settle' }), s, 'settle waits until every tile is lit');
  s = run(s, { type: 'light' }); assert.deepEqual([s.step, s.lit], ['looking', 3]);
  s = run(s, { type: 'light' }); assert.equal(s.lit, 3, 'no more than the tiles');
  s = run(s, { type: 'settle' }); assert.equal(s.step, 'places');
});

test('lightAll jumps to the places at once (reduce motion)', () => {
  const s = run(startFind(3, ids), { type: 'lightAll' });
  assert.deepEqual([s.step, s.lit], ['places', 3]);
  assert.equal(findReduce(s, { type: 'lightAll' }), s, 'only while looking');
});

const atPlaces = (): FindState => run(startFind(3, ids), { type: 'lightAll' });

test('a place can be unticked and ticked again, only on the places step, and only a place that exists', () => {
  let s = atPlaces();
  s = run(s, { type: 'toggle', id: 'b' }); assert.deepEqual(s.ticked, ['a', 'c']);
  s = run(s, { type: 'toggle', id: 'b' }); assert.deepEqual(s.ticked, ['a', 'b', 'c'], 'ticking again keeps the order of the list');
  assert.equal(findReduce(s, { type: 'toggle', id: 'zzz' }), s);
  const early = startFind(3, ids);
  assert.equal(findReduce(early, { type: 'toggle', id: 'a' }), early);
});

test('"Looks right" asks the second question, and not when every place is unticked', () => {
  let s = atPlaces();
  const empty = run(s, { type: 'toggle', id: 'a' }, { type: 'toggle', id: 'b' }, { type: 'toggle', id: 'c' });
  assert.equal(findReduce(empty, { type: 'looksRight' }), empty);
  s = run(s, { type: 'looksRight' }); assert.equal(s.step, 'confirm');
  assert.equal(s.read, 0);
});

test('nothing is read until "Yes": the confirm step cannot read, and "Back" returns to the places with the ticks kept', () => {
  let s = run(atPlaces(), { type: 'toggle', id: 'a' }, { type: 'looksRight' });
  assert.equal(findReduce(s, { type: 'read' }), s, 'reading needs the yes');
  s = run(s, { type: 'back' }); assert.deepEqual([s.step, s.ticked], ['places', ['b', 'c']]);
  assert.equal(findReduce(s, { type: 'yes' }), s, 'yes only answers the question');
});

test('"Yes" starts reading, place by place, and the last place ends the flow', () => {
  let s = run(atPlaces(), { type: 'toggle', id: 'a' }, { type: 'looksRight' }, { type: 'yes' });
  assert.deepEqual([s.step, s.read, readTotal(s)], ['reading', 0, 2]);
  s = run(s, { type: 'read' }); assert.deepEqual([s.step, s.read], ['reading', 1]);
  s = run(s, { type: 'read' }); assert.deepEqual([s.step, s.read], ['done', 2]);
  assert.equal(findReduce(s, { type: 'read' }), s, 'nothing happens after the end');
});

test('readAll ends the reading at once (reduce motion)', () => {
  const s = run(atPlaces(), { type: 'looksRight' }, { type: 'yes' }, { type: 'readAll' });
  assert.deepEqual([s.step, s.read], ['done', 3]);
});

test('"Not now" leaves the flow from the places or from the question, and reads nothing', () => {
  assert.equal(run(atPlaces(), { type: 'notNow' }).step, 'left');
  const s = run(atPlaces(), { type: 'looksRight' }, { type: 'notNow' });
  assert.deepEqual([s.step, s.read], ['left', 0]);
  const early = startFind(3, ids);
  assert.equal(findReduce(early, { type: 'notNow' }), early);
});

test('a flow can start with some places already unticked (Find more keeps the person\'s choice), and ignores ids it does not know', () => {
  const s = startFind(3, ids, ['c', 'zzz', 'a']);
  assert.deepEqual(s.ticked, ['a', 'c']);
});

test('no tool at all and no place at all still ends: the tiles light, the places are empty, and "Looks right" does nothing', () => {
  let s = startFind(0, []);
  s = run(s, { type: 'settle' }); assert.equal(s.step, 'places');
  assert.equal(findReduce(s, { type: 'looksRight' }), s);
  assert.equal(run(s, { type: 'notNow' }).step, 'left');
});

test('the machine never changes its input', () => {
  const s = atPlaces(); const before = JSON.stringify(s);
  findReduce(s, { type: 'toggle', id: 'a' }); findReduce(s, { type: 'looksRight' }); findReduce(s, { type: 'notNow' });
  assert.equal(JSON.stringify(s), before);
  assert.throws(() => { (s as { step: string }).step = 'done'; }, TypeError);
});

// ---- Where the app opens.
import { isAppHash, startOf } from '../shared/home/route.js';
import { MOTION } from '../renderer/motion-tokens.js';

test('the address picks the start: Welcome, the map, or the map with the tour', () => {
  assert.deepEqual(startOf('#prototype-v2'), { screen: 'welcome', guided: false });
  assert.deepEqual(startOf('#prototype-v2/'), { screen: 'welcome', guided: false });
  assert.deepEqual(startOf('#prototype-v2/map'), { screen: 'map', guided: false });
  assert.deepEqual(startOf('#prototype-v2/map/tour'), { screen: 'map', guided: true });
  assert.deepEqual(startOf(''), { screen: 'welcome', guided: false });
});

test('the app answers its own addresses and leaves the gallery and the Add page to their pages', () => {
  for (const h of ['#prototype-v2', '#prototype-v2/', '#prototype-v2/map', '#prototype-v2/map/tour']) assert.equal(isAppHash(h), true, h);
  for (const h of ['#prototype-v2/kit', '#prototype-v2/add', '#main', '#prototype', '']) assert.equal(isAppHash(h), false, h);
});

test('the tile light-up is short, eased out, 80 ms apart, and a few pixels of travel', () => {
  const t = MOTION.home.tileLight;
  assert.deepEqual({ ms: t.ms, stagger: t.stagger, distance: t.distance, ease: t.ease }, { ms: 240, stagger: 80, distance: 6, ease: MOTION.ease.out });
  assert.ok(t.ms <= 300, 'brief');
});

// ---- Item 12: a place whose agents have changes that wait.
test('a place counts the agents whose draft differs from the saved world, and a place without changes counts none (review item 12)', () => {
  const world = withSampleCopies(generateWorld(1));
  const owned = ownedAgents(world);
  const draft = reduceStore(createStore(world).getState(), { type: 'detachSkill', agentId: owned[0]!.id, skillId: owned[0]!.definition.skillIds[0]! }).draft;
  assert.deepEqual([...unsavedAgents(world, draft)], [owned[0]!.id]);
  assert.equal(findPlaces(draft, world).reduce((n, p) => n + p.unsaved, 0), 1);
  assert.equal(findPlaces(draft, world).find(p => p.agentIds.includes(owned[0]!.id))!.unsaved, 1);
  assert.equal(findPlaces(world).reduce((n, p) => n + p.unsaved, 0), 0);
  assert.equal(unsavedAgents(world, world).size, 0);
  assert.deepEqual(unsavedHere(1), '1 agent here has changes you have not saved.');
  assert.deepEqual(unsavedHere(2), '2 agents here have changes you have not saved.');
  assert.deepEqual(assertTextBudget(`<p>${unsavedHere(12)}</p>`), []);
});
