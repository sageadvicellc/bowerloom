// The card kit and the shell, rendered to markup: structure, the one-card rule, headings in order, and the text budget on all of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge, badgeIcon } from '../renderer/home/kit/Badge.js';
import { Button } from '../renderer/home/kit/Button.js';
import { DragFollower } from '../renderer/home/kit/DragFollower.js';
import { Glyph } from '../renderer/home/kit/Glyph.js';
import { Drawer } from '../renderer/home/kit/Drawer.js';
import { HelpPopover } from '../renderer/home/kit/HelpPopover.js';
import { KIT_ICON_NAMES, KitIcon } from '../renderer/home/kit/icons.js';
import { ItemCard, isLarge } from '../renderer/home/kit/ItemCard.js';
import { Shelf } from '../renderer/home/kit/Shelf.js';
import { HomeApp } from '../renderer/home/HomeApp.js';
import { KitGallery } from '../renderer/home/KitGallery.js';
import { TourAnnouncer, TourOverlay } from '../renderer/home/tour/TourOverlay.js';
import { TOUR_STEPS } from '../renderer/home/tour/steps.js';
import { createTour, startTour, stepNext } from '../renderer/home/tour/tour.js';
import { ProtoProvider } from '../renderer/proto/session.js';
import { loadWorld } from '../renderer/proto/world.js';
import { createStore } from '../shared/proto/store.js';
import { assertTextBudget, extractText } from '../shared/home/textbudget.js';
import { WORDS } from '../renderer/home/words.js';
import type { ShelfEntry } from '../shared/home/cards.js';

const html = (element: ReactElement): string => renderToStaticMarkup(element);
const none = (): void => undefined;
const within = (markup: string): void => assert.deepEqual(assertTextBudget(markup), [], markup.slice(0, 200));
/** The heading levels in order. */
const levels = (markup: string): number[] => [...markup.matchAll(/<h([1-6])[\s>]/g)].map(m => Number(m[1]));
/** True when no heading is more than one level deeper than the one before it. */
const inOrder = (list: number[]): boolean => list.every((level, i) => i === 0 ? level === 1 || level === 2 : level <= list[i - 1]! + 1);
const shell = (): string => html(createElement(ProtoProvider, { store: createStore(loadWorld()) }, createElement(HomeApp)));

test('a ready-made agent in a list is the same compact row as a skill: a glyph tile (no initials, no person), a name button and a hint', () => {
  const m = html(createElement(ItemCard, { kind: 'agent', name: 'Velvet Weaver', hint: 'A weaver with 3 skills and 1 tool.', selected: false, onSelect: none }));
  assert.match(m, /data-kind="agent"/); assert.match(m, /data-size="small"/); assert.match(m, /<span class="kit-tile" aria-hidden="true"><svg/);
  assert.doesNotMatch(m, /kit-avatar|data-slot/); assert.doesNotMatch(m, /aria-hidden="true">VW</, 'no initials'); assert.doesNotMatch(m, /M6 20c0-3\.3 2\.7-6 6-6s6 2\.7 6 6/, 'not the head and shoulders of a person');
  assert.match(m, /<button[^>]*class="kit-card-main"[^>]*aria-pressed="false"[^>]*>Velvet Weaver<\/button>/);
  assert.match(m, /aria-describedby="[^"]+"/); assert.match(m, /<p class="kit-hint kit-card-hint"[^>]*>A weaver with 3 skills and 1 tool\.<\/p>/);
  assert.doesNotMatch(m, /kit-status|kit-card-check|style=/); assert.equal(isLarge('agent'), false, 'the tile is the AgentCard of the map; a row is always one height');
  within(m);
});

