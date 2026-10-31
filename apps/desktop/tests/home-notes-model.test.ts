// The model of "Choose notes": switches in, the store's own rule out, counted by the one matcher; and back again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../shared/world/sample.js';
import { describeRule, matchPages } from '../shared/world/slicerule.js';
import type { SliceRule } from '../shared/world/types.js';
import {
  EMPTY_SELECTION, NO_OTHER, addsOf, alreadyOf, clearHand, isEmpty, keptCount, makeBasis, matchedOf, previewOf, ruleLines, sizeOf, sameSelection, selectionFromSlice, toChoice, toggleHand, toggleKeep, toggleLeaveOut, toggleTopic, topicCount,
} from '../shared/home/notes-model.js';
import type { Selection } from '../shared/home/notes-model.js';
import { countWords } from '../shared/home/textbudget.js';

const world = generateWorld(1);
const basis = makeBasis(world.wikiPages, undefined);
const topic = (name: string) => basis.topics.find(t => t.name === name)!;
const on = (...names: string[]): Selection => names.reduce((s, n) => toggleTopic(s, topic(n)), EMPTY_SELECTION);

test('nothing switched on picks nothing, and says so', () => {
  assert.equal(isEmpty(EMPTY_SELECTION, basis), true);
  const { rule, seeds } = toChoice(EMPTY_SELECTION, basis);
  assert.deepEqual([rule.folders, rule.pageTypesAndTags, rule.linksFromSeeds, seeds], [[], { types: [], tags: [] }, null, []]);
  assert.equal(previewOf(EMPTY_SELECTION, basis).count, 0);
  assert.equal(previewOf(EMPTY_SELECTION, basis).size, 'none');
  assert.deepEqual(ruleLines(EMPTY_SELECTION, basis), []);
});

test('a topic that is on is one folder in the rule, and the count is the number of notes the topic holds', () => {
  const sel = on('Clients');
  assert.deepEqual(toChoice(sel, basis).rule.folders, ['alderhythe']);
  assert.equal(matchedOf(sel, basis).size, topic('Clients').count);
  assert.equal(previewOf(sel, basis).count, topicCount(sel, topic('Clients')));
  assert.equal(previewOf(sel, basis).total, 700);
});

test('two topics add up, and a topic that is turned off again takes its notes away', () => {
  const both = on('Clients', 'Money');
  assert.equal(previewOf(both, basis).count, topic('Clients').count + topic('Money').count);
  assert.equal(previewOf(toggleTopic(both, topic('Money')), basis).count, topic('Clients').count);
  assert.equal(addsOf(both, topic('Money'), basis), topic('Money').count);
  assert.equal(addsOf(on('Clients'), topic('Money'), basis), topic('Money').count, 'what turning it on would add');
});

test('"leave out" turns the topic into its other parts, and the count drops by exactly that part', () => {
  const clients = topic('Clients'), archived = clients.parts.find(p => p.name === 'Contracts')!;
  const sel = toggleLeaveOut(on('Clients'), archived.folder);
  const { rule } = toChoice(sel, basis);
  assert.deepEqual([...rule.folders].sort(), clients.parts.filter(p => p !== archived).map(p => p.folder).sort());
  assert.equal(previewOf(sel, basis).count, clients.count - archived.count);
  assert.equal(topicCount(sel, clients), clients.count - archived.count);
  assert.deepEqual(ruleLines(sel, basis), ['All notes about Clients, except Contracts.']);
  assert.equal(previewOf(toggleLeaveOut(sel, archived.folder), basis).count, clients.count, 'putting it back');
  assert.deepEqual(toChoice(toggleLeaveOut(sel, archived.folder), basis).rule.folders, ['alderhythe']);
});

test('turning a topic off forgets the parts it left out', () => {
  const clients = topic('Clients');
  const sel = toggleTopic(toggleLeaveOut(on('Clients'), clients.parts[0]!.folder), clients);
  assert.deepEqual([sel.on, sel.leftOut], [[], []]);
  assert.equal(previewOf(toggleTopic(sel, clients), basis).count, clients.count);
});

test('leaving out every part leaves the topic with nothing', () => {
  const clients = topic('Clients');
  const sel = clients.parts.reduce((s, p) => toggleLeaveOut(s, p.folder), on('Clients'));
  assert.equal(previewOf(sel, basis).count, 0);
  assert.deepEqual(ruleLines(sel, basis), ['Nothing from Clients.']);
});

