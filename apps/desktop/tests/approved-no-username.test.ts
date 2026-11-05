// Owner decision, 2026-10-31: the plan review shows "approved now · <time>" and never the account name of the computer. The window's view of an approval holds no
// name at all (`ApprovedView` has no name field; engine-service.test.ts checks the view of a real plan). Older records on disk may still hold a name; the view drops it, and the review shows none even when a record sends one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovedList } from '../renderer/harness/sheets/project-review.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';
import { APPROVER_NAME } from '../main/approver.js';
import type { ApprovedView } from '../shared/engine/types.js';
import { DESKTOP } from './support.js';

/** The real account name, and a fixed fake one that cannot be a part of any word in the markup. */
const NAMES = [userInfo().username, 'zq-test-user-91'];
const line = (over: Partial<ApprovedView> = {}): ApprovedView => ({
  part: 'guardrails', entry: 'no-push', field: null, engine: 'codex', result: 'weakened', when: '2026-10-31T09:00:00Z',
  reason: 'Approved in the Bowerloom app after reading this line.', earlier: false, ...over,
});
/** A record from an older build, which still sends a name field. */
const legacy = (who: string, over: Partial<ApprovedView> = {}): ApprovedView => ({ ...line(over), who } as ApprovedView);
/** The text a person reads: the markup with its tags removed. */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('an approval made now reads "approved now" and its time', () => {
  const text = textOf(renderToStaticMarkup(createElement(ApprovedList, { lines: [line()] })));
  assert.match(text, /approved now · 2026-10-31T09:00:00Z$/);
});

test('an earlier approval reads "approved earlier" and its time', () => {
  const text = textOf(renderToStaticMarkup(createElement(ApprovedList, { lines: [line({ earlier: true })] })));
  assert.ok(text.endsWith(`${ENGINE_WORDS.hint.approvedEarlier} · 2026-10-31T09:00:00Z`), text);
});

test('a name field that an older record sends never reaches the markup, the real account name or a fixed fake one', () => {
  for (const who of [...NAMES, 'Some Person', 'x'.repeat(256)]) {
    const html = renderToStaticMarkup(createElement(ApprovedList, { lines: [legacy(who), legacy(who, { entry: 'other', earlier: true })] }));
    assert.ok(!html.includes(who), `a record name of ${who.length} characters is not shown`);
  }
  const fake = textOf(renderToStaticMarkup(createElement(ApprovedList, { lines: [legacy('zq-test-user-91')] })));
  assert.ok(!fake.includes('zq-test-user-91'));
});

test('the app writes one fixed word as the name of an approval, and main passes that word and no account name', () => {
  assert.equal(APPROVER_NAME, 'this Mac');
  for (const name of NAMES) assert.notEqual(APPROVER_NAME, name);
  const main = readFileSync(join(DESKTOP, 'main', 'main.ts'), 'utf8');
  assert.match(main, /who: APPROVER_NAME,/);
  assert.doesNotMatch(main, /userInfo/);
});
