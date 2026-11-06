// The tests of the modules that still ship from the old home app, ported from the deleted home-* test files of task/0.8-launch with only their imports changed:
// the card kit that the harness screens use (drawer step, Button, Drawer, IconButton, Tooltip, SortMenu, Stepper and its style sheet, the icon paths), the shell's pure logic
// (navigation width, shortcuts, branch lines, glide box, arrow keys), the window options, and the text budget used by the word-rule tests. Every assertion is the one of the old file.
// Where an old test imported a module that is gone, the few values it took from there are written beside the imports and marked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { windowOptions } from '../main/window-options.js';
import { Button } from '../renderer/home/kit/Button.js';
import { Drawer } from '../renderer/home/kit/Drawer.js';
import { drawerStep } from '../renderer/home/kit/drawer-phase.js';
import { IconButton } from '../renderer/home/kit/IconButton.js';
import { KIT_ICON_NAMES } from '../renderer/home/kit/icons.js';
import { SortList, SortMenu } from '../renderer/home/kit/SortMenu.js';
import { Stepper, stepState } from '../renderer/home/kit/Stepper.js';
import { Tooltip } from '../renderer/home/kit/Tooltip.js';
import { NAV_HIDE_BELOW, NAV_RAIL_BELOW, NAV_WIDTH, branchGeometry, foldMove, glideBox, keyShortcuts, navModeOf, roveTarget, shellKey, shortcutText, toggleTip } from '../renderer/home/shell/shell-state.js';
import { BANNED, BANNED_PATTERN, assertTextBudget, countWords, extractText } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

/** Was imported from renderer/home/first-run/find-steps.js, which is gone: the three words of the Find steps and the index past the last one. */
const FIND_STEP_WORDS = ['Look', 'Choose', 'Read'] as const;
const FIND_STEPS_DONE = 3;

// Helpers shared by the ported tests (each was defined in the file the test came from).
const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);
const none = (): void => undefined;
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 200));
const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
const ok = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup);
const problems = (markup: string): string[] => assertTextBudget(markup);
const CHOICES = [{ mode: 'name', label: 'Name' }, { mode: 'recent', label: 'Recently changed' }] as const;

// ---- from home-kit-logic

test('the drawer is closed, opens, and closes in two steps so it can slide out; with no motion it closes at once', () => {
  assert.equal(drawerStep('closed', true, true), 'open');
  assert.equal(drawerStep('open', false, true), 'closing');
  assert.equal(drawerStep('closing', false, true), 'closing');
  assert.equal(drawerStep('open', false, false), 'closed', 'no animation: closed at once');
  assert.equal(drawerStep('closing', true, true), 'open', 'opened again while closing');
  assert.equal(drawerStep('closed', false, true), 'closed');
  assert.equal(drawerStep('open', true, true), 'open');
});

// ---- from home-shell-state

test('the navigation follows the width until the person chooses: open from 1100, a rail from 900, hidden under 900', () => {
  assert.deepEqual([NAV_HIDE_BELOW, NAV_RAIL_BELOW, NAV_WIDTH.open, NAV_WIDTH.rail], [900, 1100, 232, 48]);
  assert.equal(navModeOf(1440, null), 'open'); assert.equal(navModeOf(1280, null), 'open'); assert.equal(navModeOf(1100, null), 'open');
  assert.equal(navModeOf(1099, null), 'rail'); assert.equal(navModeOf(900, null), 'rail');
  assert.equal(navModeOf(899, null), 'hidden'); assert.equal(navModeOf(600, null), 'hidden');
});

test('a choice wins over the width, except that under 900 the navigation is hidden whatever was chosen', () => {
  assert.equal(navModeOf(1440, false), 'rail'); assert.equal(navModeOf(900, true), 'open');
  assert.equal(navModeOf(899, true), 'hidden'); assert.equal(navModeOf(300, false), 'hidden');
});

test('Ctrl+B or Cmd+B toggles the navigation, with Shift the details, and nothing else is a shortcut', () => {
  assert.equal(shellKey(key('b', { ctrlKey: true })), 'nav'); assert.equal(shellKey(key('b', { metaKey: true })), 'nav'); assert.equal(shellKey(key('B', { metaKey: true })), 'nav');
  assert.equal(shellKey(key('b', { ctrlKey: true, shiftKey: true })), 'details'); assert.equal(shellKey(key('B', { metaKey: true, shiftKey: true })), 'details');
  assert.equal(shellKey(key('b')), null, 'a plain b is a letter'); assert.equal(shellKey(key('b', { shiftKey: true })), null);
  assert.equal(shellKey(key('b', { ctrlKey: true, altKey: true })), null); assert.equal(shellKey(key('z', { ctrlKey: true })), null); assert.equal(shellKey(key('k', { metaKey: true })), null);
});