test('notes picked by hand are seed pages; ticking one inside a topic that is on adds nothing', () => {
  const clients = topic('Clients'), money = world.wikiPages.find(p => p.folder.startsWith('cinderlow/'))!, inClients = world.wikiPages.find(p => p.folder.startsWith('alderhythe/'))!;
  const sel = toggleHand(toggleHand(on('Clients'), money.id), inClients.id);
  assert.deepEqual(toChoice(sel, basis).seeds, [money.id, inClients.id]);
  assert.equal(previewOf(sel, basis).count, clients.count + 1);
  assert.deepEqual(ruleLines(sel, basis), ['All notes about Clients.', '2 notes picked by hand.']);
  assert.equal(clearHand(sel).hand.length, 0);
  assert.equal(clearHand(EMPTY_SELECTION), EMPTY_SELECTION);
  assert.deepEqual(ruleLines(toggleHand(EMPTY_SELECTION, money.id), basis), ['1 note picked by hand.']);
});

test('the rule is the one the store understands: matchPages on it gives the same notes as the preview, for many mixes', () => {
  const picks = world.wikiPages.slice(0, 5).map(p => p.id);
  const mixes: Selection[] = [on('Work'), on('Work', 'Travel'), toggleLeaveOut(on('Meetings'), topic('Meetings').parts[0]!.folder), picks.reduce(toggleHand, on('Money')), picks.reduce(toggleHand, EMPTY_SELECTION)];
  for (const sel of mixes) {
    const { rule, seeds } = toChoice(sel, basis);
    assert.deepEqual([...matchPages(rule, seeds, world.wikiPages)].sort(), [...matchedOf(sel, basis)].sort());
  }
});

test('describeRule reads the same folders, with the same page count as the topic (it is not shown: its words are not the screen words)', () => {
  const { rule } = toChoice(on('Clients'), basis);
  assert.match(describeRule(rule, world.wikiPages), new RegExp(`\\(${topic('Clients').count} pages\\)`));
});

test('a saved choice comes back as switches: the three sample choices', () => {
  const folders = world.slices.find(s => s.id === 'slice-folders')!;       // alderhythe + brindle/furrow, and two seeds
  const sel = selectionFromSlice(folders, makeBasis(world.wikiPages, folders));
  assert.deepEqual([...sel.on].sort(), ['alderhythe', 'brindle']);
  assert.deepEqual([...sel.leftOut].sort(), ['brindle/galley', 'brindle/gorse']);
  assert.deepEqual(sel.hand, folders.seeds);
  assert.equal(sel.keepOther, false);
  const b = makeBasis(world.wikiPages, folders);
  assert.equal(previewOf(sel, b).count, matchPages(folders.rule, folders.seeds, world.wikiPages).size, 'the same notes as the saved rule');
  assert.equal(sameSelection(sel, selectionFromSlice(folders, b)), true);

  const kinds = world.slices.find(s => s.id === 'slice-kinds')!;              // a page type and two tags, no folder
  const bk = makeBasis(world.wikiPages, kinds), sk = selectionFromSlice(kinds, bk);
  assert.deepEqual([sk.on, sk.hand, sk.keepOther], [[], [], true]);
  assert.equal(previewOf(sk, bk).count, matchPages(kinds.rule, kinds.seeds, world.wikiPages).size);
  assert.equal(keptCount(sk, bk), previewOf(sk, bk).count);
  assert.equal(previewOf(toggleKeep(sk), bk).count, 0, 'dropping what was kept');
  assert.deepEqual(ruleLines(sk, bk), [`${keptCount(sk, bk)} notes kept from before.`]);

  const seeds = world.slices.find(s => s.id === 'slice-seeds')!;              // three seed pages and links two steps out
  const bs = makeBasis(world.wikiPages, seeds), ss = selectionFromSlice(seeds, bs);
  assert.deepEqual([ss.on, ss.hand, ss.keepOther], [[], seeds.seeds, true]);
  assert.equal(previewOf(ss, bs).count, matchPages(seeds.rule, seeds.seeds, world.wikiPages).size);
});

