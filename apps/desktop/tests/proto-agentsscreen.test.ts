// The agents screen: with no session a title and a count; with a session the lists, the 50-row limit, the definition of the selected agent, the read-only library agent, and the plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentDetail, AgentListSection } from '../renderer/proto/agents-parts.js';
import { AgentsScreen } from '../renderer/proto/AgentsScreen.js';
import { Combobox, MenuButton } from '../renderer/proto/library-parts.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { countLine } from '../renderer/proto/words.js';
import { agentLists, moreLabel, rowsLeft, visibleRows } from '../shared/proto/agents-logic.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { createStore } from '../shared/proto/store.js';
import type { AgentItem } from '../shared/proto/types.js';
import { clientNames } from './client-names.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED_WORD = /\bhelpers?\b|\bteams?\b/i;
const world = generateWorld(1);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const render = (store = createStore(world)): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(AgentsScreen, { world })));
const owned = world.items.find(i => i.id === 'agent-01') as AgentItem, library = world.items.find(i => i.id === CASE_IDS.newerLibraryItem) as AgentItem;
const noop = (): void => undefined;
const detail = (agent: AgentItem, w = world): string => renderToStaticMarkup(createElement(AgentDetail, { committed: w, world: w, agent, go: noop, copyTo: 'global', onCopyTo: noop, onMake: noop, moved: null }));
const levels = (markup: string): number[] => [...markup.matchAll(/<h([1-6])[ >]/g)].map(m => Number(m[1]));

test('without a session the screen is the title and the count of agents, and does not throw', () => {
  const markup = renderToStaticMarkup(createElement(AgentsScreen, { world }));
  assert.equal(textOf(markup), `Agents ${countLine('agents', world)}`); assert.match(markup, /<h1[^>]*>Agents<\/h1>/);
});

test('the list: yours first with 10 agents, then Evergreen Kit with 120, and only 50 of them drawn, with a button for 50 more', () => {
  const markup = render(), text = textOf(markup);
  assert.match(text, /130 agents: 10 yours, 120 from libraries/);
  assert.ok(markup.indexOf('Yours') < markup.indexOf('Evergreen Kit'));
  assert.match(text, /Yours 10 agents/); assert.match(text, /Evergreen Kit 120 agents/);
  const rows = [...markup.matchAll(/<button type="button" class="agents-row"/g)].length;
  assert.equal(rows, 60, '10 of yours and the first 50 of the library, never all 120 at once');
  assert.match(markup, /<button[^>]*aria-label="Show 50 more in Evergreen Kit"[^>]*>Show 50 more<\/button>/);
  assert.match(text, /Showing 50 of 120/);
  assert.doesNotMatch(markup, /Show 50 more in Yours/, 'yours fits on one page');
  assert.match(text, /Version 2\.3\.0\. Read only\./); assert.match(text, /New version waiting: 2\.4\.0/);
});

test('AgentListSection: a last page says how many more, and the search count shows when something is typed', () => {
  const list = agentLists(world, '')[1]!, rows = visibleRows(list.matching, 100);
  const markup = renderToStaticMarkup(createElement(AgentListSection, { list, rows, left: rowsLeft(list.matching, 100), moreText: moreLabel(rowsLeft(list.matching, 100)), selectedId: null, onSelect: noop, onMore: noop, onKeyRow: noop, query: '' }));
  assert.match(markup, />Show 20 more</); assert.equal([...markup.matchAll(/class="agents-row"/g)].length, 100);
  const found = agentLists(world, 'zzzzqqq')[1]!;
  const none = renderToStaticMarkup(createElement(AgentListSection, { list: found, rows: [], left: 0, moreText: '', selectedId: null, onSelect: noop, onMore: noop, onKeyRow: noop, query: 'zzzzqqq' }));
  assert.match(textOf(none), /0 of 120 match/); assert.match(textOf(none), /No agent matches the search\./);
  const all = renderToStaticMarkup(createElement(AgentListSection, { list, rows: visibleRows(list.matching, 150), left: 0, moreText: '', selectedId: null, onSelect: noop, onMore: noop, onKeyRow: noop, query: '' }));
  assert.doesNotMatch(all, /Show \d+ more/); assert.match(textOf(all), /Showing all 120/);
});

test('the first agent of yours is selected, with aria-current on its row, and its definition fills the detail', () => {
  const markup = render(), text = textOf(markup);
  assert.equal([...markup.matchAll(/aria-current="true"/g)].length, 1);
  assert.match(markup, new RegExp(`<h2[^>]*tabindex="-1"[^>]*>${agentLists(world, '')[0]!.matching[0]!.name}</h2>`), 'the first row of yours, which is in view');
  for (const heading of ['Instructions', 'Skills, in order', 'Tools', 'Knowledge slice', 'Only in some interfaces', 'Where it lands']) assert.match(markup, new RegExp(`<h3[^>]*>${heading}</h3>`), heading);
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) assert.match(markup, new RegExp(`<h4>${name}</h4>`), name);
  assert.doesNotMatch(text, /Read-only: it comes from/);
  const h = levels(markup);
  assert.equal(h.filter(n => n === 1).length, 1);
  for (let i = 1; i < h.length; i += 1) assert.ok(h[i]! <= h[i - 1]! + 1, `heading ${i}: ${h[i - 1]} then ${h[i]}`);
});

