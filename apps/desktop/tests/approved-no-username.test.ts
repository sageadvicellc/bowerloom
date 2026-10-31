// Owner decision, 2026-10-31: the plan review shows "approved now · <time>" and never the account name of the computer. Older records may still hold a name,
// so the review ignores that field whatever it holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovedList } from '../renderer/harness/sheets/project-review.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';
import type { ApprovedView } from '../shared/engine/types.js';

const NAME = userInfo().username;
const line = (over: Partial<ApprovedView>): ApprovedView => ({
  part: 'guardrails', entry: 'no-push', field: null, engine: 'codex', result: 'weakened', who: NAME, when: '2026-10-31T09:00:00Z',
  reason: 'Approved in the Bowerloom app after reading this line.', earlier: false, ...over,
});
/** The text a person reads: the markup with its tags removed. */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('an approval made now reads "approved now" and its time, with no account name', () => {
  const text = textOf(renderToStaticMarkup(createElement(ApprovedList, { lines: [line({})] })));
  assert.match(text, /approved now · 2026-10-31T09:00:00Z$/);
  assert.ok(!text.includes(NAME), 'the account name is not shown');
  assert.ok(!text.includes(` · ${NAME} · `));
});

test('an earlier approval reads "approved earlier" and its time, with no account name', () => {
  const text = textOf(renderToStaticMarkup(createElement(ApprovedList, { lines: [line({ earlier: true })] })));
  assert.ok(text.endsWith(`${ENGINE_WORDS.hint.approvedEarlier} · 2026-10-31T09:00:00Z`), text);
  assert.ok(!text.includes(NAME));
});

test('the name field of a record never reaches the markup, whatever it holds', () => {
  for (const who of [NAME, 'Some Person', 'x'.repeat(256)]) {
    const html = renderToStaticMarkup(createElement(ApprovedList, { lines: [line({ who }), line({ who, entry: 'other', earlier: true })] }));
    assert.ok(!html.includes(who), `a record name of ${who.length} characters is not shown`);
  }
});