test('a toggle tooltip names the action and the shortcut the way the keyboard does, and stays within the text budget', () => {
  assert.equal(shortcutText('nav', true), '⌘B'); assert.equal(shortcutText('details', true), '⇧⌘B');
  assert.equal(shortcutText('nav', false), 'Ctrl+B'); assert.equal(shortcutText('details', false), 'Ctrl+Shift+B');
  assert.equal(toggleTip('Hide navigation', 'nav', false), 'Hide navigation (Ctrl+B)'); assert.equal(toggleTip('Show details', 'details', true), 'Show details (⇧⌘B)');
  assert.equal(keyShortcuts('nav'), 'Control+B Meta+B'); assert.equal(keyShortcuts('details'), 'Control+Shift+B Meta+Shift+B');
  for (const mac of [true, false]) for (const [name, which] of [['Hide navigation', 'nav'], ['Show navigation', 'nav'], ['Hide details', 'details'], ['Show details', 'details']] as const) assert.deepEqual(assertTextBudget(`<p>${toggleTip(name, which, mac)}</p>`), []);
});

test('Up and Down move through the navigation and stop at the ends; Home and End jump; other keys stay', () => {
  assert.equal(roveTarget('ArrowDown', 0, 5), 1); assert.equal(roveTarget('ArrowDown', 4, 5), 4); assert.equal(roveTarget('ArrowUp', 3, 5), 2); assert.equal(roveTarget('ArrowUp', 0, 5), 0);
  assert.equal(roveTarget('Home', 3, 5), 0); assert.equal(roveTarget('End', 1, 5), 4);
  assert.equal(roveTarget('ArrowLeft', 1, 5), null); assert.equal(roveTarget('Enter', 1, 5), null); assert.equal(roveTarget('ArrowDown', 0, 0), null);
});

// ---- from home-sidebar-stepper

test('the branch of a folder: a trunk that stops 5 px above the last middle, and one curved elbow for each child', () => {
  const g = branchGeometry(4);
  assert.equal(g.height, 4 * 32 + 3 * 2);
  assert.equal(g.trunk, 'M0.5 0 V113', 'the last child is centred at 3 * 34 + 16 = 118');
  assert.deepEqual(g.elbows, ['M0.5 11 Q0.5 16 5.5 16 H11.5', 'M0.5 45 Q0.5 50 5.5 50 H11.5', 'M0.5 79 Q0.5 84 5.5 84 H11.5', 'M0.5 113 Q0.5 118 5.5 118 H11.5']);
  assert.equal(branchGeometry(1).trunk, 'M0.5 0 V11');
  assert.deepEqual(branchGeometry(0), { height: 0, trunk: '', elbows: [] });
  assert.deepEqual(branchGeometry(Number.NaN).elbows, []);
});

test('the hover highlight takes the box of the item, measured from the navigation', () => {
  assert.deepEqual(glideBox({ left: 20, top: 150, width: 200, height: 32 }, { left: 0, top: 40, width: 232, height: 700 }), { left: 20, top: 110, width: 200, height: 32 });
});

test('Right opens a closed folder and steps into an open one, Left closes an open folder and steps out of a child; other keys do nothing', () => {
  assert.equal(foldMove('ArrowRight', false, true, false), 'open');
  assert.equal(foldMove('ArrowRight', true, true, false), 'in');
  assert.equal(foldMove('ArrowLeft', true, true, false), 'close');
  assert.equal(foldMove('ArrowLeft', false, true, false), null, 'a closed folder has nowhere to go');
  assert.equal(foldMove('ArrowLeft', false, false, true), 'out');
  assert.equal(foldMove('ArrowRight', false, false, true), null, 'a child does not fold');
  assert.equal(foldMove('ArrowDown', true, true, false), null);
});

test('a step is done before the current one, now at it and next after it', () => {
  assert.deepEqual([0, 1, 2].map(i => stepState(i, 1)), ['done', 'now', 'next']);
  assert.deepEqual([0, 1, 2].map(i => stepState(i, FIND_STEPS_DONE)), ['done', 'done', 'done']);
});

