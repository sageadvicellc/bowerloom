// Wave C: the Save bar's words are a button from two changes on, its list has one Undo for each change, and a change that cannot go alone says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SaveBar } from '../renderer/home/save/SaveBar.js';
import type { ChangeListView } from '../renderer/home/save/SaveBar.js';
import { ShellNote } from '../renderer/home/shell/ShellNote.js';
import { Sidebar } from '../renderer/home/shell/Sidebar.js';
import type { SidebarProps } from '../renderer/home/shell/Sidebar.js';
import { HelpPopover } from '../renderer/home/kit/HelpPopover.js';
import { UNDO_WORDS } from '../shared/home/change-undo.js';
import type { ChangeEntry } from '../shared/home/change-undo.js';
import { saveBar } from '../shared/home/savebar.js';
import { WORDS, removedNote } from '../renderer/home/words.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const entries: ChangeEntry[] = [
  { key: 'a', text: 'Removed Write a reply', changes: 1, undo: { at: [0] }, reason: null },
  { key: 'b', text: 'Added Sort my inbox to Inbox sorter', changes: 1, undo: null, reason: UNDO_WORDS.later },
];
const list = (open: boolean): ChangeListView => ({ open, setOpen: () => undefined, entries, undo: () => undefined });
const bar = (changes: number, open: boolean, said: string | null = null): string =>
  renderToStaticMarkup(createElement(SaveBar, { model: saveBar(changes, 1, null, said), ticks: [], onSave: () => undefined, onGoBack: () => undefined, onDiscard: () => undefined, list: list(open) }));

const noop = (): void => undefined;
const side = (over: Partial<SidebarProps>): string => renderToStaticMarkup(createElement(Sidebar, {
  mode: 'open', overlay: false, view: 'agents', libraryKind: 'skill', libraryOpen: true, addOpen: false, historyOpen: false, findOpen: false, readOnly: false, real: false,
  onToggle: noop, onAgents: noop, onLibrary: noop, onAdd: noop, onFind: noop, onShare: noop, onHistory: noop, onTour: noop, onHow: noop, ...over,
}));

test('one or two changes show their sentence as plain text; when the bar says "N changes" the words are a button that says whether its list is open', () => {
  const one = bar(1, false, 'Removed Write a reply');
  assert.doesNotMatch(one, /hm-changes-toggle/);
  assert.match(one, /Removed Write a reply/);
  const two = bar(2, false, 'Removed A and B');
  assert.doesNotMatch(two, /hm-changes-toggle/);
  assert.match(two, /Removed A and B/);
  const many = bar(3, false);
  assert.match(many, /<button[^>]*class="hm-changes-toggle"[^>]*aria-expanded="false"[^>]*>/);
  assert.match(many, /3 changes/);
  assert.doesNotMatch(many, /data-changes-list/);
  // Two changes that do not fit a sentence say "2 changes" and are a button too.
  assert.match(bar(2, false), /hm-changes-toggle[\s\S]*2 changes/);
});

test('the open list has one row and one Undo for each change; a change that cannot go alone has a dimmed Undo and its reason', () => {
  const html = bar(3, true);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /role="group"[^>]*aria-label="Changes waiting"/);
  assert.equal((html.match(/class="hm-changes-row"/g) ?? []).length, 2);
  assert.equal((html.match(/>Undo<\/button>/g) ?? []).length, 2);
  assert.equal((html.match(/<button[^>]*disabled=""[^>]*>Undo<\/button>/g) ?? []).length, 1);
  assert.match(html, /Undo the later change first\./);
  assert.match(html, /Removed Write a reply/);
});

test('the bar offers Undo all changes where it used to offer Discard changes, and the list never shows with fewer than two changes', () => {
  const html = bar(3, true);
  assert.match(html, />Undo all changes</);
  assert.doesNotMatch(html, /Discard changes/);
  assert.doesNotMatch(bar(1, true, 'Removed Write a reply'), /data-changes-list/);
  assert.doesNotMatch(bar(2, true, 'Removed A and B'), /data-changes-list/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SaveBar, { model: saveBar(0, 1, null), ticks: [], onSave: () => undefined, onGoBack: () => undefined, onDiscard: () => undefined, list: list(true) })), /data-changes-list/);
});

test('the bar, its list, the note after Remove, the navigation and the Help button obey the text budget', () => {
  const note = renderToStaticMarkup(createElement(ShellNote, { note: { key: 1, icon: 'check', text: removedNote('Write a reply'), action: { label: WORDS.label.undo, run: () => undefined } }, onGone: () => undefined }));
  const sw = side({});
  const help = renderToStaticMarkup(createElement(HelpPopover, { word: WORDS.label.help, label: WORDS.label.help, text: WORDS.popover.help }));
  for (const html of [bar(3, true), bar(2, true, 'Removed A and B'), bar(2, true), sw, help]) assert.deepEqual(assertTextBudget(html), [], html.slice(0, 80));
  // The note is empty until a note is shown (a note is held by the hook that fades it), so its markup is the live region alone.
  assert.match(note, /role="status"/);
  assert.equal(removedNote('Write a reply'), 'Removed Write a reply.');
});

test('the Help button is a button with the word Help on it, not a bare question mark', () => {
  const html = renderToStaticMarkup(createElement(HelpPopover, { word: 'Help', label: 'Help', text: 'New here?' }));
  assert.match(html, /<button[^>]*>Help<\/button>/);
  assert.doesNotMatch(html, />\?</);
  const old = renderToStaticMarkup(createElement(HelpPopover, { label: 'About tools', text: 'x' }));
  assert.match(old, />\?</);
});

test('the navigation holds Agents and Library as items: one stop in the Tab order, the page you are on says so with aria-current, and Library opens into its four pages', () => {
  const html = side({ view: 'library', libraryKind: 'tool' });
  assert.match(html, /<nav[^>]*aria-label="Main menu"/);
  const items = [...html.matchAll(/<button[^>]*data-nav-item=""[^>]*>/g)].map(m => m[0]);
  assert.equal(items.filter(b => /tabindex="0"/.test(b)).length, 1, 'one item is in the Tab order');
  assert.equal(items.filter(b => /aria-current="page"/.test(b)).length, 1, 'one page is current');
  assert.match(items.find(b => /aria-current="page"/.test(b))!, /data-nav-key="lib-tool"/);
  assert.match(html, /data-nav-key="agents"[^>]*>(?:<svg[\s\S]*?<\/svg>)<span class="hm-nav-label">Agents</); assert.match(html, /data-nav-key="library"[^>]*aria-expanded="true"/);
  for (const name of ['Skills', 'Agents', 'Tools', 'Notes']) assert.match(html, new RegExp(`data-sub=""[^>]*>(?:<svg[\\s\\S]*?</svg>)<span class="hm-nav-label">${name}<`));
  const agents = side({ view: 'agents' });
  assert.match(agents, /data-nav-key="agents"[^>]*aria-current="page"|aria-current="page"[^>]*data-nav-key="agents"/); assert.doesNotMatch(agents, /data-sub=""/, 'the four pages show only on the Library');
  assert.doesNotMatch(agents, /✓|check/i, 'no check mark');
});
