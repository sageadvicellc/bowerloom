// The skills screen: with no session a title and a count; with a session the groups, the counts, the controls, the plain words, and nothing that relies on colour alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibrarySection, SkillCard, AddSkillsPanel } from '../renderer/proto/skills-parts.js';
import { SkillsScreen } from '../renderer/proto/SkillsScreen.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { countLine } from '../renderer/proto/words.js';
import { FOLDER_CANDIDATES } from '../shared/proto/library-catalog.js';
import { libraryOffers } from '../shared/proto/library-install.js';
import { CASE_IDS, generateWorld } from '../shared/proto/sample.js';
import { describePlacement, groupSkills, skillRows } from '../shared/proto/skills-logic.js';
import { createStore } from '../shared/proto/store.js';
import type { SkillItem } from '../shared/proto/types.js';
import { DESKTOP } from './support.js';
import { clientNames } from './client-names.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED_WORD = /\bhelpers?\b|\bteams?\b/i;
const world = generateWorld(1);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const render = (store = createStore(world)): string => renderToStaticMarkup(createElement(ProtoProvider, { store }, createElement(SkillsScreen, { world })));
const withLantern = () => { const s = createStore(world); s.dispatch({ type: 'addLibrary', libraryId: 'lantern-works' }); return s; };
const levels = (markup: string): number[] => [...markup.matchAll(/<h([1-6])[ >]/g)].map(m => Number(m[1]));

test('without a session the screen is the title and the count of skills, and does not throw', () => {
  const markup = renderToStaticMarkup(createElement(SkillsScreen, { world }));
  assert.equal(textOf(markup), `Skills ${countLine('skills', world)}`); assert.match(markup, /<h1[^>]*>Skills<\/h1>/);
});