test('the stepper is an ordered list with a name: a check on a done step, aria-current on the current one, and no pill', () => {
  const html = renderToStaticMarkup(createElement(Stepper, { steps: FIND_STEP_WORDS, current: 1, label: 'Find steps', doneWord: 'done' }));
  assert.match(html, /^<ol class="kit-stepper" aria-label="Find steps">/);
  assert.equal([...html.matchAll(/<li /g)].length, 3);
  assert.equal([...html.matchAll(/aria-current="step"/g)].length, 1);
  assert.match(html, /<li class="kit-step" data-state="done"><span class="kit-step-dot" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span><span class="kit-step-label">Look<span class="hm-sr"> done<\/span><\/span><\/li>/);
  assert.match(html, /<li class="kit-step" data-state="now" aria-current="step"><span class="kit-step-dot" aria-hidden="true">2<\/span><span class="kit-step-label">Choose<\/span>/);
  assert.match(html, /data-state="next"><span class="kit-step-dot" aria-hidden="true">3</);
  assert.equal([...html.matchAll(/<svg/g)].length, 1, 'only the done step has a check');
  assert.doesNotMatch(html, /pill|<button/);
  assert.deepEqual(assertTextBudget(html), []);
});

test('the compact stepper shows the words of the current step only, with the tour text, and keeps the others for a screen reader', () => {
  const html = renderToStaticMarkup(createElement(Stepper, { compact: true, steps: ['Map', 'Agent', 'Details'], current: 1, label: 'Tour steps', currentText: 'Step 2 of 3' }));
  assert.match(html, /data-compact=""/);
  assert.match(html, /<span class="kit-step-label">Step 2 of 3<\/span>/);
  assert.match(html, /<span class="kit-step-label hm-sr">Map<\/span>/); assert.match(html, /<span class="kit-step-label hm-sr">Details<\/span>/);
  assert.deepEqual(assertTextBudget(html), []);
});

test('the stepper style sheet has no text under 14 px, a dim future step, no fixed time and a reduce-motion rule', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/kit/stepper.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\[data-state="next"\]\s*\{\s*opacity: 0\.55/);
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) assert.ok(parseFloat(m[1]!) * (m[2] === 'rem' ? 16 : 1) >= 14, m[0]);
  assert.doesNotMatch(css, /radius-pill|999px/, 'no pill');
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
});

// ---- from home-icon-button

test('an icon button has a name, one icon, no words, a tooltip that describes it, and the 32 px square flag', () => {
  const m = renderToStaticMarkup(createElement(IconButton, { icon: 'trash', label: 'Remove', onClick: none }));
  const button = /<button[^>]*>/.exec(m)![0];
  assert.match(button, /aria-label="Remove"/); assert.match(button, /data-icon-only=""/); assert.match(button, /type="button"/);
  const described = /aria-describedby="([^"]+)"/.exec(button);
  assert.ok(described !== null, 'described by the tooltip');
  assert.match(m, new RegExp(`<span class="kit-tip-text" role="tooltip" id="${described![1]!.replace(/[:]/g, '\\$&')}">Remove</span>`));
  assert.match(m, /<button[^>]*><svg[^>]*>[\s\S]*<\/svg><\/button>/, 'the button holds the icon and no words');
  assert.doesNotMatch(m, /data-open/, 'closed when drawn');
  assert.deepEqual(assertTextBudget(m), []);
});

test('the tooltip can say something other than the name, and sits on the side asked for', () => {
  const m = renderToStaticMarkup(createElement(IconButton, { icon: 'sidebar-left', label: 'Hide navigation', tip: 'Hide navigation (Ctrl+B)', side: 'right' }));
  assert.match(m, /aria-label="Hide navigation"/); assert.match(m, /data-side="right"[^>]*>Hide navigation \(Ctrl\+B\)</);
  assert.doesNotMatch(renderToStaticMarkup(createElement(IconButton, { icon: 'close', label: 'Close' })), /data-side/, 'the default side leaves the markup as it was');
});

test('every icon in the kit has paths to draw, and the new ones are there', () => {
  for (const name of ['sidebar-left', 'sidebar-right', 'search', 'trash', 'undo', 'copy', 'chevron-up', 'sort', 'library', 'help', 'globe', 'select-all', 'clear', 'lock'] as const) assert.ok(KIT_ICON_NAMES.includes(name), name);
});