test('adding a topic to a choice that was kept from before keeps both', () => {
  const kinds = world.slices.find(s => s.id === 'slice-kinds')!, b = makeBasis(world.wikiPages, kinds);
  const sel = toggleTopic(selectionFromSlice(kinds, b), b.topics.find(t => t.name === 'Money')!);
  const rule: SliceRule = toChoice(sel, b).rule;
  assert.deepEqual([rule.folders, rule.pageTypesAndTags.types], [['cinderlow'], kinds.rule.pageTypesAndTags.types]);
  const together = matchedOf(sel, b).size, onlyKept = matchPages(kinds.rule, [], world.wikiPages);
  assert.ok(together >= b.topics.find(t => t.name === 'Money')!.count && together >= onlyKept.size);
});

test('no choice at all is an empty selection, and a basis with no old choice has no other handles', () => {
  assert.equal(selectionFromSlice(undefined, basis), EMPTY_SELECTION);
  assert.equal(basis.other.types.length + basis.other.tags.length, 0);
  assert.deepEqual(basis.other, NO_OTHER);
});

test('two selections are the same when they switch the same things, in any order', () => {
  assert.equal(sameSelection(on('Work', 'Money'), on('Money', 'Work')), true);
  assert.equal(sameSelection(on('Work'), on('Money')), false);
  assert.equal(sameSelection(on('Work'), toggleHand(on('Work'), 'page-0001')), false);
});

test('the preview lists the newest topic first, then single picks', () => {
  const pick = world.wikiPages.find(p => p.folder.startsWith('fennrow/'))!;
  const sel = toggleHand(on('Clients', 'Money'), pick.id);
  const notes = previewOf(sel, basis).notes;
  assert.equal(notes[0]!.place, 'Money');
  assert.equal(notes[topic('Money').count]!.place, 'Clients');
  assert.equal(notes[notes.length - 1]!.id, pick.id);
  assert.equal(notes.length, topic('Money').count + topic('Clients').count + 1);
  assert.ok(notes.every(n => n.title !== ''));
});

test('the size step follows the count: none, small, medium, big, then all; 203 of 700 is a medium set, not a near-constant number', () => {
  const size = (...names: string[]) => previewOf(on(...names), basis).size;
  assert.equal(size(), 'none');
  assert.equal(size('Travel'), 'small');                         // 55 of 700
  assert.equal(size('Work', 'Meetings'), 'medium');              // 257 of 700
  assert.equal(size('Work', 'Meetings', 'Research', 'Clients'), 'big');
  assert.equal(previewOf(basis.topics.reduce(toggleTopic, EMPTY_SELECTION), basis).size, 'all');
  // The edges: the step changes at 15 and at 50 percent, and never goes down as notes are added.
  assert.deepEqual([sizeOf(0, 700), sizeOf(105, 700), sizeOf(106, 700), sizeOf(350, 700), sizeOf(351, 700), sizeOf(700, 700), sizeOf(5, 0)], ['none', 'small', 'medium', 'medium', 'big', 'all', 'none']);
  const order = ['none', 'small', 'medium', 'big', 'all'];
  let last = 0;
  for (let n = 0; n <= 700; n += 7) { const at = order.indexOf(sizeOf(n, 700)); assert.ok(at >= last, `${n}`); last = at; }
  const all = previewOf(basis.topics.reduce(toggleTopic, EMPTY_SELECTION), basis);
  assert.equal(all.count, 700);
  assert.equal(all.share, 1);
});

test('every line of the choice in words has at most 12 words, even with many parts left out', () => {
  const work = topic('Work');
  for (let n = 0; n <= work.parts.length; n += 1) {
    const sel = work.parts.slice(0, n).reduce((s, p) => toggleLeaveOut(s, p.folder), on('Work'));
    for (const line of ruleLines(sel, basis)) assert.ok(countWords(line) <= 12, line);
  }
  const long = makeBasis(world.wikiPages.map(p => ({ ...p, folder: p.folder.replace('tarnwick/', 'tarnwick/very-long-part-name-') })), undefined);
  const t = long.topics.find(x => x.id === 'tarnwick')!;
  for (const line of ruleLines(t.parts.slice(0, 4).reduce((s, p) => toggleLeaveOut(s, p.folder), toggleTopic(EMPTY_SELECTION, t)), long)) assert.ok(countWords(line) <= 12, line);
});

