// The branching sidebar (branch lines, folding, the hover glide) and the stepper (the Find steps, the compact tour version).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from '../renderer/home/shell/Sidebar.js';
import type { SidebarProps } from '../renderer/home/shell/Sidebar.js';
import { branchGeometry, foldMove, glideBox } from '../renderer/home/shell/shell-state.js';
import { Stepper, stepState } from '../renderer/home/kit/Stepper.js';
import { FIND_STEP_WORDS, FIND_STEPS_DONE, stageOfFind, stageOfReal } from '../renderer/home/first-run/find-steps.js';
import type { FindStep } from '../shared/home/find-flow.js';
import type { RealStep } from '../renderer/home/real/flow.js';
import { assertTextBudget } from '../shared/home/textbudget.js';
import { DESKTOP } from './support.js';

const noop = (): void => undefined;
const side = (over: Partial<SidebarProps>): string => renderToStaticMarkup(createElement(Sidebar, {
  mode: 'open', overlay: false, view: 'agents', libraryKind: 'skill', libraryOpen: true, addOpen: false, historyOpen: false, findOpen: false, readOnly: false, real: false,
  onToggle: noop, onAgents: noop, onLibrary: noop, onAdd: noop, onFind: noop, onShare: noop, onHistory: noop, onTour: noop, onHow: noop, ...over,
}));

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

test('the sidebar draws two sections with a chevron header, and the Library folder with its branch', () => {
  const html = side({ view: 'agents' });
  assert.match(html, /<button[^>]*data-nav-key="sec-work"[^>]*aria-expanded="true"[^>]*aria-controls="hm-nav-work"[^>]*>(?:(?!<\/button>)[\s\S])*Workspace/);
  assert.match(html, /<button[^>]*data-nav-key="sec-more"[^>]*aria-expanded="true"[^>]*>(?:(?!<\/button>)[\s\S])*More/);
  const items = [...html.matchAll(/<button[^>]*data-nav-item=""[^>]*>/g)].map(m => m[0]);
  assert.equal(items.filter(b => /tabindex="0"/.test(b)).length, 1, 'still one Tab stop');
  assert.equal(items.filter(b => /aria-current="page"/.test(b)).length, 1);
  assert.match(html, /<nav class="hm-nav" id="hm-nav"/); assert.doesNotMatch(html, /role="tree"/);
  // The folder is closed on the Agents page: its children are drawn but inert, with the branch inside.
  assert.match(html, /data-nav-key="library"[^>]*data-fold="folder"[^>]*aria-expanded="false"[^>]*aria-controls="hm-nav-library"/);
  assert.match(html, /<div class="hm-fold" id="hm-nav-library"><div class="hm-fold-inner" inert="">/);
  assert.equal([...html.matchAll(/<svg class="hm-branch"/g)].length, 1);
  assert.equal([...html.matchAll(/<svg class="hm-branch"[\s\S]*?<\/svg>/g)][0]![0].match(/<path/g)!.length, 5, 'a trunk and four elbows');
  assert.equal([...html.matchAll(/data-sub=""/g)].length, 4);
  const open = side({ view: 'library', libraryKind: 'note' });
  assert.match(open, /<div class="hm-fold" id="hm-nav-library" data-unfolded=""><div class="hm-fold-inner">/);
  assert.match(open, /data-nav-key="library"[^>]*aria-expanded="true"/);
  assert.match(open, /data-nav-key="lib-note"[^>]*aria-current="page"|aria-current="page"[^>]*data-nav-key="lib-note"/);
  assert.doesNotMatch(open, /✓/);
  assert.deepEqual(assertTextBudget(html), []); assert.deepEqual(assertTextBudget(open), []);
});

test('the sidebar keeps its tour hooks and puts Find more, Share and Version history under More and Help at the foot', () => {
  const html = side({});
  for (const hook of ['bar', 'add', 'share', 'help']) assert.match(html, new RegExp(`data-tour="${hook}"`));
  assert.ok(html.indexOf('data-nav-key="sec-more"') < html.indexOf('data-nav-key="find"') && html.indexOf('data-nav-key="find"') < html.indexOf('data-nav-key="history"'));
  assert.ok(html.indexOf('data-nav-key="history"') < html.indexOf('data-nav-key="help"'), 'Help is at the foot');
  assert.match(html, /<span class="hm-nav-glide" aria-hidden="true">/);
});

test('in the rail every section is open, so the icons show whatever was folded', () => {
  const rail = side({ mode: 'rail', view: 'agents' });
  assert.match(rail, /data-nav-key="sec-work"[^>]*aria-expanded="true"/);
  assert.match(rail, /data-nav-key="find"/);
  assert.match(rail, /data-mode="rail"/);
});

test('the sidebar style sheet folds by grid rows, keeps text at 14 px or more and takes every time from a token', () => {
  const css = readFileSync(join(DESKTOP, 'renderer/home/shell/shell.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.hm-fold\s*\{[^}]*grid-template-rows: 0fr;[^}]*transition: grid-template-rows var\(--motion-home-nav-ms/);
  assert.match(css, /\.hm-fold\[data-unfolded\]\s*\{[^}]*grid-template-rows: 1fr/);
  assert.doesNotMatch(css, /(?<![-\w])\d+(\.\d+)?m?s\b(?![^;{}]*var\()/, 'a fixed time');
  for (const m of css.matchAll(/(transition|animation)\s*:\s*([^;]+);/g)) assert.match(m[2]!, /var\(--motion-|none/, m[0]);
  for (const m of css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)) assert.ok(parseFloat(m[1]!) * (m[2] === 'rem' ? 16 : 1) >= 14, m[0]);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.hm-fold[\s\S]*transition: none !important/);
});

test('a step is done before the current one, now at it and next after it', () => {
  assert.deepEqual([0, 1, 2].map(i => stepState(i, 1)), ['done', 'now', 'next']);
  assert.deepEqual([0, 1, 2].map(i => stepState(i, FIND_STEPS_DONE)), ['done', 'done', 'done']);
});

test('the Find steps: three plain words, and the sample and the real flow each map every step of theirs', () => {
  assert.deepEqual(FIND_STEP_WORDS, ['Look', 'Choose', 'Read']);
  const sample: [FindStep, number][] = [['looking', 0], ['places', 1], ['confirm', 2], ['reading', 2], ['done', 3], ['left', 1]];
  for (const [step, at] of sample) assert.equal(stageOfFind(step), at, step);
  assert.equal(stageOfFind('places', true), 3, 'the list after a real read is the end');
  const real: [RealStep, number][] = [['start', 0], ['looking', 0], ['places', 1], ['confirm', 2], ['reading', 2], ['done', 3]];
  for (const [step, at] of real) assert.equal(stageOfReal(step, 'start'), at, step);
  assert.equal(stageOfReal('error', 'start'), 0); assert.equal(stageOfReal('error', 'places'), 1);
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
