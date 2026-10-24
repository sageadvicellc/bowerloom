// The setup screen drawn at each step with a provider and the sample world, and drawn with no provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProtoProvider, useProtoStore } from '../renderer/proto/session.js';
import { SetupFlow, SetupScreen } from '../renderer/proto/SetupScreen.js';
import { generateWorld } from '../shared/proto/sample.js';
import { buildScan } from '../shared/proto/scan-places.js';
import { createStore } from '../shared/proto/store.js';
import { initialSetup } from '../shared/proto/setup-flow.js';
import type { SetupState } from '../shared/proto/setup-flow.js';
import { DESKTOP } from './support.js';

const COMMAND = /\bbowerloom (ls|status|use|unuse|lock|apply|skills|skill|prompt|team|store|folder|slice|context|cache|up|help)\b|\bnpm (run|install)\b|\bgit (push|init|add|commit|remote)\b|\bcd \S|\bchmod\b|--[a-z]{3,}|terminal|command line|\$ /i;
const BANNED = /\bhelpers?\b|\bteams?\b/i;
const world = generateWorld(1);
const places = buildScan(world);
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

function Probe({ initial }: { initial: SetupState }) {
  return createElement(SetupFlow, { session: useProtoStore(), initial });
}
const draw = (initial: SetupState): string => renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(generateWorld(1)) }, createElement(Probe, { initial })));
const at = (patch: Partial<SetupState>): SetupState => ({ ...initialSetup(), ...patch });
const roots = { harnessRoot: '/Users/sample/Studio', knowledgeRoot: '/Users/sample/Studio/knowledge', pickersOpen: true } as const;
const allIds = places.map(p => p.id);
const steps: Record<string, string> = {
  welcome: draw(initialSetup()),
  pickers: draw(at({ ...roots })),
  places: draw(at({ ...roots, step: 'places' })),
  scanned: draw(at({ ...roots, step: 'places', scanned: true })),
  contents: draw(at({ ...roots, step: 'contents', scanned: true, ticked: allIds.slice(0, 2) })),
  review: draw(at({ ...roots, step: 'review', scanned: true, ticked: allIds })),
  'bring-in': draw(at({ ...roots, step: 'bring-in', scanned: true, ticked: allIds })),
  done: draw(at({ ...roots, step: 'done', scanned: true, ticked: allIds, broughtIn: true })),
};

test('with no provider the screen shows its title and the count line, and does not throw', () => {
  const markup = renderToStaticMarkup(createElement(SetupScreen, { world }));
  assert.equal(textOf(markup), 'Setup 3 interfaces');
  assert.match(markup, /<h1[^>]*>Setup<\/h1>/);
});

test('with a provider it starts on the welcome step: one plain sentence about a harness, and the button that opens the pickers', () => {
  const markup = renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(world) }, createElement(SetupScreen, { world })));
  const text = textOf(markup);
  assert.match(markup, /<h1[^>]*>Setup<\/h1>/);
  assert.match(markup, /<h2[^>]*>Welcome<\/h2>/);
  assert.match(text, /A harness is everything around an AI model that is not the model itself\./);
  assert.match(text, /Choose where your harness lives/);
  assert.match(text, /Nothing is read yet\./);
  assert.doesNotMatch(text, /Harness root|Knowledge root/, 'the pickers are closed');
  assert.equal(steps.welcome, markup.replace(/ aria-current="[^"]*"/g, m => m), 'the same draw');
});

test('the two pickers list invented folders, and the scan waits until both roots are chosen', () => {
  const open = textOf(draw(at({ pickersOpen: true })));
  assert.match(open, /Harness root/); assert.match(open, /Knowledge root/);
  assert.match(steps.pickers!, /<button[^>]*>Continue to the scan<\/button>/);
  assert.match(draw(at({ pickersOpen: true })), /<button[^>]*disabled=""[^>]*>Continue to the scan/);
  assert.doesNotMatch(steps.pickers!, /<button[^>]*disabled=""[^>]*>Continue to the scan/);
  assert.equal([...steps.pickers!.matchAll(/type="radio"/g)].length, 8, 'four folders for each root');
  assert.match(textOf(steps.pickers!), /The knowledge root is inside the harness root\. That is fine\./);
});

test('places: the note says places and counts only, then the scan lists the places in groups with counts and paths', () => {
  assert.match(textOf(steps.places!), /shows places and counts only\. It reads no file contents\./);
  assert.match(textOf(steps.places!), /Look for settings folders/);
  assert.doesNotMatch(steps.places!, /<h3/, 'no list before the scan');
  const t = textOf(steps.scanned!);
  for (const group of ['Claude Code', 'Codex', 'OpenCode', 'Older Bowerloom layouts', 'Project folders']) assert.match(t, new RegExp(group), group);
  assert.match(t, new RegExp(`Found ${places.length} places`));
  assert.match(t, /No older Bowerloom layouts found\./);
  assert.match(t, /Studio: \.claude/); assert.match(t, /\/Users\/sample\/Studio\/\.claude/); assert.match(t, /Library cache: Evergreen Kit 2\.3\.0/);
  assert.equal([...steps.scanned!.matchAll(/sx-reveal/g)].length, places.length, 'every place is revealed');
  assert.doesNotMatch(steps.scanned!, /style=/, 'the stagger is set from a script, not from markup');
});

