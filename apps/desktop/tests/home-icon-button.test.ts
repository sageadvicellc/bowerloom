// Wave F: the icon button, its tooltip, and read-only mode, drawn to markup. The tooltip's own place is pure arithmetic, and the read-only store never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconButton } from '../renderer/home/kit/IconButton.js';
import { KIT_ICON_NAMES } from '../renderer/home/kit/icons.js';
import { Tooltip } from '../renderer/home/kit/Tooltip.js';
import { EditButton, EditIconButton, READ_ONLY_REASON, ReadOnlyFlag, ReadOnlyScope, guardedStore, useReadOnly } from '../renderer/home/read-only.js';
import { createStore } from '../shared/proto/store.js';
import { ownedAgents, shelvesOf } from '../shared/home/cards.js';
import { removeAction, saveAction } from '../renderer/home/store-actions.js';
import { loadWorld } from '../renderer/proto/world.js';
import { useProtoStore } from '../renderer/proto/session.js';
import { assertTextBudget, countWords } from '../shared/home/textbudget.js';

const none = (): void => undefined;

test('an icon button has a name, one icon, no words, a tooltip that describes it, and the 32 px square flag', () => {
  const m = renderToStaticMarkup(createElement(IconButton, { icon: 'trash', label: 'Remove', onClick: none }));
  const button = /<button[^>]*>/.exec(m)![0];
  assert.match(button, /aria-label="Remove"/); assert.match(button, /data-icon-only=""/); assert.match(button, /type="button"/);
  const described = /aria-describedby="([^"]+)"/.exec(button);
  assert.ok(described !== null, 'described by the tooltip');
  assert.match(m, new RegExp(`<span class="kit-tip-text" role="tooltip" id="${described![1]!.replace(/[:]/g, '\\$&')}">Remove</span>`));
  assert.match(m, /<button[^>]*><svg[^>]*>[\s\S]*<\/svg><\/button>/, 'the button holds the icon and no words');
  assert.doesNotMatch(m, /data-open/, 'closed when drawn');
  assert.deepEqual(assertTextBudget(m), []);
});

test('the tooltip can say something other than the name, and sits on the side asked for', () => {
  const m = renderToStaticMarkup(createElement(IconButton, { icon: 'sidebar-left', label: 'Hide navigation', tip: 'Hide navigation (Ctrl+B)', side: 'right' }));
  assert.match(m, /aria-label="Hide navigation"/); assert.match(m, /data-side="right"[^>]*>Hide navigation \(Ctrl\+B\)</);
  assert.doesNotMatch(renderToStaticMarkup(createElement(IconButton, { icon: 'close', label: 'Close' })), /data-side/, 'the default side leaves the markup as it was');
});

test('every icon in the kit has paths to draw, and the new ones are there', () => {
  for (const name of ['sidebar-left', 'sidebar-right', 'search', 'trash', 'undo', 'copy', 'chevron-up', 'sort', 'library', 'help', 'globe', 'select-all', 'clear', 'lock'] as const) assert.ok(KIT_ICON_NAMES.includes(name), name);
});

test('a tooltip that is off leaves out its words and its description, and keeps the button where it was', () => {
  const draw = (off: boolean): string => renderToStaticMarkup(createElement(Tooltip, { text: 'Agents', side: 'right', off, children: aria => createElement('button', { type: 'button', ...aria }, 'Agents') }));
  const on = draw(false), away = draw(true);
  assert.match(on, /aria-describedby/); assert.match(on, /role="tooltip"/); assert.match(on, /data-side="right"/);
  assert.doesNotMatch(away, /aria-describedby|role="tooltip"/); assert.match(away, /^<span class="kit-tip"><button type="button">Agents<\/button><\/span>$/);
});

// ---- Read only.
test('read only is off by default, and a flag turns it on for what is below', () => {
  const Probe = (): ReturnType<typeof createElement> => createElement('i', null, String(useReadOnly()));
  assert.equal(renderToStaticMarkup(createElement(Probe)), '<i>false</i>');
  assert.equal(renderToStaticMarkup(createElement(ReadOnlyFlag, { value: true }, createElement(Probe))), '<i>true</i>');
});

