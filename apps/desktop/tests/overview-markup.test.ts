// The Overview drawn as markup (Task 2 lane H): the graph and the list carry the same names and counts, the roles and names a screen reader needs, one tab stop among the cards,
// the shared-skill highlight, the boxes under the detail zoom, the cap on the page, a place outside home that never says "In Bowerloom", and a screen with no write in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FolderInfo } from '../shared/engine/types.js';
import { FIT_FOOT, fitView } from '../shared/harness/layout.js';
import { OVERVIEW_LIMITS, overviewOf } from '../shared/harness/overview.js';
import { layoutOf } from '../shared/harness/overview-layout.js';
import type { Overview, OverviewGroup } from '../shared/harness/overview.js';
import { createSampleOverviewState } from '../shared/harness/sample.js';
import type { HarnessState, Link, Part, PartKind, ScanSource } from '../shared/harness/types.js';
import { OverviewDetails } from '../renderer/harness/screens/OverviewDetails.js';
import { OverviewGraph } from '../renderer/harness/screens/OverviewGraph.js';
import { LIST_ROWS, OverviewList } from '../renderer/harness/screens/OverviewList.js';
import { expandedOf, indexOverview } from '../renderer/harness/screens/OverviewModel.js';
import { PlaceAction, PlaceMark } from '../renderer/harness/screens/OverviewParts.js';
import type { PlaceTools } from '../renderer/harness/screens/OverviewParts.js';
import { OVERVIEW, countsWords } from '../renderer/harness/words-overview.js';
import { DESKTOP } from './support.js';

const noop = (): void => undefined;
const TOOLS: PlaceTools = { available: true, busy: false, open: noop, choose: noop };
const place = (g: OverviewGroup): ReactElement => createElement('span', null, createElement(PlaceMark, { group: g }), createElement(PlaceAction, { group: g, tools: TOOLS }));
const folder = (id: string, label: string, hasDefinition: boolean): FolderInfo =>
  ({ id, label, name: label.split('/').at(-1) ?? label, hasDefinition, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false } });
const part = (id: string, kind: PartKind, name: string): Part => ({ id, kind, name, summary: `${name}.`, description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true });

/** A made-up scan of `groups` places with `each` parts apiece; the first place is the home. */
function bigState(groups: number, each: number): HarnessState {
  const parts: Part[] = [], sources: ScanSource[] = [];
  for (let g = 0; g < groups; g += 1) {
    const ids: string[] = [], links: Link[] = [];
    let skill = '';
    for (let i = 0; i < each; i += 1) {
      const kind: PartKind = i % 5 === 0 ? 'agent' : i % 5 < 3 ? 'skill' : i % 5 === 3 ? 'tool' : 'context';
      const id = `g${g}-${kind}-${i}`;
      parts.push(part(id, kind, `${kind} ${String(i).padStart(5, '0')}`)); ids.push(id);
      if (kind === 'skill') skill = id;
      if (kind === 'agent' && skill !== '') links.push({ from: id, to: skill });
    }
    sources.push({ id: `s${String(g).padStart(3, '0')}`, name: `Place ${g}`, interfaceName: 'Claude Code', harnessName: `h${g}`, partIds: ids, links, scope: g === 0 ? 'home' : 'project', label: g === 0 ? '~' : `~/p${g}` });
  }
  return { parts, harnesses: [], projects: [], installs: [], interfaces: [], runs: [], history: [], sources, chosenSourceIds: [], nextId: 100 };
}

const sample = (folders: readonly FolderInfo[] = []): Overview => overviewOf(createSampleOverviewState(), folders);
const allOpen = (o: Overview): ReadonlySet<string> => new Set(o.groups.map(g => g.id));
const attr = (html: string, name: string): string[] => [...html.matchAll(new RegExp(` ${name}="([^"]*)"`, 'g'))].map(m => m[1]!);
const unescape = (text: string): string => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

