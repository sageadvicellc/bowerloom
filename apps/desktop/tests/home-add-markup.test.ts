// The Add drawer, the picker, the copies dialog and the Add test page, rendered to markup: structure, roles, labels, no file path, and the text budget on all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AddDrawerBody } from '../renderer/home/add/AddDrawerBody.js';
import { AddHarness } from '../renderer/home/add/AddHarness.js';
import { AddRow } from '../renderer/home/add/AddRow.js';
import { CopiesDialog } from '../renderer/home/copies/CopiesDialog.js';
import { addDemoWorld, DEMO } from '../renderer/home/add/add-demo-world.js';
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

test('the Skills tab shows the "2 different copies" badge as a button only when the page can open the dialog', () => {
  assert.match(drawer('skills', { onOpenCopies: none }), /<button[^>]*class="kit-badge"[^>]*>[\s\S]*?2 different copies<\/span><\/button>/);
  assert.doesNotMatch(drawer('skills'), /<button[^>]*class="kit-badge"/);
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
  assert.match(m, /Already added/);
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