test('a skill, a tool and a note are the same card as each other: only the icon, the badge and the kind differ', () => {
  const make = (kind: 'skill' | 'tool' | 'note'): string => html(createElement(ItemCard, { kind, name: 'Weekly Review', selected: false, onSelect: none }));
  const norm = (m: string): string => m.replace(/data-kind="\w+"/, 'data-kind="K"').replace(/<svg[\s\S]*?<\/svg>/, '<svg/>');
  assert.equal(norm(make('skill')), norm(make('tool'))); assert.equal(norm(make('tool')), norm(make('note')));
  for (const kind of ['skill', 'tool', 'note'] as const) { const m = make(kind); assert.match(m, /data-size="small"/); assert.match(m, /class="kit-tile"/); assert.doesNotMatch(m, /kit-avatar/); within(m); }
  const paths = ['skill', 'tool', 'note'].map(k => make(k as 'skill').match(/<path d="[^"]+"/)?.[0]);
  assert.equal(isLarge('skill'), false);
  assert.ok(paths.every(p => p !== undefined));
});

test('an agent card and a skill card share one layout: the same parts in the same order', () => {
  const parts = (m: string): string[] => [...m.matchAll(/class="(kit-[a-z-]+)(?: [^"]*)?"/g)].map(x => x[1]!).filter(c => ['kit-tile', 'kit-card-main', 'kit-card-hint', 'kit-card-badge', 'kit-card-check'].includes(c));
  const a = parts(html(createElement(ItemCard, { kind: 'agent', name: 'A B', hint: 'One.', badge: { label: 'new', tone: 'new' }, selected: true, onSelect: none })));
  const s = parts(html(createElement(ItemCard, { kind: 'skill', name: 'A B', hint: 'One.', badge: { label: 'new', tone: 'new' }, selected: true, onSelect: none })));
  assert.deepEqual(a, s); assert.deepEqual(a, ['kit-tile', 'kit-card-main', 'kit-card-badge']);
});

test('a selected card says so with aria-pressed and a highlight, and has no check mark; a state is a dot and words', () => {
  const m = html(createElement(ItemCard, { kind: 'skill', name: 'Weekly Review', badge: { label: '2 different copies', tone: 'warn' }, selected: true, onSelect: none }));
  assert.match(m, /aria-pressed="true"/); assert.match(m, /data-selected=""/);
  assert.doesNotMatch(m, /kit-card-check/); assert.doesNotMatch(m, /M5 12\.5l4\.5 4\.5L19 7\.5/, 'the check path is not drawn anywhere in the card');
  assert.match(m, /<span class="kit-status"[^>]*data-tone="warn"[^>]*><span class="kit-dot" aria-hidden="true"><\/span><span>2 different copies<\/span><\/span>/);
  assert.doesNotMatch(m, /kit-badge|kit-pill/, 'no pill');
  within(m);
});

test('a state is a dot and words in a plain span, or a text button when it can be pressed; every tone says its state in words', () => {
  assert.match(html(createElement(Badge, { badge: { label: 'new', tone: 'new' } })), /^<span class="kit-status" data-tone="new" data-no-drag=""><span class="kit-dot" aria-hidden="true"><\/span><span>new<\/span><\/span>$/);
  assert.match(html(createElement(Badge, { badge: { label: '2 different copies', tone: 'warn' }, onPress: none })), /^<button type="button" class="kit-status"/);
  for (const tone of ['warn', 'new', 'info'] as const) assert.match(html(createElement(Badge, { badge: { label: 'Runs code', tone } })), /<span>Runs code<\/span>/, 'the words are always there, so colour is never the only signal');
  const icons = [badgeIcon({ label: 'x', tone: 'warn' }), badgeIcon({ label: 'x', tone: 'new' }), badgeIcon({ label: 'x', tone: 'info' }), badgeIcon({ label: 'needs a key', tone: 'warn' })];
  assert.deepEqual(icons, ['warning', 'sparkle', 'info', 'key']);
  assert.ok(KIT_ICON_NAMES.length >= 12);
  assert.match(html(createElement(KitIcon, { name: 'check' })), /aria-hidden="true"/);
});

test('a glyph tile is a hidden icon in a rounded square, in three sizes, and never holds letters', () => {
  const m = html(createElement(Glyph, { name: 'agent' }));
  assert.match(m, /^<span class="kit-tile" aria-hidden="true"><svg/); assert.doesNotMatch(m, />[A-Za-z]+</);
  assert.match(html(createElement(Glyph, { name: 'agent', size: 'large' })), /data-size="large"/); assert.match(html(createElement(Glyph, { name: 'agent', size: 'small' })), /data-size="small"/);
});

test('a button is primary, quiet or text, round when asked, and never has a style attribute', () => {
  const p = html(createElement(Button, { variant: 'primary', icon: 'plus' }, 'Add'));
  assert.match(p, /data-variant="primary"/); assert.match(p, /type="button"/); assert.doesNotMatch(p, /style=/);
  assert.match(html(createElement(Button, {}, 'Go')), /data-variant="quiet"/); assert.match(html(createElement(Button, { variant: 'text' }, 'Find more')), /data-variant="text"/);
  assert.match(html(createElement(Button, { round: true, 'aria-label': 'Help' }, '?')), /data-round=""[^>]*>\?<|aria-label="Help"/);
  assert.match(html(createElement(Button, { disabled: true }, 'Save')), /disabled=""/);
});

const entries = (n: number): ShelfEntry[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, kind: 'skill' as const, name: `Skill ${i + 1}` }));
const shelf = (n: number, extra: Record<string, unknown> = {}): string => html(createElement(Shelf, { title: 'Skills', entries: entries(n), selectedId: null, onSelect: none, emptyText: 'Nothing here yet.', ...extra }));

