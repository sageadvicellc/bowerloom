// Fix pass C1: import and export tell the truth. A moved item, a hook, a changed secret, a no-op install and a dropped draft are all said out loud.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildBundle, commitImport, previewImport } from '../shared/proto/bundle.js';
import { clashWords, hookWords, installNothingNew, movedWords, nothingToExportWords, openExportedFile, installBundle, bundleText } from '../shared/proto/export-flow.js';
import { createEmptyWorld } from '../renderer/proto/fakeApi.js';
import { ProtoProvider, useProtoStore } from '../renderer/proto/session.js';
import { VersionsView } from '../renderer/proto/VersionsScreen.js';
import { createStore } from '../shared/proto/store.js';
import type { AgentItem, Bundle, World } from '../shared/proto/types.js';
import { agent, hook, makeWorld, mcp, skill } from './proto-testworld.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const empty = (): World => createEmptyWorld();
const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

// ---- 1. an item whose project is missing is listed as moved

test('a project-only item imported into a world with no such project is listed as moved to the global harness', () => {
  const w = makeWorld();
  const bundle = clone(buildBundle({ ...w, items: [skill('sp', 'Only here', 'proj'), agent('ap', 'Project agent', ['sp'], 'proj')] }, ['proj']));
  const target = empty();
  assert.equal(target.scopes.length, 1, 'the target has only the global scope');
  const p = previewImport(bundle, target);
  assert.deepEqual(p.moved.map(m => [m.itemName, m.fromScope, m.toScope]).sort(), [['Only here', 'proj', 'Global'], ['Project agent', 'proj', 'Global']].sort());
  const landed = commitImport(bundle, target);
  assert.ok(landed.items.filter(i => i.kind !== 'tool').every(i => i.scopeId === 'global'), 'preview and install agree: it lands in the global harness');
  assert.match(movedWords(p.moved[0]!), /^.+ was in the project proj, which this workspace does not have, so it goes to the global harness\.$/);
});

test('nothing is listed as moved when the project exists in the target, or the item was global', () => {
  const w = makeWorld();
  const bundle = clone(buildBundle(w, ['global', 'proj']));
  assert.deepEqual(previewImport(bundle, w).moved, []);
  assert.deepEqual(previewImport(clone(buildBundle(w, ['global'])), empty()).moved, []);
});

// ---- 2. a hook is shown

test('a hook-only file previews the hook by name, and says it runs code and arrives as a name only', () => {
  const bundle = clone(buildBundle({ ...makeWorld(), items: [hook('h1', 'Format hook')] }, ['global']));
  const p = previewImport(bundle, empty());
  assert.equal(p.files.length, 0);
  assert.deepEqual(p.hooks, [{ name: 'Format hook', scope: 'Global' }]);
  assert.equal(commitImport(bundle, empty()).items.filter(i => i.kind === 'tool').length, 1);
  assert.equal(hookWords(p.hooks[0]!), 'Hook Format hook runs code. It arrives as a name only: Bowerloom does not write the code.');
});

test('a hook that is already there is not listed again', () => {
  const w: World = { ...makeWorld(), items: [hook('h1', 'Format hook')] };
  assert.deepEqual(previewImport(clone(buildBundle(w, ['global'])), w).hooks, []);
});

// ---- 3. the same tool name with another secret is a different tool

test('a tool with the same name but a different secret is kept apart, and the preview and the install agree', () => {
  const mine: World = { ...empty(), items: [{ ...mcp('t1', 'Search', 'OLD_TOKEN'), secret: { kind: 'env', name: 'OLD_TOKEN', state: 'present' } }] };
  const theirs: World = { ...makeWorld(), items: [mcp('t9', 'Search', 'NEW_TOKEN'), { ...agent('a1', 'Planner'), definition: { ...agent('a1', 'Planner').definition, toolAttachments: [{ toolId: 't9', access: 'read-write' }] } }] };
  const bundle: Bundle = clone(buildBundle(theirs, ['global']));
  const p = previewImport(bundle, mine);
  assert.deepEqual(p.secretsToAdd, [{ kind: 'env', name: 'NEW_TOKEN' }]);
  assert.deepEqual(p.clashes.filter(c => c.reason === 'different-secret').map(c => c.name), ['Search']);
  assert.match(clashWords({ itemId: 't9', name: 'Search', reason: 'different-secret' }), /Search: same name, different secret, so both are kept under their own names\./);
  const landed = commitImport(bundle, mine);
  const tools = landed.items.filter(i => i.kind === 'tool');
  assert.equal(tools.length, 2, 'the old tool and a new one');
  assert.equal(new Set(tools.map(t => t.name)).size, 2, 'distinct names');
  const added = tools.find(t => t.id !== 't1')!;
  assert.ok(added.toolKind === 'mcp' && added.secret !== null && added.secret.name === 'NEW_TOKEN' && added.secret.state === 'missing', 'a slot exists for the secret the preview named');
  const wired = landed.items.find((i): i is AgentItem => i.kind === 'agent')!;
  assert.deepEqual(wired.definition.toolAttachments, [{ toolId: added.id, access: 'read-write' }], 'the agent uses the new tool, not the old one');
  assert.deepEqual(p.grants, [{ agent: 'Planner', tool: added.name, access: 'read-write' }]);
});

test('a tool with the same name and the same secret is still reused', () => {
  const mine: World = { ...empty(), items: [{ ...mcp('t1', 'Search', 'SAME'), secret: { kind: 'env', name: 'SAME', state: 'present' } }] };
  const bundle = clone(buildBundle({ ...makeWorld(), items: [mcp('t9', 'Search', 'SAME')] }, ['global']));
  const p = previewImport(bundle, mine);
  assert.deepEqual(p.secretsToAdd, []); assert.deepEqual(p.clashes, []);
  assert.equal(commitImport(bundle, mine), mine, 'nothing added');
});

// ---- 4. an install that adds nothing says so

test('installing a file that adds nothing is told as nothing new', () => {
  const w = makeWorld(), file = bundleText(buildBundle(w, ['global']));
  const first = installBundle(file, empty());
  assert.ok(first.ok);
  assert.equal(installNothingNew(empty(), first.ok ? first.world : empty()), false);
  const again = installBundle(file, first.ok ? first.world : empty());
  assert.ok(again.ok);
  assert.equal(installNothingNew(first.ok ? first.world : empty(), again.ok ? again.world : empty()), true);
});

test('a ticked harness with nothing of its own says why Save is off; no tick says to tick one', () => {
  assert.match(nothingToExportWords(0), /^Tick a harness to see what its file would hold\.$/);
  assert.match(nothingToExportWords(1), /^Project overrides are not exported; this harness has no items of its own\.$/);
  const markup = renderToStaticMarkup(createElement(ProtoProvider, { store: createStore(empty()), children: createElement(function Probe() { return createElement(VersionsView, { session: useProtoStore(), initialTab: 'share' }); }) }));
  assert.match(text(markup), /Project overrides are not exported; this harness has no items of its own\./);
  assert.doesNotMatch(text(markup), /Tick a harness/);
});

test('opening a file shows moved items and hooks in the preview text', () => {
  const w = makeWorld();
  const file = bundleText(buildBundle({ ...w, items: [skill('sp', 'Only here', 'proj'), hook('h1', 'Format hook')] }, ['proj', 'global']));
  const r = openExportedFile(file, empty());
  assert.ok(r.ok && r.preview.moved.length === 1 && r.preview.hooks.length === 1);
});
