// The Grid view of the Overview drawn as markup (beta.2): a tile for each kind a place holds and none for the rest, tiles sized by what the place holds, the same names and
// marks as the List, a cap on what a tile lists with "and N more", and one seam for movement. No DOM: static markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bentoOf } from '../shared/harness/overview-bento.js';
import { overviewOf } from '../shared/harness/overview.js';
import type { Overview, OverviewGroup } from '../shared/harness/overview.js';
import { createSampleOverviewState } from '../shared/harness/sample.js';
import type { HarnessState, Part, PartKind, ScanSource } from '../shared/harness/types.js';
import { OverviewGrid } from '../renderer/harness/screens/OverviewGrid.js';
import { indexOverview } from '../renderer/harness/screens/OverviewModel.js';
import { PlaceAction, PlaceMark } from '../renderer/harness/screens/OverviewParts.js';
import type { PlaceTools } from '../renderer/harness/screens/OverviewParts.js';
import { DESKTOP } from './support.js';

const noop = (): void => undefined;
const TOOLS: PlaceTools = { available: true, busy: false, open: noop, choose: noop };
const place = (g: OverviewGroup): ReactElement => createElement('span', null, createElement(PlaceMark, { group: g }), createElement(PlaceAction, { group: g, tools: TOOLS }));
const part = (id: string, kind: PartKind, name: string): Part => ({ id, kind, name, summary: `${name}.`, description: '', path: '', source: '', origin: '', fileText: '', cannotUse: [], inLibrary: true });

/** A made-up scan of one place that holds `n` of each kind named, so the sizes of its tiles are known. */
function placeOf(held: Partial<Record<PartKind, number>>, id = 's0', name = 'Alpha'): { parts: Part[]; source: ScanSource } {
  const parts: Part[] = [], ids: string[] = [];
  for (const kind of ['agent', 'skill', 'tool', 'context'] as const) for (let i = 0; i < (held[kind] ?? 0); i += 1) {
    const partId = `${id}-${kind}-${i}`;
    parts.push(part(partId, kind, `${kind} ${String(i).padStart(3, '0')}`)); ids.push(partId);
  }
  return { parts, source: { id, name, interfaceName: 'Claude Code', harnessName: id, partIds: ids, links: [], scope: id === 's0' ? 'home' : 'project', label: id === 's0' ? '~' : `~/${name.toLowerCase()}` } };
}
function overviewWith(places: readonly Partial<Record<PartKind, number>>[]): Overview {
  const made = places.map((held, i) => placeOf(held, `s${i}`, `Place ${i}`));
  const state: HarnessState = { parts: made.flatMap(m => m.parts), harnesses: [], projects: [], installs: [], interfaces: [], runs: [], history: [], sources: made.map(m => m.source), chosenSourceIds: [], nextId: 100 };
  return overviewOf(state, []);
}
const sample = (): Overview => overviewOf(createSampleOverviewState(), []);
const allOpen = (o: Overview): ReadonlySet<string> => new Set(o.groups.map(g => g.id));
const attr = (html: string, name: string): string[] => [...html.matchAll(new RegExp(` ${name}="([^"]*)"`, 'g'))].map(m => m[1]!);

function grid(o: Overview, extra: Partial<Parameters<typeof OverviewGrid>[0]> = {}, open: ReadonlySet<string> = allOpen(o)): string {
  return renderToStaticMarkup(createElement(OverviewGrid, { overview: o, expanded: open, index: indexOverview(o), selectedId: null, onSelect: noop, onToggle: noop, onShowList: noop, place, ...extra }));
}

test('a place gets a tile for each kind it holds, and none for a kind it lacks', () => {
  const o = overviewWith([{ agent: 2, skill: 5, context: 1 }]);
  const html = grid(o);
  assert.deepEqual(attr(html, 'data-tile'), ['s0/agent', 's0/skill', 's0/context']);
  assert.ok(!html.includes('data-tile="s0/tool"'));
  assert.equal((html.match(/data-node=/g) ?? []).length, 8, 'every part of this small place is listed');
});

test('tiles grow with what the place holds: many skills make a large tile, one set of notes stays small', () => {
  const o = overviewWith([{ agent: 1, skill: 30, context: 1 }]);
  const html = grid(o);
  const sizeOf = (kind: string): string => new RegExp(`data-tile="s0/${kind}"[^>]*data-size="(\\w+)"`).exec(html)![1]!;
  assert.equal(sizeOf('skill'), 'large');
  assert.equal(sizeOf('agent'), 'small');
  assert.equal(sizeOf('context'), 'small');
  // The markup holds the plan the pure function made: the same places in the grid.
  const plan = bentoOf(o.groups[0]!.counts, 4);
  for (const t of plan.tiles) assert.ok(html.includes(`grid-column:${t.col} / span ${t.colSpan};grid-row:${t.row} / span ${t.rowSpan}`), t.kind);
});

test('the number of columns follows the width of the stage', () => {
  const o = overviewWith([{ agent: 2, skill: 5, tool: 3, context: 1 }]);
  assert.deepEqual(attr(grid(o, { initialWidth: 1000 }), 'data-columns').slice(0, 2), ['4', '4']);
  assert.ok(attr(grid(o, { initialWidth: 600 }), 'data-columns').includes('2'));
  assert.ok(attr(grid(o, { initialWidth: 300 }), 'data-columns').includes('1'));
});

