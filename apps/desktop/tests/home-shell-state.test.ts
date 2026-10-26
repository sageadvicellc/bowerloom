// The shell's pure logic: the width of the navigation, the keys of the two toggles, the words of their tooltips, and the arrow keys of the navigation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAV_HIDE_BELOW, NAV_RAIL_BELOW, NAV_WIDTH, keyShortcuts, navModeOf, roveTarget, shellKey, shortcutText, toggleTip } from '../renderer/home/shell/shell-state.js';
import { assertTextBudget } from '../shared/home/textbudget.js';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

test('the navigation follows the width until the person chooses: open from 1100, a rail from 900, hidden under 900', () => {
  assert.deepEqual([NAV_HIDE_BELOW, NAV_RAIL_BELOW, NAV_WIDTH.open, NAV_WIDTH.rail], [900, 1100, 232, 48]);
  assert.equal(navModeOf(1440, null), 'open'); assert.equal(navModeOf(1280, null), 'open'); assert.equal(navModeOf(1100, null), 'open');
  assert.equal(navModeOf(1099, null), 'rail'); assert.equal(navModeOf(900, null), 'rail');
  assert.equal(navModeOf(899, null), 'hidden'); assert.equal(navModeOf(600, null), 'hidden');
});

test('a choice wins over the width, except that under 900 the navigation is hidden whatever was chosen', () => {
  assert.equal(navModeOf(1440, false), 'rail'); assert.equal(navModeOf(900, true), 'open');
  assert.equal(navModeOf(899, true), 'hidden'); assert.equal(navModeOf(300, false), 'hidden');
});

test('Ctrl+B or Cmd+B toggles the navigation, with Shift the details, and nothing else is a shortcut', () => {
  assert.equal(shellKey(key('b', { ctrlKey: true })), 'nav'); assert.equal(shellKey(key('b', { metaKey: true })), 'nav'); assert.equal(shellKey(key('B', { metaKey: true })), 'nav');
  assert.equal(shellKey(key('b', { ctrlKey: true, shiftKey: true })), 'details'); assert.equal(shellKey(key('B', { metaKey: true, shiftKey: true })), 'details');
  assert.equal(shellKey(key('b')), null, 'a plain b is a letter'); assert.equal(shellKey(key('b', { shiftKey: true })), null);
  assert.equal(shellKey(key('b', { ctrlKey: true, altKey: true })), null); assert.equal(shellKey(key('z', { ctrlKey: true })), null); assert.equal(shellKey(key('k', { metaKey: true })), null);
});

test('a toggle tooltip names the action and the shortcut the way the keyboard does, and stays within the text budget', () => {
  assert.equal(shortcutText('nav', true), '⌘B'); assert.equal(shortcutText('details', true), '⇧⌘B');
  assert.equal(shortcutText('nav', false), 'Ctrl+B'); assert.equal(shortcutText('details', false), 'Ctrl+Shift+B');
  assert.equal(toggleTip('Hide navigation', 'nav', false), 'Hide navigation (Ctrl+B)'); assert.equal(toggleTip('Show details', 'details', true), 'Show details (⇧⌘B)');
  assert.equal(keyShortcuts('nav'), 'Control+B Meta+B'); assert.equal(keyShortcuts('details'), 'Control+Shift+B Meta+Shift+B');
  for (const mac of [true, false]) for (const [name, which] of [['Hide navigation', 'nav'], ['Show navigation', 'nav'], ['Hide details', 'details'], ['Show details', 'details']] as const) assert.deepEqual(assertTextBudget(`<p>${toggleTip(name, which, mac)}</p>`), []);
});

test('Up and Down move through the navigation and stop at the ends; Home and End jump; other keys stay', () => {
  assert.equal(roveTarget('ArrowDown', 0, 5), 1); assert.equal(roveTarget('ArrowDown', 4, 5), 4); assert.equal(roveTarget('ArrowUp', 3, 5), 2); assert.equal(roveTarget('ArrowUp', 0, 5), 0);
  assert.equal(roveTarget('Home', 3, 5), 0); assert.equal(roveTarget('End', 1, 5), 4);
  assert.equal(roveTarget('ArrowLeft', 1, 5), null); assert.equal(roveTarget('Enter', 1, 5), null); assert.equal(roveTarget('ArrowDown', 0, 0), null);
});