test('a shelf has a title, cards that are all the same card, and an empty sentence when it is empty', () => {
  const m = shelf(3);
  assert.match(m, /<section class="kit-shelf" aria-labelledby="([^"]+)"[^>]*><div class="kit-shelf-head"><h3 class="kit-heading" id="\1">Skills<\/h3>/);
  assert.equal([...m.matchAll(/class="kit-card"/g)].length, 3); assert.doesNotMatch(m, /Show more/); within(m);
  const empty = shelf(0);
  assert.match(empty, /<p class="kit-hint">Nothing here yet\.<\/p>/); assert.doesNotMatch(empty, /kit-card|<ul/); within(empty);
});

test('a shelf shows eight cards and then "Show more"; expanded it shows all of them and "Show less"', () => {
  assert.equal([...shelf(8).matchAll(/class="kit-card"/g)].length, 8); assert.doesNotMatch(shelf(8), /Show more/);
  const nine = shelf(9);
  assert.equal([...nine.matchAll(/class="kit-card"/g)].length, 8); assert.match(nine, /<button[^>]*aria-expanded="false"[^>]*>Show more<\/button>/); within(nine);
  const all = shelf(20, { defaultExpanded: true });
  assert.equal([...all.matchAll(/class="kit-card"/g)].length, 20); assert.match(all, /aria-expanded="true"[^>]*>Show less</);
  assert.equal([...shelf(6, { limit: 4 }).matchAll(/class="kit-card"/g)].length, 4);
});

test('a shelf can wear a hint line under its title and a heading level of its own, and has no "?" of its own', () => {
  const m = shelf(1, { hint: 'Tools let an agent reach outside services.', level: 4 });
  assert.match(m, /<h4 class="kit-heading"/);
  assert.match(m, /<div class="kit-shelf-head"><h4[^>]*>Skills<\/h4><p class="kit-hint">Tools let an agent reach outside services\.<\/p><\/div>/);
  // One help button per window: the shelf draws no "?" and no popover of its own.
  assert.doesNotMatch(m, /aria-expanded|kit-help|>\?</); within(m);
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

test('a help popover is a "?" button; opened, it holds one sentence marked as popover text, where MCP may be named', () => {
  const closed = html(createElement(HelpPopover, { label: 'About tools', text: 'It is called MCP.' }));
  assert.match(closed, /<button[^>]*aria-label="About tools"[^>]*aria-expanded="false"[^>]*>\?<\/button>/); assert.doesNotMatch(closed, /kit-popover/); within(closed);
  const open = html(createElement(HelpPopover, { label: 'About tools', text: WORDS.popover.connection, defaultOpen: true, action: { label: 'Show me around', onAction: none } }));
  assert.match(open, /data-budget="popover"/); assert.match(open, /MCP/); assert.match(open, /aria-expanded="true"/); assert.match(open, />Show me around</); within(open);
  assert.ok(extractText(open).some(t => t.popover && /MCP/.test(t.text)));
});

test('the Preview mark is one text button, plain words and a dot, that opens its own popover, and there is no second "?" beside it', () => {
  const closed = html(createElement(HelpPopover, { label: 'About this preview', text: WORDS.popover.preview, pill: 'Preview' }));
  assert.match(closed, /<button[^>]*class="kit-status kit-help-text"[^>]*aria-label="About this preview"[^>]*aria-expanded="false"[^>]*><span class="kit-dot" aria-hidden="true"><\/span><span>Preview<\/span><\/button>/);
  assert.doesNotMatch(closed, /kit-badge|kit-pill|<svg/, 'no pill and no icon');
  assert.equal([...closed.matchAll(/<button/g)].length, 1, 'one button, not a pill and a circle'); assert.doesNotMatch(closed, />\?</); within(closed);
  const open = html(createElement(HelpPopover, { label: 'About this preview', text: WORDS.popover.preview, pill: 'Preview', defaultOpen: true }));
  assert.match(open, /<p>This is a preview\. Nothing is written to your computer\.<\/p>/); assert.match(open, /aria-expanded="true"/); within(open);
});

test('the shell has no bare "?": Help is a button with its word at the far right; Preview is plain words with a dot and Tools has a hint line', () => {
  const m = shell();
  assert.equal([...m.matchAll(/>\?<\/button>/g)].length, 0, 'no bare question mark');
  assert.match(m, /data-tour="help"[^>]*>Help<\/button>/);
  assert.match(m, /<button[^>]*class="kit-status kit-help-text"[^>]*aria-label="About this preview"/);
  assert.doesNotMatch(m, /About tools/);
  assert.match(m, /<h3 class="kit-heading"[^>]*>Tools<\/h3><p class="kit-hint">Tools let an agent reach outside services\.<\/p>/);
  assert.ok(m.indexOf('kit-help-text') < m.indexOf('data-tour="help"'), 'Help is after the Preview mark, at the far right of the bar');
  within(m);
});

test('the Version history button is an icon-only clock button with a name, and a tooltip that describes it', () => {
  const m = shell();
  const button = /<button[^>]*aria-label="Version history"[^>]*>/.exec(m);
  assert.ok(button !== null, 'a button named Version history');
  assert.match(button![0], /data-round=""/); assert.match(button![0], /aria-expanded="false"/);
  const described = /aria-describedby="([^"]+)"/.exec(button![0]);
  assert.ok(described !== null, 'described by the tooltip');
  assert.match(m, new RegExp(`<span class="kit-tip-text" role="tooltip" id="${described![1]!.replace(/[:]/g, '\\$&')}">Version history</span>`));
  assert.match(m, /<span class="kit-tip"><button[^>]*aria-label="Version history"[^>]*><svg[^>]*>[\s\S]*?<\/svg><\/button>/, 'the button holds the clock and no words');
  assert.doesNotMatch(m, /data-open=""[^>]*role="tooltip"|role="tooltip"[^>]*data-open/, 'the tooltip is closed when the page is drawn');
  assert.doesNotMatch(m, /Save points/i);
  within(m);
});

