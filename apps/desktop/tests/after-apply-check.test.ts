// "Did this do what you wanted?": the steps and what each tap records, and the markup of each step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CHECK_START, cappedNote, checkNext } from '../renderer/harness/sheets/check-logic.js';
import type { CheckState } from '../renderer/harness/sheets/check-logic.js';
import { AfterApplyCheck } from '../renderer/harness/sheets/after-apply-check.js';
import { ENGINE_WORDS } from '../renderer/harness/words-engine.js';
import { bannedHere, countWords, LIMITS } from '../shared/harness/words.js';

const html = (initial?: CheckState): string => renderToStaticMarkup(createElement(AfterApplyCheck, { record: async () => undefined, ...(initial === undefined ? {} : { initial }) }));

test('the first step asks the question with three buttons, Yes, Partly and No, and nothing else', () => {
  const out = html();
  assert.ok(out.includes('Did this do what you wanted?'));
  assert.deepEqual([...out.matchAll(/<button[^>]*>.*?<\/button>/g)].map(m => m[0].replace(/<[^>]+>/g, '')), ['Yes', 'Partly', 'No']);
  assert.doesNotMatch(out, /textarea/);
});

test('Yes records at once with no note and says thanks', () => {
  const r = checkNext(CHECK_START, { kind: 'answer', answer: 'yes' });
  assert.deepEqual(r, { state: { step: 'thanks' }, record: { answer: 'yes', note: null } });
  const out = html(r.state);
  assert.ok(out.includes('Thanks. This stays on this computer.'));
  assert.doesNotMatch(out, /<button/);
});

test('Partly and No record nothing yet and ask what the person was trying to do, with a field of at most 500 characters, Save and Skip', () => {
  for (const answer of ['partly', 'no'] as const) {
    const r = checkNext(CHECK_START, { kind: 'answer', answer });
    assert.equal(r.record, null);
    assert.deepEqual(r.state, { step: 'why', answer, note: '' });
    const out = html(r.state);
    assert.ok(out.includes('What were you trying to do?'));
    assert.match(out, /<textarea[^>]*maxLength="500"/);
    assert.deepEqual([...out.matchAll(/<button[^>]*>.*?<\/button>/g)].map(m => m[0].replace(/<[^>]+>/g, '')), ['Save', 'Skip']);
  }
});

test('Save records the answer with the note, an empty note is none, and Skip records the answer without the note', () => {
  const why: CheckState = { step: 'why', answer: 'partly', note: '' };
  const typed = checkNext(why, { kind: 'type', note: '  I wanted two files.  ' });
  assert.equal(typed.record, null);
  assert.deepEqual(checkNext(typed.state, { kind: 'save' }), { state: { step: 'thanks' }, record: { answer: 'partly', note: 'I wanted two files.' } });
  assert.deepEqual(checkNext({ ...why, note: '   ' }, { kind: 'save' }).record, { answer: 'partly', note: null });
  assert.deepEqual(checkNext(typed.state, { kind: 'skip' }), { state: { step: 'thanks' }, record: { answer: 'partly', note: null } });
});

test('the note is capped at 500 characters, and a finished check takes no more taps', () => {
  assert.equal(cappedNote('x'.repeat(900)).length, 500); assert.equal(cappedNote('short'), 'short');
  const long = checkNext({ step: 'why', answer: 'no', note: '' }, { kind: 'type', note: 'y'.repeat(900) });
  assert.equal((long.state as { note: string }).note.length, 500);
  const thanks: CheckState = { step: 'thanks' };
  for (const action of [{ kind: 'answer', answer: 'no' }, { kind: 'save' }, { kind: 'skip' }] as const) assert.deepEqual(checkNext(thanks, action), { state: thanks, record: null });
  // A tap that does not belong to the step changes nothing.
  assert.equal(checkNext(CHECK_START, { kind: 'save' }).record, null);
});

test('the words of the check obey the app\'s limits and banned list', () => {
  const W = ENGINE_WORDS;
  for (const text of [W.paragraph.checkAsk, W.paragraph.checkWhy, W.paragraph.checkThanks]) { assert.ok(countWords(text) <= LIMITS.paragraph); assert.equal(bannedHere(text), null); }
  for (const text of [W.label.checkYes, W.label.checkPartly, W.label.checkNo, W.label.checkSave, W.label.checkSkip]) { assert.ok(countWords(text) <= LIMITS.label); assert.equal(bannedHere(text), null); }
});