// ---- Wave C: what an agent already reads, said before any change.
test('what is already included is the topics that are on with their counts, and the rest of the choice, and the two add up to the preview', () => {
  const sel = on('Meetings', 'Travel');
  const a = alreadyOf(sel, basis);
  assert.deepEqual(a.topics, [{ name: 'Meetings', count: topic('Meetings').count }, { name: 'Travel', count: topic('Travel').count }].sort((x, y) => y.count - x.count));
  assert.equal(a.before, 0);
  assert.equal(a.total, previewOf(sel, basis).count);
  assert.equal(a.topics.reduce((n, t) => n + t.count, a.before), a.total);
});

test('notes picked one by one are counted by hand, the older handles are "from before", and the parts always add up to the preview', () => {
  const note = world.wikiPages.find(p => p.folder.startsWith('tarnwick'))!;
  const sel: Selection = { ...on('Travel'), hand: [note.id] };
  const a = alreadyOf(sel, basis);
  assert.equal(a.topics.length, 1);
  assert.equal(a.hand, 1);
  assert.equal(a.before, 0);
  assert.equal(a.topics.reduce((n, t) => n + t.count, a.hand + a.before), previewOf(sel, basis).count);
  // A note that a topic on already holds is counted once, under its topic.
  const inTravel = world.wikiPages.find(p => p.folder.startsWith('marrowdeep'))!;
  const both = alreadyOf({ ...on('Travel'), hand: [inTravel.id, note.id] }, basis);
  assert.equal(both.hand, 1, 'only the note that no topic holds counts by hand');
  assert.equal(both.topics.reduce((n, t) => n + t.count, both.hand + both.before), previewOf({ ...on('Travel'), hand: [inTravel.id, note.id] }, basis).count);
  // A note in a part that was left out of its topic is not held by the topic: it counts by hand.
  const travel = topic('Travel'), part = travel.parts[0]!, left = world.wikiPages.find(p => p.folder === part.folder)!;
  const out = alreadyOf({ ...toggleLeaveOut(on('Travel'), part.folder), hand: [left.id] }, basis);
  assert.equal(out.hand, 1);
  // A choice made by kind and label only has no topic at all.
  const slice = { id: 'slice-kinds', name: 'x', seeds: [], rule: { folders: [], pageTypesAndTags: { types: ['guide'], tags: ['fennel', 'quartz'] }, linksFromSeeds: null }, pinned: false };
  const kept = alreadyOf(selectionFromSlice(slice, makeBasis(world.wikiPages, slice)), makeBasis(world.wikiPages, slice));
  assert.deepEqual(kept.topics, []);
  assert.equal(kept.hand, 0);
  assert.equal(kept.before, kept.total);
  assert.ok(kept.total > 0);
  assert.deepEqual(alreadyOf(EMPTY_SELECTION, basis), { topics: [], hand: 0, before: 0, total: 0 });
});

test('every selection of topics, parts and single notes is split into parts that add up to the preview, exactly', () => {
  const clients = topic('Clients'), company = topic('Company'), work = topic('Work');
  const some = world.wikiPages.filter((_, i) => i % 97 === 0).map(p => p.id);
  const picks: Selection[] = [
    EMPTY_SELECTION, on('Clients'), on('Clients', 'Company'), on('Clients', 'Company', 'Work'), { ...on('Clients', 'Company'), hand: some.slice(0, 2) },
    { ...on('Work'), hand: some }, { ...EMPTY_SELECTION, hand: some },
    { ...toggleLeaveOut(on('Clients', 'Company'), clients.parts[0]!.folder), hand: some.slice(0, 2) },
    toggleLeaveOut(toggleLeaveOut(on('Work'), work.parts[0]!.folder), work.parts[1]!.folder), toggleLeaveOut(on('Company'), company.parts[0]!.folder),
  ];
  for (const sel of picks) {
    const a = alreadyOf(sel, basis), p = previewOf(sel, basis);
    assert.equal(a.total, p.count);
    assert.equal(a.topics.reduce((n, t) => n + t.count, a.hand + a.before), p.count, JSON.stringify(sel));
    assert.ok(a.hand >= 0 && a.before >= 0);
  }
});

test('a topic with parts left out counts only the parts that are in', () => {
  const clients = topic('Clients');
  assert.ok(clients.parts.length > 1);
  const sel = toggleLeaveOut(on('Clients'), clients.parts[0]!.folder);
  const a = alreadyOf(sel, basis);
  assert.equal(a.topics[0]!.count, clients.count - clients.parts[0]!.count);
  assert.equal(a.topics.reduce((n, t) => n + t.count, a.before), a.total);
});
