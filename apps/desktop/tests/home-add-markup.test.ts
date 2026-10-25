// The Add drawer, the picker, the copies dialog and the Add test page, rendered to markup: structure, roles, labels, no file path, and the text budget on all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddDrawerBody } from '../renderer/home/add/AddDrawerBody.js';
import { AddHarness } from '../renderer/home/add/AddHarness.js';
import { AddRow } from '../renderer/home/add/AddRow.js';
import type { AddEntry } from '../shared/home/add-model.js';
import { CopiesDialog } from '../renderer/home/copies/CopiesDialog.js';
import { addDemoWorld, DEMO } from '../renderer/home/add/add-demo-world.js';
import { ADD_WORDS, NOTE_STAY_MS } from '../renderer/home/add/add-words.js';
import { sharedFileSample } from '../renderer/home/add/add-sample-file.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { ADD_TABS, agentChoices, entriesFor } from '../shared/home/add-model.js';
import type { AddTab } from '../shared/home/add-model.js';
import { createStore } from '../shared/proto/store.js';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const none = (): void => undefined;
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 300));
const NO_PATH = /\.bowerloom|\/sample\/|SKILL\.md|\/Users\/|\.claude\/|\.codex\//;
const provide = (child: ReactElement) => createElement(ProtoProvider, { store: createStore(addDemoWorld()) }, child);
const drawer = (tab: AddTab, extra: object = {}): string => html(provide(createElement(AddDrawerBody, { initialTab: tab, ...extra })));

test('the drawer shows five tabs in order, one selected, and a labelled panel', () => {
  const m = drawer('skills');
  const tabs = [...m.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)].map(x => x[1]);
  assert.deepEqual(tabs, ['Skills', 'Tools', 'Notes', 'Agents', 'From a shared file']);
  assert.equal([...m.matchAll(/aria-selected="true"/g)].length, 1);
  assert.match(m, /role="tablist"[^>]*aria-label="What to add"/);
  assert.match(m, /role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-skills"/);
  assert.equal([...m.matchAll(/tabindex="-1"/g)].length, 4, 'only the open tab is in the Tab order');
  within(m);
});

for (const tab of ADD_TABS) {
  test(`the ${tab} tab passes the text budget, shows no file path, and uses only the kit's card`, () => {
    const m = drawer(tab, { sampleFile: sharedFileSample() });
    within(m);
    assert.doesNotMatch(m, NO_PATH);
    if (tab === 'file') {
      assert.match(m, /Choose a file/); assert.match(m, /Try a sample file/); assert.match(m, /type="file"/); assert.doesNotMatch(m, /class="kit-card"/);
    } else {
      const expected = entriesFor(addDemoWorld(), tab).length;
      assert.equal([...m.matchAll(/class="kit-card"/g)].length, Math.min(expected, 8));
      assert.equal([...m.matchAll(/class="add-row"/g)].length, Math.min(expected, 8));
    }
  });
}