test('contents: a checkbox for each place, select all and none, and a running count', () => {
  const t = textOf(steps.contents!);
  assert.match(t, /Select all/); assert.match(t, /Select none/);
  assert.match(t, new RegExp(`2 of ${places.length} places ticked`));
  assert.equal([...steps.contents!.matchAll(/type="checkbox"/g)].length, places.length);
  assert.equal([...steps.contents!.matchAll(/type="checkbox"[^>]*checked=""|checked=""[^>]*type="checkbox"/g)].length, 2);
  assert.match(steps.contents!, /<button[^>]*>Read the ticked places<\/button>/);
  assert.match(draw(at({ ...roots, step: 'contents', scanned: true })), /<button[^>]*disabled=""[^>]*>Read the ticked places/);
});

test('review: counts, library items as a reference, a hook that runs code, a missing secret, and the conflict', () => {
  const t = textOf(steps.review!);
  assert.match(t, /from a library, kept as a reference/);
  assert.match(t, /120 items from Evergreen Kit 2\.3\.0/);
  assert.match(t, /runs code/);
  assert.match(t, /Needs a secret/); assert.match(t, /LANTERN_TOKEN, an environment variable, and it is not set/);
  assert.match(t, /Same item, different text/); assert.match(t, /3 different texts/);
  assert.match(t, /Found in Claude Code, Codex, and OpenCode, with different text in each\./);
  assert.match(t, /Choose a version of /);
  assert.match(steps.review!, /<button[^>]*disabled=""[^>]*>Continue/, 'the conflict must be settled first');
  assert.match(t, /Settle 1 item above to go on\./);
  const settled = draw(at({ ...roots, step: 'review', scanned: true, ticked: allIds, resolved: { x: 'Thing: kept the Codex version.' } }));
  assert.match(textOf(settled), /Settled Thing: kept the Codex version\./);
});

test('bring in and done: the copy note, the roots, and the way on to the Harness screen', () => {
  assert.match(textOf(steps['bring-in']!), /Bowerloom copies\. Your original files stay as they are\./);
  assert.match(steps['bring-in']!, /<button[^>]*>Bring these in<\/button>/);
  assert.match(textOf(steps['bring-in']!), /\/Users\/sample\/Studio\/knowledge/);
  assert.match(textOf(steps.done!), /Your original files were not touched\./);
  assert.match(textOf(steps.done!), /no version was made/);
  assert.match(steps.done!, /<button[^>]*>Go to the Harness screen<\/button>/);
  assert.match(steps.done!, /<button[^>]*>Start again<\/button>/);
  assert.doesNotMatch(steps.welcome!, /Start again/, 'nothing to start again at the first step');
});

test('every step has one h1, then h2 for the step, and no heading level is skipped', () => {
  for (const [name, markup] of Object.entries(steps)) {
    const levels = [...markup.matchAll(/<h([1-6])[ >]/g)].map(m => Number(m[1]));
    assert.equal(levels[0], 1, name); assert.equal(levels.filter(l => l === 1).length, 1, name); assert.equal(levels[1], 2, name);
    assert.equal(levels.filter(l => l === 2).length, 1, `${name} has one step heading`);
    for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i]! <= levels[i - 1]! + 1, `${name}: h${levels[i]} after h${levels[i - 1]}`);
    assert.match(markup, /<h2 id="sx-heading" tabindex="-1"/, name);
  }
});

test('every control has a label, and the step list marks the step that is showing', () => {
  for (const [name, markup] of Object.entries(steps)) {
    const controls = [...markup.matchAll(/<input /g)].length;
    const labelled = [...markup.matchAll(/<label[^>]*>[\s\S]*?<\/label>/g)].filter(m => /<input /.test(m[0])).length;
    assert.equal(labelled, controls, `${name}: every input sits in a label`);
    assert.equal([...markup.matchAll(/<button/g)].length, [...markup.matchAll(/<button[^>]*>[^<]*(?:<svg[\s\S]*?<\/svg>)?[^<]*<\/button>/g)].length, `${name}: buttons have text`);
  }
  assert.equal([...steps.review!.matchAll(/aria-current="step"/g)].length, 1);
  assert.match(steps.review!, /aria-current="step"[^>]*><span[^>]*>4<\/span><span>Review/);
  assert.equal([...steps.done!.matchAll(/aria-current="step"/g)].length, 0);
});

test('the words are plain at every step: no command line, no helper, no team, no dash', () => {
  for (const [name, markup] of Object.entries(steps)) {
    const t = textOf(markup);
    assert.doesNotMatch(t, COMMAND, name); assert.doesNotMatch(t, BANNED, name); assert.doesNotMatch(t, /[–—]/, `${name} has a dash`);
    assert.doesNotMatch(markup, /style=|onclick/i, name);
  }
});

test('the style sheet uses tokens for colour and the setup reveal tokens for motion', () => {
  const css = readFileSync(join(DESKTOP, 'renderer', 'proto', 'setup-screen.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/, 'no colour value of its own');
  assert.match(css, /--motion-setup-reveal-ms/); assert.match(css, /--motion-setup-reveal-stagger/); assert.match(css, /--motion-setup-reveal-ease/);
  assert.match(css, /prefers-reduced-motion/);
});