test('with a session: one h1, then the groups Yours, From libraries and Found in several tools, then the waiting list, with headings that never skip a level', () => {
  const markup = render(), h = levels(markup);
  assert.equal(h.filter(n => n === 1).length, 1); assert.equal(h[0], 1);
  for (let i = 1; i < h.length; i += 1) assert.ok(h[i]! <= h[i - 1]! + 1, `heading ${i}: ${h[i - 1]} then ${h[i]}`);
  const h2 = [...markup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map(m => textOf(m[1]!));
  assert.deepEqual(h2.map(t => t.replace(/ \d+ (skills?|librar(y|ies))$/, '')), ['Yours', 'From libraries', 'Found in several tools', 'Waiting to apply']);
});

test('the filters are one row with the search: a Filters button opens the interface chips and the view buttons, and says how many are on', () => {
  const markup = render();
  const toolbar = markup.slice(markup.indexOf('class="lib-toolbar"'), markup.indexOf('class="lib-scopes"'));
  assert.match(toolbar, /<details class="lib-filters"><summary>Filters<\/summary>/, 'closed until it is asked for');
  assert.doesNotMatch(toolbar, /<details class="lib-filters" open/);
  const body = toolbar.slice(toolbar.indexOf('lib-filters-body'));
  for (const name of ['Claude Code', 'Codex', 'OpenCode', 'Cards', 'List']) assert.match(body, new RegExp(`aria-pressed="[a-z]+"[^>]*>${name}</button>`), name);
  assert.match(toolbar.slice(0, toolbar.indexOf('<details')), /Search skills/, 'the search comes first');
  assert.match(toolbar.slice(toolbar.indexOf('</details>')), /Add skills/, 'and Add skills ends the row');
  // The harness chips stay in view: they are where a card is dropped.
  assert.match(markup, /class="lib-scopes"/); assert.match(markup, /data-scope="scope-copperfen"/);
});

test('the groups and their counts: 43 of yours, 1 found in several tools, and each skill is on one card', () => {
  const markup = render(), text = textOf(markup);
  assert.match(text, /Yours 43 skills/); assert.match(text, /Found in several tools 1 skill/); assert.match(text, /From libraries 1 library/);
  assert.equal([...markup.matchAll(/<article class="lib-card/g)].length, 44);
  assert.match(text, /44 skills in Studio \(global\)/);
  const conflict = markup.slice(markup.indexOf('id="lib-conflicts"'));
  assert.match(conflict, /<article class="lib-card[^"]*"[^>]*data-item="skill-triple"/); assert.match(conflict, /Found in several tools<\/li>/); assert.match(conflict, /Resolve the conflict/);
  assert.match(text, /1 skill found in several tools with different text/);
});

test('every card says where the skill is installed and which interfaces it lands in, in words, and has an Install to menu button', () => {
  const markup = render();
  assert.equal([...markup.matchAll(/aria-haspopup="menu"/g)].length, 44);
  assert.equal([...markup.matchAll(/<dt>Installed in<\/dt>/g)].length, 44); assert.equal([...markup.matchAll(/<dt>Found in<\/dt>/g)].length, 44); assert.equal([...markup.matchAll(/<dt>Written to<\/dt>/g)].length, 44);
  assert.match(markup, /Studio \(global\) and all 3 projects/); assert.match(markup, /Claude Code, Codex and OpenCode/);
  assert.match(textOf(markup), /Studio \(global\), Copperfen and Tallowbrook\. Hidden in Reedmarsh\./);
});

test('the controls have names: a search box with a label, three interface chips, four harness chips and Every harness, two view buttons and Add skills', () => {
  const markup = render();
  assert.match(markup, /<label class="lib-field lib-search"><span>Search skills<\/span><input type="search"/);
  assert.match(markup, /<span id="lib-face-label">Found in<\/span>[\s\S]*?role="group" aria-labelledby="lib-face-label"/);
  for (const name of ['Claude Code', 'Codex', 'OpenCode']) assert.match(markup, new RegExp(`<button[^>]*aria-pressed="false"[^>]*>${name}</button>`), name);
  assert.match(markup, /role="group" aria-labelledby="lib-scopes-label"/);
  assert.match(markup, /<button[^>]*aria-pressed="true"[^>]*data-scope="global"[^>]*>Studio<span> \(global\)<\/span><\/button>/, 'the global harness is the default');
  for (const [id, label] of [['all', 'Every harness'], ['scope-reedmarsh', 'Reedmarsh (project)'], ['scope-copperfen', 'Copperfen (project)'], ['scope-tallowbrook', 'Tallowbrook (project)']] as const) {
    const m = new RegExp(`<button[^>]*data-scope="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(markup);
    assert.equal(textOf(m![1]!), label, id);
  }
  assert.match(markup, /<span id="lib-view-label">View<\/span>[\s\S]*?role="group" aria-labelledby="lib-view-label"/);
  assert.match(markup, /<button[^>]*aria-expanded="false"[^>]*aria-controls="lib-add-panel"[^>]*>Add skills<\/button>/);
  assert.match(markup, /role="status" aria-live="polite"/, 'a live region for confirmations and refusals');
  assert.match(markup, /drag a card onto a harness at the top of the screen, or choose Install to on the card/);
  // Every button has a name made of words.
  for (const m of markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)) assert.ok(textOf(m[1]!) !== '' || /aria-label=/.test(m[0]), m[0]);
});

test('Evergreen Kit shows its pinned version and the new version notice, and has no skills to open; a library with skills is closed', () => {
  const text = textOf(render());
  assert.match(text, /Evergreen Kit 0 skills/); assert.match(text, /Pinned to version 2\.3\.0\. Read only\./); assert.match(text, /New version waiting: 2\.4\.0/); assert.match(text, /It holds 120 agents and no skills\. See the Agents screen\./);
  const markup = render(withLantern());
  assert.match(markup, /<button[^>]*class="lib-group-toggle"[^>]*aria-expanded="false"/, 'collapsed by default');
  assert.equal([...markup.matchAll(/<article class="lib-card/g)].length, 44, 'the six skills of the new library are not drawn while it is closed');
  assert.match(textOf(markup), /Lantern Works 6 skills/); assert.match(textOf(markup), /Pinned to version 1\.2\.0\. Read only\./);
  assert.match(textOf(markup), /From libraries 2 libraries/);
});

test('a library card says it is read only and offers an editable copy; a skill with a newer version says so', () => {
  const s = withLantern(), w = s.getState().draft;
  const item = w.items.find(i => i.id === 'lantern-works-beam-aiming') as SkillItem;
  const row = skillRows(w, 'global').find(r => r.item.id === item.id)!;
  const handlers = { entries: () => [], onInstall: () => undefined, onProjectChoice: () => undefined, onResolve: () => undefined, onPointerDown: () => undefined };
  const card = (r = row, inProject = false): string => renderToStaticMarkup(createElement(SkillCard, { row: r, placement: describePlacement(w, r.item), level: 4, inProject, isNew: false, lifted: false, handlers }));
  const text = textOf(card());
  assert.match(text, /Read only/); assert.match(text, /Not installed\. It is a reference to a library\./); assert.match(text, /Nothing\. A library item is a reference\./);
  assert.match(card(), /<h4 id=/);
  const newer = { ...row, item: { ...item, library: { ...item.library!, newerVersion: '1.3.0' } } };
  assert.match(textOf(card(newer)), /New version waiting: 1\.3\.0/);
  // In a project an inherited skill can be hidden, and a hidden one can be kept again.
  const inherited = skillRows(w, CASE_IDS.hidingScope).find(r => r.state === 'inherited')!, hidden = skillRows(w, CASE_IDS.hidingScope).find(r => r.state === 'hidden')!;
  assert.match(textOf(card(inherited, true)), /Inherited from Studio/); assert.match(textOf(card(inherited, true)), /Hide in this project/);
  assert.match(textOf(card(hidden, true)), /Hidden in this project/); assert.match(textOf(card(hidden, true)), /Keep from global/);
  assert.match(card(hidden, true), /lib-card is-hidden/, 'a hidden card has a dashed outline as well as the words');
  assert.doesNotMatch(textOf(card(inherited, false)), /Hide in this project/, 'the choice is for a project only');
});

test('LibrarySection: closed it shows no cards, open it shows its children', () => {
  const g = groupSkills(withLantern().getState().draft, skillRows(withLantern().getState().draft, 'global'), { query: '', interfaceId: null }).libraries.find(l => l.library.id === 'lantern-works')!;
  const closed = renderToStaticMarkup(createElement(LibrarySection, { group: g, open: false, onToggle: () => undefined, matchNote: null, children: createElement('p', null, 'INSIDE') }));
  assert.doesNotMatch(closed, /INSIDE/);
  const open = renderToStaticMarkup(createElement(LibrarySection, { group: g, open: true, onToggle: () => undefined, matchNote: '2 match', children: createElement('p', null, 'INSIDE') }));
  assert.match(open, /INSIDE/); assert.match(open, /aria-expanded="true"/); assert.match(textOf(open), /6 skills, 2 match/);
});

test('the Add skills panel: a folder source with ticks and found words, a library source with Evergreen Kit installed and Lantern Works to add, and the one sentence', () => {
  const ref = { current: null };
  const markup = renderToStaticMarkup(createElement(AddSkillsPanel, { offers: libraryOffers(world), ticked: new Set([FOLDER_CANDIDATES[0]!.skills[0]!.id]), onTick: () => undefined, onFolder: () => undefined, onAddLibrary: () => undefined, headingRef: ref }));
  const text = textOf(markup);
  assert.match(markup, /<h2[^>]*>Add skills<\/h2>/); assert.match(markup, /<h3[^>]*>From a folder<\/h3>/); assert.match(markup, /<h3[^>]*>From a library<\/h3>/);
  for (const f of FOLDER_CANDIDATES) { assert.ok(text.includes(f.name), f.name); for (const s of f.skills) assert.ok(text.includes(s.name), s.name); }
  assert.equal([...markup.matchAll(/type="checkbox"/g)].length, FOLDER_CANDIDATES.reduce((n, f) => n + f.skills.length, 0));
  assert.equal([...markup.matchAll(/checked=""/g)].length, 1);
  assert.match(text, /Found, not read yet/); assert.match(text, /It reads a folder only after you approve it\./);
  assert.match(text, /Evergreen Kit version 2\.3\.0/); assert.match(text, /Installed/); assert.match(text, /New version waiting: 2\.4\.0/);
  assert.match(markup, /<button[^>]*class="btn"[^>]*>Add this library<\/button>/); assert.match(markup, /aria-label="Add this library: Lantern Works"/);
  assert.match(text, /A library stays a reference until you edit an item\. Then Bowerloom makes your own copy of that one item\./);
  assert.match(text, /Add the ticked skill/); assert.match(markup, /disabled=""[^>]*>Tick a skill to add it/); assert.match(markup, /aria-label="Add the ticked skill: Harbour notes"/);
  const after = createStore(world); after.dispatch({ type: 'addLibrary', libraryId: 'lantern-works' });
  const two = textOf(renderToStaticMarkup(createElement(AddSkillsPanel, { offers: libraryOffers(after.getState().draft), ticked: new Set<string>(), onTick: () => undefined, onFolder: () => undefined, onAddLibrary: () => undefined, headingRef: ref })));
  assert.doesNotMatch(two, /Add this library/);
});

test('with changes waiting, the waiting list shows the change bar\'s own words and a line for each interface', () => {
  const s = createStore(world);
  s.dispatch({ type: 'attachSkill', agentId: 'agent-01', skillId: 'skill-030' });
  const markup = render(s), text = textOf(markup);
  assert.match(text, /Waiting to apply \d+ edits? waiting\. \d+ files? would change\./); assert.match(text, /Claude Code: \d+ changed/); assert.match(text, /Apply on the Harness screen\./);
  assert.match(textOf(render()), /Waiting to apply No changes waiting Apply on the Harness screen\./);
  // One plain line: the heading is for a screen reader, and the count and the pointer to the Harness screen are one paragraph.
  const idle = render();
  assert.match(idle, /<h2 id="[^"]+" class="sr">Waiting to apply<\/h2>/);
  assert.match(idle, /<p class="lib-waiting-count"><strong>No changes waiting<\/strong> <span class="lib-waiting-where small muted">Apply on the Harness screen\.<\/span><\/p>/);
});

test('the words are plain: no helper, no team, no command line, no em-dash, and no path as a main label', () => {
  const words = [render(), render(withLantern())].map(textOf);
  words.push(textOf(renderToStaticMarkup(createElement(SkillsScreen, { world }))));
  for (const w of words) { assert.doesNotMatch(w, COMMAND, w.slice(0, 80)); assert.doesNotMatch(w, BANNED_WORD, w.slice(0, 80)); assert.doesNotMatch(w, /—/); }
  assert.doesNotMatch(render(), /<h[1-6][^>]*>[^<]*\/Users\//, 'a heading is never a path');
  assert.deepEqual(clientNames(textOf(render())), []);
});

test('the style sheet uses tokens only: no colour value, no time value, the motion tokens for hover and the drop settle, and a reduce-motion rule', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/proto/library-manager.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'colours come from tokens');
  assert.doesNotMatch(css, /\b\d+(\.\d+)?m?s\b(?!\w)/, 'durations come from the motion tokens');
  assert.match(css, /var\(--motion-hover-ms\)/); assert.match(css, /var\(--motion-drop-settle-ms\)/); assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /border-left:\s*\d+px|border-left-width|border-right:\s*\d+px/, 'no thick one-sided accent border');
  for (const f of ['SkillsScreen.tsx', 'skills-parts.tsx', 'library-parts.tsx', 'AgentsScreen.tsx', 'agents-parts.tsx']) {
    const code = readFileSync(join(DESKTOP, 'renderer/proto', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /style=\{|innerHTML|dangerouslySetInnerHTML|Math\.random|\bDate\b|window\.bowerloom/, f); assert.doesNotMatch(code, BANNED_WORD, f); assert.doesNotMatch(code, /—/, f);
  }
});