test('a tooltip that is off leaves out its words and its description, and keeps the button where it was', () => {
  const draw = (off: boolean): string => renderToStaticMarkup(createElement(Tooltip, { text: 'Agents', side: 'right', off, children: aria => createElement('button', { type: 'button', ...aria }, 'Agents') }));
  const on = draw(false), away = draw(true);
  assert.match(on, /aria-describedby/); assert.match(on, /role="tooltip"/); assert.match(on, /data-side="right"/);
  assert.doesNotMatch(away, /aria-describedby|role="tooltip"/); assert.match(away, /^<span class="kit-tip"><button type="button">Agents<\/button><\/span>$/);
});

// ---- from home-kit-markup

test('a button is primary, quiet or text, round when asked, and never has a style attribute', () => {
  const p = html(createElement(Button, { variant: 'primary', icon: 'plus' }, 'Add'));
  assert.match(p, /data-variant="primary"/); assert.match(p, /type="button"/); assert.doesNotMatch(p, /style=/);
  assert.match(html(createElement(Button, {}, 'Go')), /data-variant="quiet"/); assert.match(html(createElement(Button, { variant: 'text' }, 'Find more')), /data-variant="text"/);
  assert.match(html(createElement(Button, { round: true, 'aria-label': 'Help' }, '?')), /data-round=""[^>]*>\?<|aria-label="Help"/);
  assert.match(html(createElement(Button, { disabled: true }, 'Save')), /disabled=""/);
});

test('a drawer is a labelled dialog with a title that can take the focus and a Close button', () => {
  const m = html(createElement(Drawer, { open: true, title: 'Add', onClose: none, dataSlot: 'add' }, createElement('p', { className: 'kit-hint' }, 'Nothing to add yet.')));
  assert.match(m, /<aside class="kit-drawer" role="dialog" aria-modal="false" aria-labelledby="([^"]+)" data-phase="open" data-slot="add">/);
  assert.match(m, /<h2 class="kit-heading" id="([^"]+)" tabindex="-1">Add<\/h2>/); assert.match(m, /aria-label="Close"/);
  assert.equal(/aria-labelledby="([^"]+)"/.exec(m)![1], /<h2[^>]*id="([^"]+)"/.exec(m)![1]);
  assert.equal(html(createElement(Drawer, { open: false, title: 'Add', onClose: none })), '', 'a closed drawer draws nothing');
  within(m);
  assert.match(html(createElement(Drawer, { open: true, inline: true, level: 4, title: 'Add', onClose: none })), /<h4 /);
});

// ---- from home-map-markup

test('the sort control is one icon button named Sort that opens a menu; the menu is a list of two radio items, the one in use is checked, and no item has an icon or a tick', () => {
  const closed = html(createElement(SortMenu, { mode: 'name', choices: CHOICES, onChange: none, label: 'Sort', menuLabel: 'Order of the agents' }));
  assert.match(closed, /aria-label="Sort"/); assert.match(closed, /aria-haspopup="menu"/); assert.match(closed, /aria-expanded="false"/); assert.doesNotMatch(closed, /role="menu"/, 'the menu is not in the page until it is opened');
  assert.equal([...closed.matchAll(/<svg/g)].length, 1, 'the icon button holds one icon'); within(closed);
  const byName = html(createElement(SortList, { id: 'm', mode: 'name', choices: CHOICES, label: 'Order of the agents', onPick: none }));
  assert.match(byName, /role="menu" aria-label="Order of the agents"/);
  assert.match(byName, /role="menuitemradio"[^>]*aria-checked="true"[^>]*data-sort="name"[^>]*>Name</); assert.match(byName, /role="menuitemradio"[^>]*aria-checked="false"[^>]*data-sort="recent"[^>]*>Recently changed</);
  const recent = html(createElement(SortList, { id: 'm', mode: 'recent', choices: CHOICES, label: 'Order of the agents', onPick: none }));
  assert.match(recent, /aria-checked="false"[^>]*data-sort="name"/); assert.match(recent, /aria-checked="true"[^>]*data-sort="recent"[^>]*>Recently changed</);
  assert.doesNotMatch(byName, /<svg/); assert.doesNotMatch(recent, /<svg/);
  within(byName); within(recent);
});

// ---- from home-window

test('every launch opens at 1280 by 800 and is called Bowerloom', () => {
  const o = windowOptions();
  assert.deepEqual({ width: o.width, height: o.height, title: o.title }, { width: 1280, height: 800, title: 'Bowerloom' });
});