function graph(o: Overview, extra: Partial<Parameters<typeof OverviewGraph>[0]> = {}, open: ReadonlySet<string> = allOpen(o)): string {
  return renderToStaticMarkup(createElement(OverviewGraph, { overview: o, expanded: open, index: indexOverview(o), selectedId: null, fitKey: 'k', onSelect: noop, onToggle: noop, place, initialSize: { w: 2400, h: 2600 }, initialView: { x: 0, y: 0, k: 1 }, ...extra }));
}
function list(o: Overview, extra: Partial<Parameters<typeof OverviewList>[0]> = {}, open: ReadonlySet<string> = allOpen(o)): string {
  return renderToStaticMarkup(createElement(OverviewList, { overview: o, expanded: open, index: indexOverview(o), selectedId: null, onSelect: noop, onToggle: noop, place, ...extra }));
}
const sharedIds = (o: Overview): readonly string[] => [...o.sharedKeys.values()][0]!;

// ---- the graph and the list say the same

test('the graph and the list carry the same places, parts and counts', () => {
  const o = sample(), g = graph(o), l = list(o);
  // Every part: the same names in both (the graph at the fit that shows them all).
  const graphNodes = attr(g, 'data-node'), listNodes = attr(l, 'data-node');
  assert.equal(graphNodes.length, o.groups.reduce((n, x) => n + x.nodes.length, 0));
  assert.deepEqual([...graphNodes].sort(), [...listNodes].sort());
  for (const group of o.groups) {
    for (const html of [g, l]) {
      assert.ok(html.includes(unescapeSafe(group.name)), group.name);
      assert.ok(html.includes(countsWords(group.counts)), `${group.name}: ${countsWords(group.counts)}`);
      assert.ok(html.includes(group.label));
    }
  }
  for (const node of o.groups.flatMap(x => x.nodes)) { assert.ok(g.includes(`>${node.name}</span>`), node.name); assert.ok(l.includes(`>${node.name}</button>`), node.name); }
  // The same accessible names, word for word.
  const names = (html: string): string[] => attr(html, 'aria-label').map(unescape).filter(x => / (agent|skill|connection|saved prompt|hook|set of notes), /.test(x)).sort();
  assert.deepEqual(names(g), names(l));
  assert.ok(names(g).includes('Reviewer, agent, alpha (Claude Code), uses 1 skill, 2 tools'));
  assert.ok(names(g).includes('Format on save, hook, alpha (Claude Code), runs code'));
  assert.ok(names(g).some(x => /^Check facts, skill, .*, shared with 2 places$/.test(x)));
});
const unescapeSafe = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('each place is a group with a name and a header button in the tab order that says whether it is open', () => {
  const o = sample();
  const open = new Set([o.groups[0]!.id]);
  const g = graph(o, {}, open);
  assert.equal(attr(g, 'data-cluster').length, o.groups.length);
  for (const group of o.groups) assert.ok(g.includes(`role="group" aria-label="Place: ${unescapeSafe(group.name)}"`), group.name);
  const toggles = [...g.matchAll(/<button type="button" class="hxo-toggle"[^>]*>/g)].map(m => m[0]);
  assert.equal(toggles.length, o.groups.length);
  for (const t of toggles) assert.match(t, /aria-expanded="(true|false)"/);
  // One header is the tab stop and the arrow keys move between the others; every header is a real button.
  assert.equal(toggles.filter(t => t.includes('tabindex="0"')).length, 1);
  assert.equal(toggles.filter(t => t.includes('tabindex="-1"')).length, toggles.length - 1);
  assert.ok(g.includes('class="hxo-skip"') && g.includes('Skip to the parts'), 'a way past the run of headers');
  assert.equal(toggles.filter(t => t.includes('aria-expanded="true"')).length, 1);
  assert.ok(toggles[0]!.includes(`data-place-toggle="${o.groups[0]!.id}"`));
  assert.match(toggles[0]!, /aria-label="Collapse Caveman \(plug-in\), ~, /);
  assert.match(toggles[1]!, /aria-label="Expand /);
  // A closed place draws its header and none of its cards.
  assert.equal(attr(g, 'data-node').length, o.groups[0]!.nodes.length);
  // The list: the same buttons with the same states, and a closed place holds no parts.
  const l = list(o, {}, open);
  const lt = [...l.matchAll(/<button type="button" class="hxo-toggle"[^>]*>/g)].map(m => m[0]);
  assert.equal(lt.length, o.groups.length);
  assert.equal(lt.filter(t => t.includes('aria-expanded="true"')).length, 1);
  for (const t of lt) assert.match(t, /aria-controls="hxo-body-[^"]+"/);
  assert.equal(attr(l, 'data-node').length, o.groups[0]!.nodes.length);
  assert.equal((l.match(/class="hxo-place-body" hidden=""/g) ?? []).length, o.groups.length - 1);
});

test('the cards are one tab stop, and each is a button that says whether it is selected', () => {
  const o = sample(), g = graph(o);
  const cards = [...g.matchAll(/<div class="hx-node hxo-node"[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, o.groups.reduce((n, x) => n + x.nodes.length, 0));
  assert.equal(cards.filter(c => c.includes('tabindex="0"')).length, 1);
  assert.equal(cards.filter(c => c.includes('tabindex="-1"')).length, cards.length - 1);
  for (const c of cards) { assert.match(c, /role="button"/); assert.match(c, /aria-pressed="false"/); assert.doesNotMatch(c, /draggable/); }
  // The selected card takes the tab stop.
  const id = o.groups[2]!.nodes[1]!.id;
  const picked = [...graph(o, { selectedId: id }).matchAll(/<div class="hx-node hxo-node"[^>]*>/g)].map(m => m[0]);
  const stop = picked.filter(c => c.includes('tabindex="0"'));
  assert.equal(stop.length, 1);
  assert.ok(stop[0]!.includes(`data-node="${id}"`)); assert.ok(stop[0]!.includes('aria-pressed="true"'));
});

test('selecting a shared skill lights every copy in both views and draws dotted curves to the copies on the page', () => {
  const o = sample(), copies = sharedIds(o);
  const g = graph(o, { selectedId: copies[0]! });
  const cards = [...g.matchAll(/<div class="hx-node hxo-node"[^>]*>/g)].map(m => m[0]);
  const lit = cards.filter(c => c.includes('data-lit=""')).map(c => attr(c, 'data-node')[0]);
  assert.deepEqual([...lit].sort(), copies.slice(1).sort());
  assert.equal(cards.filter(c => c.includes('data-selected=""')).length, 1);
  assert.equal((g.match(/hx-edge hxo-shared/g) ?? []).length, copies.length - 1);
  // A card that is neither a copy nor joined to the selection fades.
  assert.ok(cards.some(c => c.includes('data-faded=""')));
  assert.ok(!cards.filter(c => c.includes('data-lit=""')).some(c => c.includes('data-faded=""')));
  const l = list(o, { selectedId: copies[0]! });
  const rows = [...l.matchAll(/<li class="hx-lrow hxo-row"[^>]*>/g)].map(m => m[0]);
  assert.deepEqual(rows.filter(c => c.includes('data-lit=""')).map(c => attr(c, 'data-node')[0]).sort(), copies.slice(1).sort());
  // The place boxes that hold a copy are marked.
  assert.equal((g.match(/data-lit="" style/g) ?? []).length, copies.length);
  // Nothing selected: no dotted curve, no fade.
  const quiet = graph(o);
  assert.ok(!quiet.includes('hxo-shared')); assert.ok(!quiet.includes('data-faded'));
});

test('a dotted curve is drawn only to a copy that is on the page', () => {
  const o = sample(), copies = sharedIds(o);
  // Only the home and alpha are open: the copy in beta has no card.
  const homeId = copies[0]!.split('/')[0]!, alphaId = 'src-alpha';
  const g = graph(o, { selectedId: copies[0]! }, new Set([homeId, alphaId]));
  assert.equal((g.match(/hx-edge hxo-shared/g) ?? []).length, 1);
  assert.ok(g.includes('data-lit=""'));
});

test('read-only marks: Shared and Runs code show on the card, and the cards carry no drag', () => {
  const o = sample(), g = graph(o);
  assert.ok(g.includes(`title="${OVERVIEW.label.runsCode}"`));
  assert.ok(g.includes('title="Also in 2 places"'));
  assert.ok(!/draggable|ondrag|data-dragging|hx-handle|data-control="" aria-label="Link/i.test(g));
});

// ---- scale

test('under the detail zoom an open place is a box with its counts and the page holds no cards', () => {
  const o = overviewOf(bigState(30, 20), []);
  // The first view fits the whole graph; 30 places do not fit above the smallest zoom.
  const g = graph(o, { initialSize: { w: 1200, h: 720 }, initialView: fitView(layoutOf(o, allOpen(o)).bounds, 1200, 720, 16, FIT_FOOT) });
  assert.match(g, /data-detail="boxes"/);
  assert.equal(attr(g, 'data-node').length, 0);
  assert.ok(g.includes(OVERVIEW.hint.zoomedOut));
  assert.ok(g.includes('class="hxo-boxcount"'));
  assert.ok(attr(g, 'data-cluster').length > 0 && attr(g, 'data-cluster').length <= o.groups.length);
  // The header buttons stay, so a place still opens and closes; the place buttons do not (they are too small to press).
  assert.equal([...g.matchAll(/class="hxo-toggle"/g)].length, attr(g, 'data-cluster').length);
  assert.ok(!g.includes('data-open-builder') && !g.includes('data-choose-folder'));
});

test('the page never holds more boxes and cards than the cap, whatever the zoom and the size of the scan', () => {
  const o = overviewOf(bigState(12, 100), []);
  assert.ok(o.groups.reduce((n, x) => n + x.nodes.length, 0) >= 1200);
  for (const k of [0.4, 0.5, 1, 2]) {
    const g = graph(o, { initialSize: { w: 4000, h: 12000 }, initialView: { x: 0, y: 0, k } });
    const total = attr(g, 'data-node').length + attr(g, 'data-cluster').length;
    assert.ok(total <= OVERVIEW_LIMITS.domNodes, `k ${k}: ${total}`);
    if (k >= OVERVIEW_LIMITS.detailZoom) assert.ok(attr(g, 'data-node').length > 0, `k ${k} draws cards`);
  }
  const full = graph(o, { initialSize: { w: 4000, h: 12000 }, initialView: { x: 0, y: 0, k: 1 } });
  assert.ok(full.includes(OVERVIEW.hint.moreParts), 'the page says when parts are out of view');
});

// ---- the places

test('a place outside home shows no "In Bowerloom" and offers "Choose this folder"; a known place under home offers "Open in builder"', () => {
  const source: ScanSource = { id: 'out', name: 'ledger', interfaceName: 'Claude Code', harnessName: 'h', partIds: [], scope: 'project', label: '/Volumes/B/ledger' };
  const state = { ...createSampleOverviewState(), sources: [...createSampleOverviewState().sources, source] } as HarnessState;
  const o = overviewOf(state, [folder('folder-3', '/Volumes/B/ledger', true), folder('folder-7', '~/Projects/weekly-report', true)]);
  const out = o.groups.find(g => g.id === 'out')!, alpha = o.groups.find(g => g.label === '~/Projects/weekly-report')!, beta = o.groups.find(g => g.label === '~/Projects/inbox-tools')!;
  const html = (g: OverviewGroup): string => renderToStaticMarkup(place(g));
  assert.ok(!html(out).includes('In Bowerloom') && !html(out).includes('Not in Bowerloom'), 'nothing is said about a place outside home');
  assert.ok(html(out).includes('Choose this folder') && !html(out).includes('Open in builder'));
  assert.ok(html(out).includes('aria-label="Choose this folder, ledger"'));
  assert.ok(html(alpha).includes('In Bowerloom') && html(alpha).includes('Open in builder') && html(alpha).includes('data-open-builder="folder-7"'));
  assert.ok(html(alpha).includes('aria-label="Open in builder, alpha (Claude Code)"'));
  assert.ok(html(beta).includes('Not in Bowerloom yet') && html(beta).includes('Choose this folder'));
  // Every view draws the same.
  for (const view of [graph(o), list(o)]) { assert.ok(view.includes('Choose this folder, ledger')); assert.equal((view.match(/data-open-builder="folder-7"/g) ?? []).length, 1); }
  // With no engine bridge there is nothing to ask, so no button is drawn.
  assert.equal(renderToStaticMarkup(createElement(PlaceAction, { group: alpha, tools: { ...TOOLS, available: false } })), '');
  // The chooser is off while it is open: marked off for a screen reader, and still a button that keeps the focus (`disabled` would drop it).
  const busy = renderToStaticMarkup(createElement(PlaceAction, { group: beta, tools: { ...TOOLS, busy: true } }));
  assert.match(busy, /aria-disabled="true"/); assert.doesNotMatch(busy, / disabled=""/);
  // A place that is not the one header tab stop is left out of the tab order.
  assert.match(renderToStaticMarkup(createElement(PlaceAction, { group: beta, tools: TOOLS, focusable: false })), /tabindex="-1"/);
});

// ---- the details and the empty views

test('the details of a part: name, kind, summary, the places it is in with their buttons, and what it uses', () => {
  const o = sample([folder('folder-7', '~/Projects/weekly-report', true)]), index = indexOverview(o), copies = sharedIds(o);
  const alphaCopy = copies.find(id => id.startsWith('src-alpha/'))!;
  const html = renderToStaticMarkup(createElement(OverviewDetails, { overview: o, index, selectedId: alphaCopy, onSelect: noop, place }));
  assert.ok(html.includes(`data-details-node="${alphaCopy}"`));
  assert.match(html, />Check facts</); assert.ok(html.includes('Skill'));
  assert.ok(html.includes(OVERVIEW.label.alsoFoundIn));
  assert.equal((html.match(/data-place-row=/g) ?? []).length, 3, 'its own place and the two places that hold a copy');
  assert.equal((html.match(/data-open-builder="folder-7"/g) ?? []).length, 1);
  assert.ok(html.includes('Also in 2 places'));
  assert.match(html, /<h3[^>]*>Used by<\/h3>/);
  assert.ok(html.includes('data-related='));
  // An agent shows what it uses, and a hook shows that it runs code.
  const reviewer = o.groups.find(g => g.id === 'src-alpha')!.nodes.find(n => n.name === 'Reviewer')!;
  const agent = renderToStaticMarkup(createElement(OverviewDetails, { overview: o, index, selectedId: reviewer.id, onSelect: noop, place }));
  assert.match(agent, /<h3[^>]*>Uses<\/h3>/); assert.equal((agent.match(/data-related=/g) ?? []).length, 3);
  const hook = o.groups.find(g => g.id === 'src-alpha')!.nodes.find(n => n.runsCode === true)!;
  const hookHtml = renderToStaticMarkup(createElement(OverviewDetails, { overview: o, index, selectedId: hook.id, onSelect: noop, place }));
  assert.ok(hookHtml.includes('Hook') && hookHtml.includes('data-runs-code=""'));
  // Nothing selected: what the screen is and the read-only line and every place.
  const none = renderToStaticMarkup(createElement(OverviewDetails, { overview: o, index, selectedId: null, onSelect: noop, place }));
  assert.ok(none.includes('data-details-empty') && none.includes(OVERVIEW.paragraph.intro) && none.includes(OVERVIEW.hint.readOnly));
  assert.equal((none.match(/data-place-row=/g) ?? []).length, o.groups.length, 'every place, with its mark and its button, for the places the graph draws as boxes');
  // An id the Overview does not hold is the same as none.
  assert.ok(renderToStaticMarkup(createElement(OverviewDetails, { overview: o, index, selectedId: 'no/such', onSelect: noop, place })).includes('data-details-empty'));
});

test('an empty place says so in the list, and a scan with no parts draws places with "Nothing found"', () => {
  const source: ScanSource = { id: 'void', name: 'empty folder', interfaceName: 'Claude Code', harnessName: 'h', partIds: [], scope: 'project', label: '~/void' };
  const o = overviewOf({ ...createSampleOverviewState(), parts: [], sources: [source] } as HarnessState, []);
  assert.equal(o.groups.length, 1);
  assert.ok(list(o).includes(OVERVIEW.hint.emptyPlace));
  assert.ok(list(o).includes('Nothing found') && graph(o).includes('Nothing found'));
  assert.equal(attr(graph(o), 'data-node').length, 0);
  // A list of no places is an empty list, not a crash.
  const none = overviewOf({ ...createSampleOverviewState(), parts: [], sources: [] } as HarnessState, []);
  assert.equal(none.groups.length, 0);
  assert.equal(attr(list(none), 'data-place').length, 0);
  assert.equal(attr(graph(none), 'data-cluster').length, 0);
});

test('the default open places are drawn open and the rest shut', () => {
  const o = sample(), open = expandedOf(o, new Map());
  const g = graph(o, {}, open);
  const opened = [...g.matchAll(/<div class="hxo-box"[^>]*>/g)].map(m => m[0]).filter(t => t.includes('data-open=""'));
  assert.equal(opened.length, open.size);
});

test('the List draws a limited number of rows of each kind with "Show more", and always the selected part', () => {
  const o = overviewOf(bigState(1, 600), []);
  const skills = o.groups[0]!.nodes.filter(n => n.kind === 'skill');
  assert.ok(skills.length > LIST_ROWS * 2);
  const l = list(o);
  const rows = attr(l, 'data-node');
  assert.ok(rows.length < o.groups[0]!.nodes.length, `${rows.length} rows of ${o.groups[0]!.nodes.length}`);
  assert.equal((l.match(/data-show-more=/g) ?? []).length, 4, 'every kind runs past the limit');
  assert.ok(l.includes('aria-label="Show more, '));
  const last = skills.at(-1)!;
  assert.ok(!rows.includes(last.id));
  assert.ok(attr(list(o, { selectedId: last.id }), 'data-node').includes(last.id), 'the selected part is drawn although it is past the limit');
  // A closed place draws none.
  assert.equal(attr(list(o, {}, new Set()), 'data-node').length, 0);
});

// ---- the source

test('the Overview writes nothing: no engine write, no store change, no drag, no file call in any of its files', () => {
  const dir = join(DESKTOP, 'renderer', 'harness', 'screens');
  const files = readdirSync(dir).filter(f => /^Overview.*\.tsx?$/.test(f));
  assert.ok(files.length >= 6, files.join(', '));
  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /\.(?:run[A-Z]\w*|plan(?!\()\w*|write\w*|save\w*|remove(?!EventListener)\w*|install\w*|adopt\w*)\(/, `${file} calls a write of the engine`);
    assert.doesNotMatch(text, /store\.\w+\(|useHarnessStore|useFolderDraft|openAdopt|openSave|openProject|openInstall|openStart/, `${file} changes something`);
    assert.doesNotMatch(text, /onDrag|onDrop|draggable|onPointerDown=\{e => downNode|setMoved|readFile|writeFile|localStorage|sessionStorage|fetch\(/, `${file} drags, stores or reads a file`);
  }
});