test('a tile lists only what fits, ends with "and N more" that opens the list, and always shows the selected part', () => {
  const o = overviewWith([{ skill: 80 }]);
  const group = o.groups[0]!, tile = bentoOf(group.counts, 4).tiles[0]!;
  const html = grid(o);
  const rows = attr(html, 'data-node');
  assert.equal(rows.length, tile.show);
  assert.ok(html.includes(`and ${80 - tile.show} more`));
  assert.match(html, /data-more="s0\/skill"/);
  assert.match(html, /aria-label="and \d+ more, skills in Place 0, show in list"/);
  const last = group.nodes.at(-1)!;
  assert.ok(!rows.includes(last.id));
  const picked = grid(o, { selectedId: last.id });
  assert.ok(attr(picked, 'data-node').includes(last.id), 'the selected part is listed although it is past the limit');
  assert.equal(attr(picked, 'data-node').length, tile.show);
  // Few parts: no "more".
  assert.ok(!grid(overviewWith([{ skill: 3 }])).includes('data-more='));
});

test('a closed place draws its header and no tile', () => {
  const o = sample();
  const open = new Set([o.groups[0]!.id]);
  const html = grid(o, {}, open);
  assert.equal((html.match(/data-place-toggle=/g) ?? []).length, o.groups.length);
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.ok(attr(html, 'data-tile').every(t => t.startsWith(`${o.groups[0]!.id}/`)));
  assert.equal(grid(o, {}, new Set()).includes('data-tile='), false);
});

test('an open place does not repeat its counts in its header (the tile heads carry them); a closed place and the List still say them', () => {
  const o = overviewWith([{ agent: 4, skill: 14 }]);
  assert.ok(!grid(o).includes('hxo-counts'), 'open: no counts line');
  assert.ok(grid(o, {}, new Set()).includes('4 agents, 14 skills'), 'closed: the counts');
  assert.ok(grid(o).includes('aria-label="Collapse Place 0, ~, 4 agents, 14 skills"'), 'the toggle still names what the place holds');
});

test('a place whose counts are wrong still shows every part it holds, and never says nothing was found', () => {
  const o = overviewWith([{ skill: 5, tool: 2 }]);
  const wrong = { ...o, groups: [{ ...o.groups[0]!, counts: { agent: 0, skill: 0, tool: 0, context: 0 } }] };
  const html = grid(wrong);
  assert.ok(!html.includes('Nothing was found'), 'no "nothing found" while the place holds parts');
  assert.ok(!html.includes('data-empty-place'));
  assert.equal(attr(html, 'data-node').length, 7, 'every part is listed');
  assert.deepEqual(attr(html, 'data-tile'), ['s0/skill', 's0/tool']);
  // The other way: counts that claim parts the place does not hold draw no tile.
  const none = { ...o, groups: [{ ...o.groups[0]!, nodes: [] }] };
  assert.ok(grid(none).includes('data-empty-place'));
});

test('a long name has a title, and a tile is a labelled group, not a landmark', () => {
  const html = grid(overviewWith([{ skill: 2 }]));
  assert.match(html, /class="hxo-cell-name" title="skill 000"/);
  assert.match(html, /role="group" aria-labelledby="hxo-t-s0-skill"/);
  assert.ok(!html.includes('<section'), 'no section element: it would be a landmark for each tile');
  assert.match(html, /<h3 class="hxo-cell-head" id="hxo-t-s0-skill" aria-label="Skills, Place 0, 2">/);
});

test('a place that holds nothing says so, with no tile', () => {
  const o = overviewWith([{ skill: 2 }, {}]);
  const html = grid(o);
  assert.ok(html.includes('data-empty-place=""'));
  assert.ok(html.includes('Nothing was found in this place.'));
});

test('each part is a button with the same accessible name the List gives, and a press marks it', () => {
  const o = sample();
  const html = grid(o);
  assert.ok(attr(html, 'aria-label').some(l => /, skill, /.test(l)), 'a part named with its kind and its place');
  const first = o.groups[0]!.nodes[0]!;
  const picked = grid(o, { selectedId: first.id });
  assert.match(picked, new RegExp(`data-node="${first.id.replace(/[/]/g, '\\/')}"[^>]*data-selected=""`));
  assert.match(picked, /aria-pressed="true"/);
  assert.match(picked, /data-faded=""/, 'what is not joined to the selected part is dimmed');
});

test('a very large workspace draws a bounded page: a tile lists a few parts, not all of them', () => {
  const o = overviewWith([{ agent: 300, skill: 900, tool: 300, context: 300 }]);
  const html = grid(o);
  assert.ok(attr(html, 'data-node').length <= 4 * 20, `${attr(html, 'data-node').length} parts on the page`);
  assert.equal(attr(html, 'data-tile').length, 4);
});

test('the grid view says it is read-only and carries the place marks and buttons', () => {
  const html = grid(sample());
  assert.ok(html.includes('data-read-only=""'));
  assert.ok(html.includes('data-choose-folder=') || html.includes('data-open-builder='));
});

test('only the motion seam animates: no other Overview file calls animate or sets a transform itself', () => {
  const dir = join(DESKTOP, 'renderer', 'harness', 'screens');
  for (const file of readdirSync(dir).filter(f => /^[Oo]verview.*\.tsx?$/.test(f) && f !== 'overview-motion.ts' && f !== 'OverviewGraph.tsx')) {
    const text = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /\.animate\(|requestAnimationFrame\([^)]*transform|style\.transform|transition\s*:/, `${file} moves a tile outside the seam`);
  }
  assert.match(readFileSync(join(dir, 'OverviewGrid.tsx'), 'utf8'), /from '\.\/overview-motion\.js'/);
});
