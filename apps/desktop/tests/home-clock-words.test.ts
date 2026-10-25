// The time on a save point, in words: today, yesterday, a date, a date with a year.
import test from 'node:test';
import assert from 'node:assert/strict';
import { clockWords, timeOfDay } from '../shared/clock-words.js';
import { countWords, assertTextBudget } from '../shared/home/textbudget.js';

const now = new Date(2026, 9, 25, 16, 31);

test('a moment today reads "Today, <time>"', () => {
  assert.equal(clockWords(new Date(2026, 9, 25, 8, 42), now, 'en-US'), 'Today, 8:42 AM');
  assert.equal(clockWords(new Date(2026, 9, 25, 0, 5), now, 'en-US'), 'Today, 12:05 AM');
  assert.equal(clockWords(new Date(2026, 9, 25, 16, 31), now, 'en-GB'), 'Today, 16:31');
});

test('the day before reads "Yesterday", also across a month and a year', () => {
  assert.equal(clockWords(new Date(2026, 9, 24, 17, 5), now, 'en-US'), 'Yesterday, 5:05 PM');
  assert.equal(clockWords(new Date(2026, 8, 30, 9, 0), new Date(2026, 9, 1, 8, 0), 'en-US'), 'Yesterday, 9:00 AM');
  assert.equal(clockWords(new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1, 0, 10), 'en-US'), 'Yesterday, 11:59 PM');
});

test('an earlier day this year reads as a date, and another year adds the year', () => {
  assert.equal(clockWords(new Date(2026, 9, 3, 9, 30), now, 'en-US'), '3 October, 9:30 AM');
  assert.equal(clockWords(new Date(2025, 2, 14, 14, 0), now, 'en-US'), '14 March 2025, 2:00 PM');
});

test('every answer is a label of at most five words, with no banned word', () => {
  for (const at of [new Date(2026, 9, 25, 8, 42), new Date(2026, 9, 24, 17, 5), new Date(2026, 9, 3, 9, 30), new Date(2025, 2, 14, 14, 0)]) {
    const text = clockWords(at, now, 'en-US');
    assert.ok(countWords(text) <= 5, text);
    assert.deepEqual(assertTextBudget(`<p>${text}</p>`), [], text);
  }
  assert.equal(typeof timeOfDay(now), 'string');
});