test('an owned agent: instructions, skills in order with Move up, Move down and Detach, tools with access words, a slice, extras with a badge, and a place for each interface', () => {
  const markup = detail(owned), text = textOf(markup), n = owned.definition.skillIds.length;
  assert.match(markup, /<pre class="file agents-instructions" tabindex="0" aria-label="Instructions, read only">/); assert.ok(text.includes(owned.definition.instructions.slice(0, 40)));
  assert.equal([...markup.matchAll(/<li[^>]*class="agents-skill/g)].length, n); assert.equal([...markup.matchAll(/class="agents-handle"/g)].length, n);
  assert.equal([...markup.matchAll(/>Move up</g)].length, n); assert.equal([...markup.matchAll(/>Move down</g)].length, n);
  assert.match(markup, /aria-label="Move up: [^"]+" aria-disabled="true"[^>]*>Move up</, 'the first skill cannot move up');
  assert.match(text, /read only|read and write/); assert.match(markup, /<select[^>]*>[\s\S]*?<option[^>]*>read only<\/option><option[^>]*>read and write<\/option>/);
  assert.match(markup, /role="combobox"/); assert.match(text, /Attach a skill/); assert.match(text, /Tool to attach/);
  assert.match(text, /Knowledge slice Slice this agent reads/); assert.match(markup, /<option value="">None<\/option>/);
  assert.match(text, /Claude Code only|Codex only|OpenCode only/); assert.match(text, /These belong to one interface only/);
  assert.match(text, /\d+ files? would be written\./);
  assert.match(text, /Drag a skill by its handle, or use Move up and Move down\./);
  assert.match(markup, /class="agents-handle" aria-hidden="true"/, 'the drag handle is decoration; the buttons are the keyboard way');
});

test('an agent with no extras says it is the same in every interface', () => {
  const plain = world.items.find(i => i.id === 'agent-02') as AgentItem;
  assert.match(textOf(detail(plain)), /No extras\. This agent is the same in every interface\./);
});

test('a library agent is read only: it says where it comes from, offers Make my own copy into a chosen harness, and its controls explain instead of change', () => {
  const markup = detail(library), text = textOf(markup);
  assert.match(text, /Read-only: it comes from Evergreen Kit\./); assert.match(text, /New version waiting: 2\.4\.0/);
  assert.match(text, /From Evergreen Kit 2\.3\.0/);
  assert.match(markup, /<button[^>]*class="btn"[^>]*>Make my own copy<\/button>/);
  assert.match(markup, /<label[^>]*><span>Copy into<\/span><select[^>]*>[\s\S]*?Studio \(global\)[\s\S]*?Copperfen \(project\)/);
  assert.match(markup, /<button[^>]*aria-disabled="true"[^>]*>Attach a skill<\/button>/); assert.doesNotMatch(markup, /role="combobox"/);
  assert.match(text, /Nothing is written\. A library agent is a reference\./);
  assert.doesNotMatch(markup, /See what would be written/);
});

test('where it lands: a change that waits is marked on its file', () => {
  const s = createStore(world);
  s.dispatch({ type: 'attachSkill', agentId: owned.id, skillId: 'skill-030' });
  const w = s.getState().draft, agent = w.items.find(i => i.id === owned.id) as AgentItem;
  const markup = renderToStaticMarkup(createElement(AgentDetail, { committed: s.getState().committed, world: w, agent, go: noop, copyTo: 'global', onCopyTo: noop, onMake: noop, moved: null }));
  assert.match(markup, /<summary>See what would be written<\/summary>/); assert.match(textOf(markup), /Change \/Users\/sample\/Studio\/\.claude\/agents\//);
  assert.match(textOf(markup), /\d+ files? would be written, \d+ waiting\./);
  assert.match(render(s), /Waiting to apply/);
});

test('the combobox and the menu button follow the pattern: roles, a closed list, and a named button', () => {
  const combo = renderToStaticMarkup(createElement(Combobox, { label: 'Attach a skill', placeholder: 'Type', options: [{ id: 'a', label: 'Alpha', hint: 'First' }], onPick: noop, emptyText: 'None left' }));
  assert.match(combo, /role="combobox"/); assert.match(combo, /aria-expanded="false"/); assert.match(combo, /aria-autocomplete="list"/); assert.match(combo, /<label[^>]*for="[^"]+"><span>Attach a skill<\/span><\/label>/);
  assert.match(combo, /<ul[^>]*role="listbox"[^>]*hidden=""/);
  const menu = renderToStaticMarkup(createElement(MenuButton, { label: 'Install to', menuLabel: 'Install X to', entries: () => [{ id: 'g', label: 'Studio (global)' }], onPick: noop }));
  assert.match(menu, /<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*>Install to/); assert.doesNotMatch(menu, /role="menu"/);
});

test('the words are plain: no helper, no team, no command line, no em-dash', () => {
  for (const markup of [render(), detail(owned), detail(library)]) { const w = textOf(markup); assert.doesNotMatch(w, COMMAND, w.slice(0, 80)); assert.doesNotMatch(w, BANNED_WORD, w.slice(0, 80)); assert.doesNotMatch(w, /—/); }
  assert.deepEqual(clientNames(textOf(render())), []);
});
