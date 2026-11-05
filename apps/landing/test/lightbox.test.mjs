// The lightbox keyboard rules, as pure functions: where Tab goes when it would leave the dialog, and what closes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tabTarget, closesOnBackdrop } from '../src/lightbox.ts';

test('Tab on the last control wraps to the first, and Shift+Tab on the first wraps to the last', () => {
  const list = ['close', 'scroll'];
  assert.equal(tabTarget(list, 'scroll', false), 'close');
  assert.equal(tabTarget(list, 'close', true), 'scroll');
});

test('Tab inside the list is left to the browser', () => {
  const list = ['close', 'scroll', 'last'];
  assert.equal(tabTarget(list, 'close', false), null);
  assert.equal(tabTarget(list, 'scroll', true), null);
  assert.equal(tabTarget(list, 'scroll', false), null);
});

test('with one control, Tab stays on it; with none, Tab goes nowhere', () => {
  assert.equal(tabTarget(['close'], 'close', false), 'close');
  assert.equal(tabTarget(['close'], 'close', true), 'close');
  assert.equal(tabTarget([], null, false), null);
});

test('focus that sits outside the list is pulled in at the matching end', () => {
  const list = ['close', 'scroll'];
  assert.equal(tabTarget(list, 'outside', false), 'close');
  assert.equal(tabTarget(list, null, true), 'scroll');
});

test('a click closes only when the press began on the backdrop and ended on it', () => {
  const dialog = {}, child = {};
  assert.equal(closesOnBackdrop(true, child, dialog), false, 'a click inside the picture');
  assert.equal(closesOnBackdrop(false, dialog, dialog), false, 'a drag that began inside and ended on the backdrop');
  assert.equal(closesOnBackdrop(true, dialog, dialog), true);
});
