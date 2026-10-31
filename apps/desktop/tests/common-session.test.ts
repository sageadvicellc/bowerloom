// The prototype session: one store shared through context, kept in memory, refused without a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createStore } from '../shared/world/store.js';
import { WorldProvider, useWorldStore } from '../renderer/common/session.js';
import { createEmptyWorld } from '../renderer/common/empty-world.js';
import { generateWorld } from '../shared/world/sample.js';
import { loadWorld } from '../renderer/common/world.js';

function Probe() {
  const { state } = useWorldStore();
  return createElement('p', null, `${state.draft.items.length} items, ${state.draft.versions.length} versions`);
}

test('a screen under the provider reads the live state of the store', () => {
  const world = generateWorld(1);
  const store = createStore(world);
  const markup = renderToStaticMarkup(createElement(WorldProvider, { store }, createElement(Probe)));
  assert.match(markup, new RegExp(`${world.items.length} items, 0 versions`));
});

test('an action sent through the store changes the draft, and the committed world waits for apply', () => {
  const store = createStore(generateWorld(1));
  const before = store.getState();
  const some = before.draft.items.find(i => i.kind === 'skill' && i.library === null);
  assert.ok(some);
  const project = before.draft.scopes.find(s => s.kind === 'project');
  assert.ok(project);
  store.dispatch({ type: 'installItem', itemId: some.id, targetScopeId: project.id });
  const after = store.getState();
  assert.equal(after.draft.items.length, before.draft.items.length + 1);
  assert.equal(after.committed.items.length, before.committed.items.length);
});

test('a screen without a provider fails in plain words', () => {
  assert.throws(() => renderToStaticMarkup(createElement(Probe)), /WorldProvider/);
});

test('two sessions never share state', () => {
  const a = createStore(createEmptyWorld()), b = createStore(loadWorld());
  assert.notEqual(a.getState().draft.items.length, b.getState().draft.items.length);
});