test('main.ts builds the window from these options and keeps the title while the page loads', () => {
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /\.\.\.windowOptions\(\)/);
  assert.match(main, /page-title-updated/);
});

// ---- from home-textbudget

test('countWords counts words and ignores bare punctuation', () => {
  assert.equal(countWords(''), 0); assert.equal(countWords('  '), 0); assert.equal(countWords('One'), 1);
  assert.equal(countWords('Click an agent to see what it can do.'), 9);
  assert.equal(countWords('a · b — c'), 3, 'a dot or a dash is not a word');
  assert.equal(countWords('2 of 6'), 3);
});

test('extractText decodes entities, skips scripts and styles, and reports the nodes in order', () => {
  const nodes = extractText('<div><p>Fish &amp; chips</p><style>.a{}</style><span>It&#x27;s&nbsp;fine</span></div>');
  assert.deepEqual(nodes.map(n => n.text), ['Fish & chips', 'It\'s fine']);
});

test('markup within the limits passes', () => {
  ok('<section><h2>Skills</h2><p>Nothing here yet.</p><button type="button">Save</button></section>');
  ok('<button>One two three four five</button>');
  ok('<p>one two three four five six seven eight nine ten eleven twelve</p>');
  ok('');
  ok('<div><svg viewBox="0 0 24 24"><path d="M1 1"></path></svg></div>');
});

test('a text node of more than 12 words fails, and the problem quotes where it starts', () => {
  const list = problems('<p>one two three four five six seven eight nine ten eleven twelve thirteen</p>');
  assert.equal(list.length, 1); assert.match(list[0]!, /13 words/); assert.match(list[0]!, /one two three/);
});

test('a heading or a button of more than 5 words fails, whatever is nested inside it', () => {
  assert.equal(problems('<h2>One two three four five six</h2>').length, 1);
  assert.equal(problems('<h1>One <em>two three</em> four five six</h1>').length, 1);
  assert.equal(problems('<button type="button">One two three four five six</button>').length, 1);
  assert.equal(problems('<button><span>One two</span><span>three four</span><span>five six</span></button>').length, 1);
  for (const tag of ['h1', 'h2', 'h3', 'h4']) assert.equal(problems(`<${tag}>a b c d e f</${tag}>`).length, 1, tag);
});

test('a label in an attribute (aria-label, title) has the same 5 word limit', () => {
  assert.equal(problems('<button aria-label="One two three four five six">?</button>').length, 1);
  ok('<button aria-label="Show me around">?</button>');
});

test('the banned words fail as whole words, in any case, and a longer word is fine', () => {
  for (const word of ['harness', 'Global', 'SCOPE', 'slice', 'version', 'apply', 'scan', 'adopt', 'conflict', 'interface', 'export', 'import', 'helper', 'team', 'plan', 'grant', 'wire', 'ghost', 'lasso', 'MCP', 'token', 'project']) {
    assert.equal(problems(`<p>Use the ${word} now</p>`).length, 1, word);
  }
  assert.equal(problems('<p>Many Harnesses</p><p>and teams</p>').length, 2, 'plurals count');
  ok('<p>Planet, imported, sliced, Teamwork, grantee, scanner.</p>');
  assert.equal(problems('<p>The access class</p>').length, 1, 'a two word banned phrase');
});

test('the words the storyboard asks for are fine, including "This project only"', () => {
  ok('<button>This project only</button><button>Everywhere</button><p>Version history, Go back, Find, Bring in, Share, Open a shared file</p><p>Draw a loop</p><p>can only read</p>');
  assert.equal(problems('<p>The project folder</p>').length, 1, 'project alone is still banned');
});

test('"Undo" is a plain word of the screens since the maintainer chose it (2026-10-25): the note after Remove, the Undo beside each change, "Undo all changes"', () => {
  ok('<button>Undo</button><button>Undo all changes</button><p>Removed Write a reply.</p><p>Undo the later change first.</p>');
});

test('"version history" is the one phrase that lets "version" through; the word "history" alone is fine, and bare "version" stays banned', () => {
  ok('<button aria-label="Version history">x</button><h2>Version history</h2><p>VERSION HISTORY</p><p>version  history</p><p>Your history</p>');
  assert.equal(problems('<p>The version</p>').length, 1); assert.equal(problems('<p>Two versions</p>').length, 1);
  assert.equal(problems('<p>Version 2</p>').length, 1); assert.equal(problems('<p>Version histories</p>').length, 1, 'only the exact phrase');
  assert.equal(problems('<p>Version history and a version</p>').length, 1, 'a bare version beside the phrase is still caught');
  assert.equal(problems('<p>A version of history</p>').length, 1);
  assert.ok(BANNED.includes('version') && !BANNED.includes('history'));
});

