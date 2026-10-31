// The tray under a row of agent tiles, rendered to markup: compact rows in columns, "Show more" after 12, inert while closed, and the math that puts it after a row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TRAY_LIMIT, Tray, trayId } from '../renderer/home/kit/Tray.js';
import type { TrayProps } from '../renderer/home/kit/Tray.js';
import { rowOf, trackCount } from '../renderer/home/map/useColumns.js';
import type { ShelfEntry } from '../shared/home/cards.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const none = (): void => undefined;
const many = (kind: ShelfEntry['kind'], n: number): ShelfEntry[] => Array.from({ length: n }, (_, i) => ({ id: `${kind}-${i}`, kind, name: `Item number ${i + 1}`, hint: 'A line about it.' }));
const html = (props: Partial<TrayProps> = {}): string => renderToStaticMarkup(createElement(Tray, { agentId: 'a1', agentName: 'Meeting assistant', kind: 'skill', entries: many('skill', 3), open: false, onSelectItem: none, ...props }));

test('a closed tray is inert and has the id the count button points at; an open one is not inert', () => {
  const closed = html();
  assert.match(closed, /<div class="kit-tray" id="tray-a1-skill" data-kind="skill" data-agent="a1" inert="" role="group" aria-label="Meeting assistant: skills">/);
  assert.equal(trayId('a1', 'skill'), 'tray-a1-skill');
  const open = html({ open: true });
  assert.match(open, /data-open=""/); assert.doesNotMatch(open, /inert/);
});

test('a tray lists compact rows of the kit, each one a button that says whether it is selected', () => {
  const m = html({ open: true, itemId: 'skill-1' });
  assert.equal([...m.matchAll(/<li data-line="skill-\d">/g)].length, 3);
  assert.equal([...m.matchAll(/class="kit-card" data-kind="skill" data-size="small"/g)].length, 3, 'every row is the kit row, one height');
  assert.equal([...m.matchAll(/aria-pressed="true"/g)].length, 1); assert.match(m, /data-selected=""/);
  assert.doesNotMatch(m, /kit-chip|kit-acc|kit-badge/);
  assert.deepEqual(assertTextBudget(m), []);
});

test('a tray shows 12 rows and a "Show more" button that says what it shows more of', () => {
  assert.equal(TRAY_LIMIT, 12);
  const m = html({ open: true, entries: many('skill', 15) });
  assert.equal([...m.matchAll(/data-line=/g)].length, 12);
  const more = /<button[^>]*data-more=""[^>]*>/.exec(m);
  assert.ok(more !== null, 'a Show more icon button'); assert.match(more![0], /aria-label="Show more skills"/); assert.match(more![0], /aria-expanded="false"/);
  assert.match(m, /<button[^>]*data-more=""[^>]*><svg[\s\S]*?<\/svg><\/button>/, 'an icon and no words'); assert.match(m, /role="tooltip"[^>]*>Show more<\/span>/, 'the tooltip says Show more');
  assert.doesNotMatch(html({ open: true, entries: many('skill', 12) }), /data-more/, 'twelve rows need no Show more');
});

test('a state keeps its words, and the state of copies is a text button only when the page can open the dialog', () => {
  const entries: ShelfEntry[] = [{ id: 'sk', kind: 'skill', name: 'Write a weekly summary', badge: { label: '3 different copies', tone: 'warn' } }, { id: 'sk2', kind: 'skill', name: 'Read my calendar', badge: { label: 'needs a key', tone: 'warn' } }];
  const m = html({ open: true, entries, onBadgePress: none });
  assert.match(m, /<button type="button" class="kit-status" data-tone="warn" data-no-drag=""><span class="kit-dot" aria-hidden="true"><\/span><span>3 different copies<\/span>(?:<span class="kit-status-short" aria-hidden="true" data-short="\d+ copies"><\/span>)?<\/button>/);
  assert.match(m, /<span class="kit-status" data-tone="warn" data-no-drag=""><span class="kit-dot" aria-hidden="true"><\/span><span>needs a key<\/span><\/span>/, 'a key is not a button');
  assert.doesNotMatch(html({ open: true, entries }), /<button type="button" class="kit-status"/, 'with no handler the state is only words');
});

test('the tray goes after the last tile of its row, wherever the grid wraps', () => {
  assert.deepEqual(rowOf(0, 10, 3), { start: 0, end: 2, last: false });
  assert.deepEqual(rowOf(2, 10, 3), { start: 0, end: 2, last: true });
  assert.deepEqual(rowOf(9, 10, 3), { start: 9, end: 9, last: true }, 'the last row may hold one tile');
  assert.deepEqual(rowOf(7, 8, 4), { start: 4, end: 7, last: true });
  assert.deepEqual(rowOf(0, 1, 5), { start: 0, end: 0, last: true });
  assert.equal(trackCount('232px 232px 232px'), 3); assert.equal(trackCount('none'), 1); assert.equal(trackCount(''), 1); assert.equal(trackCount('  232px  '), 1);
});