test('the reason a held-back control gives is short, plain, and within the text budget', () => {
  assert.equal(READ_ONLY_REASON, 'Read-only: your setup is not changed.');
  assert.ok(countWords(READ_ONLY_REASON) <= 12);
  assert.deepEqual(assertTextBudget(`<p>${READ_ONLY_REASON}</p>`), []);
});

test('read only, an edit button keeps its words and its place, says aria-disabled, is not natively disabled, gives the reason, and has no click', () => {
  const draw = (readOnly: boolean): string => renderToStaticMarkup(createElement(ReadOnlyFlag, { value: readOnly }, createElement(EditButton, { variant: 'primary', disabled: true, onClick: none }, 'Save')));
  const held = draw(true);
  assert.match(held, /aria-disabled="true"/); assert.doesNotMatch(held, /<button[^>]* disabled=""/); assert.match(held, /data-readonly=""/); assert.match(held, />Save<\/button>/);
  assert.match(held, new RegExp(`role="tooltip"[^>]*>${READ_ONLY_REASON.replace(/[.]/g, '\\.')}<`));
  const free = draw(false);
  assert.match(free, /<button[^>]* disabled=""/); assert.doesNotMatch(free, /aria-disabled|role="tooltip"|data-readonly/);
});

test('read only, an edit icon button keeps its name but its tooltip gives the reason', () => {
  const held = renderToStaticMarkup(createElement(ReadOnlyFlag, { value: true }, createElement(EditIconButton, { icon: 'trash', label: 'Remove', onClick: none })));
  assert.match(held, /aria-label="Remove"/); assert.match(held, /aria-disabled="true"/); assert.match(held, />Read-only: your setup is not changed\.<\/span>/);
  const free = renderToStaticMarkup(createElement(ReadOnlyFlag, { value: false }, createElement(EditIconButton, { icon: 'trash', label: 'Remove', onClick: none })));
  assert.match(free, />Remove<\/span>/); assert.doesNotMatch(free, /aria-disabled/);
  assert.deepEqual(assertTextBudget(held), []);
});

test('the read-only scope hands the screens a store that cannot change: the state and the number of versions never move', () => {
  const store = createStore(loadWorld());
  const before = store.getState();
  const guarded = guardedStore(store);
  const agent = ownedAgents(before.draft).find(a => shelvesOf(before.draft, a).skills.length > 0)!;
  const remove = removeAction(agent.id, 'skill', shelvesOf(before.draft, agent).skills[0]!.id);
  for (const action of [remove, saveAction('x'), { type: 'discard' }, { type: 'undo' }, { type: 'redo' }, { type: 'restore', versionId: 'v1' }] as const) guarded.dispatch(action);
  assert.equal(store.getState(), before, 'the very same state');
  assert.equal(store.getState().committed.versions.length, before.committed.versions.length);
  // The guard only holds back dispatch: reading and listening are the real store's.
  assert.equal(guarded.getState(), before); assert.equal(typeof guarded.subscribe(none), 'function');
  // And the same store still changes when it is asked directly (the guard is not a frozen store).
  store.dispatch(remove);
  assert.notEqual(store.getState().draft, before.draft);
  store.dispatch(saveAction('direct'));
  assert.equal(store.getState().committed.versions.length, before.committed.versions.length + 1);
});

test('a read-only scope gives a screen the guarded dispatch; a scope that is not read only gives it the real one', () => {
  const store = createStore(loadWorld());
  let seen: { readOnly: boolean; same: boolean } | null = null;
  const Probe = (): ReturnType<typeof createElement> => { const { dispatch } = useProtoStore(); seen = { readOnly: useReadOnly(), same: dispatch === store.dispatch }; return createElement('i'); };
  renderToStaticMarkup(createElement(ReadOnlyScope, { readOnly: true, store }, createElement(Probe)));
  assert.deepEqual(seen, { readOnly: true, same: false });
  renderToStaticMarkup(createElement(ReadOnlyScope, { readOnly: false, store }, createElement(Probe)));
  assert.deepEqual(seen, { readOnly: false, same: true });
});