test('the shell: a top bar, a stage with the agents, a side panel with three shelves, a Save bar, and the six tour targets', () => {
  const m = shell();
  assert.match(m, /<header class="hm-bar" data-tour="bar">/); assert.match(m, />Add</); assert.match(m, /data-tour="help"[^>]*>Help</);
  assert.match(m, /<main id="main" class="hm-stage">/); assert.match(m, /<h1 [^>]*>Your agents<\/h1>/); assert.match(m, /10 agents/);
  assert.equal([...m.matchAll(/data-kind="agent"/g)].length, 10);
  assert.match(m, /<aside class="hm-panel" data-tour="details"/);
  for (const t of ['Skills', 'Tools', 'Notes']) assert.match(m, new RegExp(`<h3 class="kit-heading"[^>]*>${t}</h3>`));
  assert.match(m, /<section class="hm-savebar" data-tour="save" data-mode="clean" aria-label="Save bar">/); assert.match(m, /Nothing to save yet/);
  assert.match(m, /<button disabled=""[^>]*data-variant="primary"[^>]*>Save<\/button>/);
  for (const id of ['map', 'agent', 'details', 'add', 'save', 'help', 'bar']) assert.match(m, new RegExp(`data-tour="${id}"`), id);
  assert.equal([...m.matchAll(/data-tour="agent"/g)].length, 1, 'one agent card is the tour target');
  assert.doesNotMatch(m, /style=|<script|onclick/i);
});

test('the shell has no left rail, no paragraph, headings in order, and passes the text budget', () => {
  const m = shell();
  assert.doesNotMatch(m, /<nav|sidebar|class="shell"/);
  within(m);
  assert.deepEqual(levels(m).slice(0, 3), [1, 2, 3]); assert.ok(inOrder(levels(m)), levels(m).join());
  const agentCards = [...m.matchAll(/<button type="button" class="kit-card-main"[^>]*>([^<]+)<\/button>/g)].map(x => x[1]!);
  assert.ok(agentCards.length >= 10 && agentCards.every(n => n.split(' ').length <= 5));
});

test('the shell shows every agent in name order, with a plain name and a hint that says what it can do', () => {
  const m = shell();
  const names = [...m.matchAll(/data-kind="agent"[\s\S]*?class="kit-card-main"[^>]*>([^<]+)</g)].map(x => x[1]!);
  assert.equal(names.length, 10); assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(names.slice(0, 3), ['Inbox sorter', 'Interview notetaker', 'Meeting assistant']);
  assert.match(m, />Summarizes meetings and writes replies\.</);
  assert.doesNotMatch(m, /A [a-z]+ with \d skills?/, 'a hint is not only counts');
  assert.doesNotMatch(m, /Velvet|Brisk|Gilded|Crisp|Weaver/);
});

