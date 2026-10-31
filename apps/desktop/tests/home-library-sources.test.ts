// The simulated sources of "Add from the web": the three sample sources and their rules, the link check (nothing is fetched), and the plan that says which
// ticked items are new, which are already here and which become a second copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reduceStore } from '../shared/world/store.js';
import type { StoreState } from '../shared/world/store.js';
import { distinctTexts } from '../shared/world/conflicts.js';
import {
  SAMPLE_SOURCES, addressOf, defaultTicked, groupedItems, kindCounts, needsKeyOf, openLink, runsCodeOf, textOfItem,
} from '../shared/home/library-sources.js';
import { planAdd } from '../shared/home/library-actions.js';
import { fieldsOf, bodyOf, makeText } from '../shared/home/library-text.js';
import { libraryDetails, libraryRows } from '../shared/home/library-model.js';
import { LIMITS, assertTextBudget, bannedIn, countWords } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';
import { libraryWorld } from './home-library-world.js';

const start = (): StoreState => { const w = libraryWorld(); return { committed: w, draft: w, undoStack: [], redoStack: [], headVersionId: null }; };
const [office, research, money] = SAMPLE_SOURCES;

test('there are three sample sources with plain names, one-line descriptions, counts and unique slugs', () => {
  assert.equal(SAMPLE_SOURCES.length, 3);
  assert.equal(new Set(SAMPLE_SOURCES.map(s => s.id)).size, 3);
  for (const s of SAMPLE_SOURCES) {
    assert.ok(countWords(s.name) <= LIMITS.label, s.name); assert.ok(countWords(s.blurb) <= LIMITS.hint, s.blurb);
    assert.equal(new Set(s.items.map(i => i.slug)).size, s.items.length, s.id);
    assert.ok(s.items.length >= 5, s.id);
    for (const text of [s.name, s.blurb]) assert.equal(bannedIn(text), null, text);
  }
  assert.deepEqual(kindCounts(office!), { skill: 3, agent: 1, tool: 4 });
  assert.deepEqual(groupedItems(office!).map(g => g.kind), ['skill', 'agent', 'tool']);
});

test('every item has a name of at most 5 words, a hint of at most 12, an author, a release tag, lines, and no banned word', () => {
  for (const s of SAMPLE_SOURCES) for (const i of s.items) {
    const where = `${s.id}/${i.slug}`;
    assert.ok(countWords(i.name) <= LIMITS.label, where); assert.ok(countWords(i.hint) <= LIMITS.hint, where);
    assert.match(i.release, /^v\d+\.\d+$/, where); assert.ok(i.author.length > 3, where);
    assert.ok(i.lines.length >= 2, where);
    for (const t of [i.name, i.hint, i.author, ...i.lines, i.reach ?? '']) assert.equal(bannedIn(t), null, `${where}: ${t}`);
    assert.deepEqual(assertTextBudget(`<p>${i.hint}</p><button>${i.name}</button>`), [], where);
    if (i.reach !== undefined) assert.match(i.reach, /^(?:[a-z]+\.example\.com|This computer only)$/, where);
    if (i.kind === 'tool') assert.ok(i.toolKind !== undefined, where);
  }
});

test('hooks run code and start unticked; a tool that needs a key says so; the rest start ticked', () => {
  assert.equal(defaultTicked(office!).length, 7);
  assert.equal(office!.items.filter(runsCodeOf).length, 1);
  assert.deepEqual(office!.items.filter(needsKeyOf).map(i => i.slug), ['send-chat']);
  assert.equal(defaultTicked(research!).length, 6);
  assert.equal(defaultTicked(money!).length, 4);
  assert.ok(!defaultTicked(office!).includes('tidy-files'));
});

test('a link is only compared with the sample addresses: nothing is fetched', () => {
  assert.equal(addressOf(office!), 'https://github.com/officekit/everyday-kit');
  for (const s of SAMPLE_SOURCES) {
    assert.deepEqual(openLink(addressOf(s)), { kind: 'source', source: s });
    assert.deepEqual(openLink(`  ${addressOf(s)}/  `), { kind: 'source', source: s }, 'spaces and one slash at the end');
    assert.deepEqual(openLink(addressOf(s).toUpperCase()), { kind: 'source', source: s }, 'letter case does not matter');
  }
  assert.deepEqual(openLink(''), { kind: 'empty' });
  assert.deepEqual(openLink('   '), { kind: 'empty' });
  assert.deepEqual(openLink('https://github.com/someone/else'), { kind: 'unknown', owner: 'someone', repo: 'else' });
  assert.deepEqual(openLink('https://github.com/Some-One/some.repo_1'), { kind: 'unknown', owner: 'Some-One', repo: 'some.repo_1' });
});