test('a card has a hint of at most 12 words and an "Add to" button named after it; a ready-made agent has "Add agent"', () => {
  const skills = drawer('skills');
  for (const m of skills.matchAll(/<p class="kit-hint kit-card-hint"[^>]*>([^<]*)<\/p>/g)) assert.ok(countWords(m[1]!) <= 12, m[1]);
  assert.equal([...skills.matchAll(/<span id="[^"]+-do">Add to<\/span>/g)].length, 8);
  assert.match(skills, /aria-labelledby="([^"]+)-do \1"/);
  const agents = drawer('agents');
  assert.equal([...agents.matchAll(/<span id="[^"]+-do">Add agent<\/span>/g)].length, 3);
  assert.doesNotMatch(agents, /aria-expanded/);
});

test('the Skills tab shows the "2 different copies" state as a text button only when the page can open the dialog', () => {
  assert.match(drawer('skills', { onOpenCopies: none }), /<button[^>]*class="kit-status"[^>]*>[\s\S]*?2 different copies<\/span><\/button>/);
  assert.doesNotMatch(drawer('skills'), /<button[^>]*class="kit-status"/);
  assert.match(drawer('skills'), /2 different copies/);
});

test('the Tools tab marks the tool that needs a key and never lists the hook', () => {
  const m = drawer('tools');
  assert.match(m, /needs a key/);
  assert.doesNotMatch(m, /Format check/);
});

test('an open row shows a labelled picker with every agent, the ones that have it marked, and no other control inside', () => {
  const world = addDemoWorld();
  const entry = entriesFor(world, 'skills').find(e => e.id === DEMO.skills[0])!;
  const m = html(createElement(AddRow, { entry, choices: agentChoices(world, entry), open: true, onToggle: none, onPick: none, onInstall: none, suppressClick: () => false }));
  assert.match(m, /role="group"[^>]*aria-labelledby/);
  assert.equal([...m.matchAll(/class="add-pick"/g)].length, 4);
  assert.equal([...m.matchAll(/aria-disabled="true"/g)].length, 1);
  assert.match(m, /Has it/);
  assert.match(m, /aria-expanded="true"/);
  within(m);
});

test('the copies dialog is a labelled modal with two copies side by side, changed lines marked in words, and one "Keep this copy" each', () => {
  const m = html(provide(createElement(CopiesDialog, { itemId: DEMO.copiesSkill, onClose: none })));
  assert.match(m, /role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
  assert.match(m, /<h2[^>]*>Two different copies<\/h2>/);
  assert.equal([...m.matchAll(/data-copy="\d"/g)].length, 2);
  assert.match(m, /Copy 1/); assert.match(m, /Copy 2/);
  assert.match(m, /Found in Claude Code and OpenCode/); assert.match(m, /Found in Codex/);
  assert.match(m, /2 lines changed/); assert.match(m, /3 lines changed/);
  assert.ok([...m.matchAll(/data-changed=""/g)].length === 5);
  assert.ok([...m.matchAll(/<span class="hm-sr">Changed: <\/span>/g)].length === 5, 'a changed line says so in words');
  assert.equal([...m.matchAll(/Keep this copy<\/span>/g)].length, 2);
  assert.match(m, /aria-labelledby="[^"]+ [^"]+"/);
  assert.match(m, /aria-label="Close"/);
  assert.doesNotMatch(m, NO_PATH);
  within(m);
});

test('the copies dialog draws nothing for an item that has no copies or is not there', () => {
  assert.equal(html(provide(createElement(CopiesDialog, { itemId: DEMO.skills[0]!, onClose: none }))), '');
  assert.equal(html(provide(createElement(CopiesDialog, { itemId: 'nothing', onClose: none }))), '');
});

test('the Add test page has a main landmark, one h1, agent cards that take a drop, the count, the shelf with the badge, and passes the budget', () => {
  const m = html(createElement(AddHarness));
  assert.match(m, /<main id="main"/);
  assert.equal([...m.matchAll(/<h1[\s>]/g)].length, 1);
  assert.equal([...m.matchAll(/data-drop-agent="/g)].length, 4);
  for (const id of DEMO.agents) assert.match(m, new RegExp(`data-drop-agent="${id}"`));
  assert.match(m, /No changes yet/);
  assert.match(m, /Your skills/);
  assert.match(m, /2 different copies/);
  assert.match(m, /Meeting note taker/);
  assert.doesNotMatch(m, /Gilded|Velvet|Brisk/);
  assert.doesNotMatch(m, NO_PATH);
  within(m);
});

test('headings on the test page are in order: h1, then h2 sections', () => {
  const m = html(createElement(AddHarness));
  const levels = [...m.matchAll(/<h([1-6])[\s>]/g)].map(x => Number(x[1]));
  assert.ok(levels.every((l, i) => i === 0 ? l === 1 : l <= levels[i - 1]! + 1), levels.join(','));
});

test('the note after an add has its own foot under the part that scrolls, so it can never cover a row', () => {
  const m = drawer('skills');
  assert.match(m, /^<div class="add-body"[^>]*><div class="add-scroll"><div class="add-tabs"/);
  assert.match(m, /<\/div><div class="add-foot"><div class="add-note" role="status" aria-live="polite"><\/div><\/div><\/div>$/);
  // The tabs and the list are inside the scrolling part; the foot is after it.
  assert.ok(m.indexOf('class="add-foot"') > m.indexOf('class="add-panel"'));
  within(m);
});

test('the note stays six seconds, and its "Show" button has words that say what it shows', () => {
  assert.equal(NOTE_STAY_MS, 6000);
  assert.equal(ADD_WORDS.label.show, 'Show');
  assert.ok(countWords(ADD_WORDS.label.showWhat) <= 5, ADD_WORDS.label.showWhat);
  assert.match(ADD_WORDS.label.showWhat, /^Show\b/, 'the spoken name starts with the words on the button');
});

// ---- Wave C: "Has it" and "On all agents".

test('a card that every agent has says "On all agents" and its button is off; a card that an agent lacks says nothing and can be opened', () => {
  const entry: AddEntry = { id: 'skill-x', kind: 'skill', name: 'Compare two options', hint: 'Puts two choices side by side.', ready: false };
  const draw = (has: boolean[]): string => renderToStaticMarkup(createElement(AddRow, { entry, choices: has.map((h, i) => ({ id: `agent-${i}`, name: `Agent ${i}`, has: h })), open: false, onToggle: () => undefined, onPick: () => undefined, onInstall: () => undefined, suppressClick: () => false }));
  const all = draw([true, true, true]);
  assert.match(all, /class="kit-status"[^>]*data-tone="info"[^>]*><span class="kit-dot" aria-hidden="true"><\/span><span>On all agents<\/span>/);
  assert.match(all, /<button[^>]*disabled=""[^>]*>[\s\S]*Add to<\/span><\/button>/);
  const some = draw([true, false, true]);
  assert.doesNotMatch(some, /On all agents/); assert.doesNotMatch(some, /disabled=""/);
  assert.doesNotMatch(draw([]), /On all agents/, 'with no agent to add to, nothing is said');
  assert.deepEqual(assertTextBudget(all), []); assert.deepEqual(assertTextBudget(some), []);
});

test('an agent that has the card reads "Has it" in the open picker and its button is marked off', () => {
  const entry: AddEntry = { id: 'skill-x', kind: 'skill', name: 'Compare two options', hint: 'Puts two choices side by side.', ready: false };
  const m = renderToStaticMarkup(createElement(AddRow, { entry, choices: [{ id: 'a', name: 'Agent A', has: true }, { id: 'b', name: 'Agent B', has: false }], open: true, onToggle: () => undefined, onPick: () => undefined, onInstall: () => undefined, suppressClick: () => false }));
  assert.match(m, /<li class="add-pick" data-has=""[\s\S]*?aria-disabled="true"[\s\S]*?>Agent A<\/button><span class="kit-hint add-pick-note"[^>]*>Has it<\/span>/);
  assert.equal([...m.matchAll(/Has it/g)].length, 1);
  assert.deepEqual(assertTextBudget(m), []);
});