test('the kit gallery shows both looks, every card state and every part, passes the text budget, and keeps its headings in order', () => {
  const m = html(createElement(ProtoProvider, { store: createStore(loadWorld()) }, createElement(KitGallery)));
  assert.equal([...m.matchAll(/data-theme="(light|dark)"/g)].map(x => x[1]).join(), 'light,dark');
  for (const state of ['data-demo="hover"', 'data-demo="focus"', 'data-selected=""', 'data-size="tile"', 'data-size="small"', 'kit-tray', 'data-kind="tool"', 'data-kind="note"', 'data-kind="skill"']) assert.match(m, new RegExp(state), state);
  for (const tone of ['warn', 'new', 'info']) assert.match(m, new RegExp(`kit-status" data-tone="${tone}"`), tone);
  assert.doesNotMatch(m, /kit-badge|kit-pill|kit-chip/, 'no pill is left');
  assert.match(m, /disabled=""/); assert.match(m, /Show more/); assert.match(m, /kit-popover/); assert.match(m, /kit-drawer/); assert.match(m, /class="kit-tile"/); assert.doesNotMatch(m, /kit-avatar/);
  within(m);
  assert.ok(inOrder(levels(m)), levels(m).join());
  assert.deepEqual(levels(m).slice(0, 3), [1, 2, 3]);
});

test('the tour popover: one sentence, the step, Back and Next, Skip tour; the last step says Done; the first has no Back', () => {
  const first = html(createElement(TourOverlay, { state: startTour(createTour(TOUR_STEPS)), onNext: none, onBack: none, onSkip: none }));
  assert.match(first, /role="dialog" aria-label="Tour"/); assert.match(first, /These are your AI agents, from every tool\./); assert.match(first, />1 of 7</);
  assert.match(first, />Next</); assert.match(first, />Skip tour</); assert.doesNotMatch(first, />Back</); assert.equal([...first.matchAll(/class="tour-dot"/g)].length, 7);
  assert.match(first, /data-state="now"/);
  within(first);
  let t = startTour(createTour(TOUR_STEPS));
  for (let i = 0; i < 6; i += 1) t = stepNext(t);
  const last = html(createElement(TourOverlay, { state: t, onNext: none, onBack: none, onSkip: none }));
  assert.match(last, />Done</); assert.doesNotMatch(last, />Next</); assert.match(last, />Back</); assert.match(last, />7 of 7</); assert.match(last, /data-variant="text"[^>]*>Back</); assert.match(last, /Replay this tour any time\./);
  within(last);
  const waits = html(createElement(TourOverlay, { state: stepNext(startTour(createTour(TOUR_STEPS))), onNext: none, onBack: none, onSkip: none }));
  assert.match(waits, /Click an agent, or select one and press Enter\./); assert.match(waits, />Next</, 'the step that waits keeps its Next button'); assert.match(waits, /data-variant="primary"[^>]*>Next</);
  assert.ok(waits.indexOf('>Back<') < waits.indexOf('>Next<'), 'Back is a quiet text button before Next, and Next stays last');
  assert.equal(html(createElement(TourOverlay, { state: createTour(TOUR_STEPS), onNext: none, onBack: none, onSkip: none })), '', 'an idle tour draws nothing');
});

test('the tour announcer says the step and the sentence in a polite live region, and nothing when the tour is not running', () => {
  const running = html(createElement(TourAnnouncer, { state: stepNext(startTour(createTour(TOUR_STEPS))) }));
  assert.match(running, /role="status" aria-live="polite"/); assert.match(running, /Step 2 of 7/); assert.match(running, /Click an agent to see what it can do\./); within(running);
  const idle = html(createElement(TourAnnouncer, { state: createTour(TOUR_STEPS) }));
  assert.match(idle, /aria-live="polite"/); assert.doesNotMatch(idle, /Step/);
});

test('the drag follower draws the dragged name, hidden from a screen reader, and nothing when no drag is on', () => {
  assert.equal(html(createElement(DragFollower, { drag: null, followRef: none })), '');
  const m = html(createElement(DragFollower, { drag: { id: 's1', label: 'Weekly Review', over: null }, followRef: none }));
  assert.match(m, /^<div class="kit-follow" data-follow="" aria-hidden="true">Weekly Review<\/div>$/); within(m);
});