test('anything that is not https://github.com/<owner>/<repo> is not a link to a collection', () => {
  for (const bad of [
    'hello', 'github.com/a/b', 'http://github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com/a', 'https://github.com/', 'https://github.com/a/b/c', 'https://github.com/a/b/tree/main',
    'https://github.com/a/b?x=1', 'https://github.com/a/b#top', 'https://github.com/a//b', 'https://github.com/-a/b', 'https://github.com/a b/c', 'https://github.com/a/b c', 'https://github.com/a/b\nhttps://github.com/c/d',
    'https://github.com/a/..', 'https://github.com/a/.', 'https://github.com/a/b.git', 'https://github.com.evil.example/a/b', 'https://user@github.com/a/b', 'https://github.com:444/a/b', 'javascript:alert(1)',
    '<a href="https://github.com/a/b">x</a>', 'ftp://github.com/a/b', 'https://github.com/' + 'a'.repeat(40) + '/b', 'https://github.com/a/' + 'b'.repeat(101),
  ]) assert.ok(!['source', 'unknown'].includes(openLink(bad).kind), bad);
  // the one with a space at the end is trimmed, so it is a link
  assert.equal(openLink('https://github.com/a/b/ ').kind, 'unknown');
  assert.equal(openLink('https://github.com/a/b.git').kind, 'bad');
});

test('the source file never fetches, builds markup, or makes a link of what was typed', () => {
  const text = readFileSync(join(DESKTOP, 'shared', 'home', 'library-sources.ts'), 'utf8');
  for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'innerHTML', 'href', 'node:http', 'node:net', 'window.open', 'location.']) assert.equal(text.includes(word), false, word);
});

test('the text of a source item reads back: description, author, release, reach, access and the lines', () => {
  const item = office!.items.find(i => i.slug === 'find-contact')!;
  const text = textOfItem(item);
  assert.deepEqual(fieldsOf(text), { description: item.hint, author: 'Omar Haddad', release: 'v1.0', reach: 'contacts.example.com', access: 'read-only' });
  assert.deepEqual(bodyOf(text), item.lines);
  assert.deepEqual(fieldsOf('no header'), {}); assert.deepEqual(bodyOf('no header\nsecond'), ['no header', 'second']);
  assert.equal(makeText({}, ['a', 'b']), 'a\nb\n');
  assert.deepEqual(fieldsOf(makeText({ description: 'x', access: 'read-write' }, ['a'])), { description: 'x', access: 'read-write' });
  assert.deepEqual(fieldsOf('---\naccess: sideways\nnonsense\n: x\n---\nbody'), {});
});

test('the plan: new items are added, the same name with the same lines is already here, the same name with other lines is a second copy', () => {
  const w = libraryWorld();
  const all = office!.items.map(i => i.slug);
  const plan = planAdd(w, office!, all);
  assert.equal(plan.adds.length, 8); assert.equal(plan.same.length, 0);
  assert.deepEqual(plan.copies, ['summarize-meeting']);
  assert.ok(plan.action !== null && plan.action.type === 'addToLibrary');
  const item = plan.action!.type === 'addToLibrary' ? plan.action.items.find(i => i.key === 'summarize-meeting') : undefined;
  assert.equal(item?.matchItemId, 'skill-042');
  const r = planAdd(w, research!, research!.items.map(i => i.slug));
  assert.deepEqual(r.same.map(i => i.slug), ['fix-spelling'], 'Fix spelling and grammar has the very same lines');
  assert.equal(r.adds.length, 5); assert.deepEqual(r.copies, []);
  assert.equal(planAdd(w, research!, []).action, null);
  assert.equal(planAdd(w, research!, ['fix-spelling']).action, null, 'a plan of only what is here has nothing to add');
  assert.equal(planAdd(w, research!, ['not-a-slug']).adds.length, 0);
});

test('staging the plan: items arrive on no agent, the second copy shows two different copies, and the screen then lists them', () => {
  const w = libraryWorld();
  const plan = planAdd(w, office!, defaultTicked(office!));
  assert.equal(plan.adds.length, 7);
  const next = reduceStore(start(), plan.action!);
  assert.equal(next.undoStack.length, 1);
  assert.equal(next.draft.items.length, w.items.length + 6, 'six new items; the seventh is a second copy');
  assert.equal(distinctTexts(next.draft.items.find(i => i.id === 'skill-042')!), 2);
  const row = libraryRows(next.draft, 'skill').find(r => r.id === 'skill-042')!;
  assert.deepEqual(row.status, { label: '2 different copies', tone: 'warn' });
  // asking again changes nothing
  const again = planAdd(next.draft, office!, defaultTicked(office!));
  assert.equal(again.action, null, 'everything is here now');
  assert.equal(again.same.length, 7, 'the second copy is here too, so it counts as here'); assert.equal(again.copies.length, 0);
  const copy = libraryDetails(next.draft, 'skill', 'skill-042')!;
  assert.equal(copy.copies, 2);
});

test('the same source added twice, a second time as a plan, adds no new item', () => {
  const w = libraryWorld();
  const first = reduceStore(start(), planAdd(w, money!, defaultTicked(money!)).action!);
  const second = planAdd(first.draft, money!, defaultTicked(money!));
  assert.equal(second.action, null);
  assert.equal(second.same.length, 4);
});