test('content (the full text of a skill) has no word limit, and still has the banned words', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  ok(`<div data-budget="content"><p>${long}</p><p>${long}</p></div>`);
  ok(`<div data-budget="content"><div><p>${long}</p></div></div>`);
  assert.equal(problems(`<div data-budget="content"><p>${long}</p></div><p>${long}</p>`).length, 1, 'text after the block is outside it again');
  assert.equal(problems('<div data-budget="content"><p>Read the plan first.</p></div>').length, 1, 'a banned word in content fails');
  assert.equal(problems('<div data-budget="content"><p>It runs over MCP.</p></div>').length, 1, 'MCP is a popover word, not a content word');
  assert.equal(problems('<div data-budget="content"><p>Meet the team in a version.</p></div>').length, 1);
  ok('<div data-budget="content"><p>Read the version history.</p></div>');
  assert.ok(extractText('<div data-budget="content"><p>One.</p></div><p>Two.</p>').map(p => p.content).join() === 'true,false');
});

test('a banned word in an attribute label also fails', () => {
  assert.equal(problems('<button aria-label="Apply it">x</button>').length, 1);
});

test('popover text may run to 25 words and may say MCP, and only popover text', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
  ok(`<div data-budget="popover"><p>${twenty}</p></div>`);
  ok('<div data-budget="popover"><p>MCP is how an agent talks to another program.</p></div>');
  const twentySix = Array.from({ length: 26 }, (_, i) => `w${i}`).join(' ');
  assert.equal(problems(`<div data-budget="popover"><p>${twentySix}</p></div>`).length, 1);
  assert.equal(problems('<p>MCP is on.</p>').length, 1, 'outside a popover MCP fails');
  assert.equal(problems('<div data-budget="popover"><p>The harness runs.</p></div>').length, 1, 'other banned words still fail inside a popover');
  assert.equal(problems(`<div data-budget="popover"><h3>One two three four five six</h3></div>`).length, 0, 'a popover heading may be longer, up to 25');
  assert.equal(problems(`<div data-budget="popover">${twenty}</div><p>${twenty}</p>`).length, 1, 'text after the popover is outside it again');
});

test('a popover keeps its exemption through nested tags and sibling tags', () => {
  ok(`<aside data-budget="popover"><div><p>${Array.from({ length: 24 }, (_, i) => `w${i}`).join(' ')}</p></div></aside><p>Short.</p>`);
});

test('several problems are all reported', () => {
  const list = problems('<h2>a b c d e f</h2><p>The harness is here</p><button>a b c d e f g</button>');
  assert.equal(list.length, 3);
});

test('BANNED lists the required words, and BANNED_PATTERN is built from it', () => {
  for (const word of ['harness', 'global', 'project', 'scope', 'slice', 'version', 'apply', 'scan', 'adopt', 'conflict', 'interface', 'export', 'import', 'access class', 'helper', 'team', 'plan', 'grant', 'wire', 'ghost', 'lasso', 'mcp', 'token']) assert.ok(BANNED.includes(word), word);
  assert.equal(Object.isFrozen(BANNED), true);
  assert.ok(BANNED_PATTERN.test('A Harness'));
});

test('the title of a clipped job line, marked as a tooltip, may run to twelve words; any other title keeps five', () => {
  ok('<p data-budget="tooltip" title="Sits in on your meetings and writes them up for you.">Sits in on your...</p>');
  assert.equal(problems('<p data-budget="tooltip" title="One two three four five six seven eight nine ten eleven twelve thirteen">x</p>').length, 1, 'thirteen words is too many for a tooltip');
  assert.equal(problems('<p title="Sits in on your meetings and writes them up for you.">x</p>').length, 1, 'an ordinary title has five words');
  assert.equal(problems('<p data-budget="tooltip" aria-label="One two three four five six">x</p>').length, 1, 'only the title is a tooltip, an aria-label keeps five');
  assert.equal(problems('<p data-budget="tooltip" title="Apply this to every agent">x</p>').length, 1, 'a tooltip still has no banned word');
});
