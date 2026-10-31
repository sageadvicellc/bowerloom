// The words of export and the plain-JSON round trip of import into a second, separate world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPORT_PROMISE, bundleText, clashWords, describeExport, installBundle, openExportedFile, secretWords } from '../shared/world/export-flow.js';
import { buildBundle } from '../shared/world/bundle.js';
import { CASE_IDS, generateWorld } from '../shared/world/sample.js';
import { createEmptyWorld } from '../renderer/common/fakeApi.js';
import { copy } from './testworld.js';

const world = generateWorld(1);

test('the export summary has counts, tool references and slice rules in words, and the promise', () => {
  const bundle = buildBundle(world, ['global']);
  const d = describeExport(bundle, world);
  assert.equal(d.skills, bundle.items.filter(i => i.kind === 'skill').length);
  assert.equal(d.agents, bundle.items.filter(i => i.kind === 'agent').length);
  assert.equal(d.tools.length, bundle.toolRefs.length);
  assert.equal(d.slices.length, bundle.sliceRules.length);
  assert.ok(d.slices.every(s => s.words.endsWith('.') && !/[*]|\*\*/.test(s.words)));
  assert.match(d.promise, /^This file has no secret values that Bowerloom holds and no wiki page text\./);
  assert.equal(EXPORT_PROMISE, d.promise);
  const missing = d.tools.find(t => t.id === CASE_IDS.mcpMissing)!;
  assert.equal(missing.kindWords, 'tool connection');
  assert.match(missing.secretWords!, /LANTERN_TOKEN/);
  assert.equal(d.tools.find(t => t.id === CASE_IDS.hook)!.kindWords, 'hook (runs code)');
  assert.ok(d.bytes > 1000);
});

test('library items are not in the summary, and no scope gives an empty bundle', () => {
  const none = describeExport(buildBundle(world, []), world);
  assert.deepEqual([none.skills, none.agents, none.tools.length, none.slices.length], [0, 0, 0, 0]);
  const d = describeExport(buildBundle(world, ['global']), world);
  assert.ok(d.agents < 20, 'the 120 library agents stay out');
});

test('the saved text is plain JSON with no secret value and no wiki text', () => {
  const text = bundleText(buildBundle(world, ['global', 'scope-reedmarsh']));
  const json = JSON.parse(text) as { items: unknown[] };
  assert.ok(json.items.length > 0);
  for (const p of world.wikiPages) { assert.ok(!text.includes(p.title), p.id); assert.ok(!text.includes(`"${p.id}"`), p.id); }
  assert.doesNotMatch(text, /"state"/);
});

test('opening the file previews every file, every secret to add and every clash, and changes nothing', () => {
  const text = bundleText(buildBundle(world, ['global']));
  const colleague = createEmptyWorld(), before = copy(colleague);
  const r = openExportedFile(text, colleague);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.preview.files.length > 10);
  assert.ok(r.preview.files.every(f => f.path.startsWith('/sample/harness/.bowerloom/')));
  assert.ok(r.preview.secretsToAdd.some(s => s.name === 'LANTERN_TOKEN'));
  assert.deepEqual(r.preview.clashes, []);
  assert.deepEqual(colleague, before, 'the second world is untouched by a preview');
});

test('installing adds the bundle to the second world only, and a second install shows clashes', () => {
  const mine = generateWorld(1), mineBefore = copy(mine);
  const text = bundleText(buildBundle(mine, ['global']));
  const first = installBundle(text, createEmptyWorld());
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.ok(first.world.items.length > 20);
  assert.deepEqual(mine, mineBefore, 'my world is untouched');
  assert.equal(first.world.items.some(i => i.kind === 'tool' && i.toolKind === 'mcp' && i.secret !== null && i.secret.state === 'present'), false, 'every secret arrives as missing');
  const again = openExportedFile(text, first.world);
  assert.equal(again.ok, true);
  if (again.ok) assert.ok(again.preview.clashes.length > 0);
});

test('a file that is not JSON, or not a bundle, is an error in plain words and nothing is installed', () => {
  const w = createEmptyWorld();
  for (const bad of ['', 'not json', '{', '[]', 'null', '{"items":[]}', '{"scopeIds":[],"items":[{"kind":"x"}],"toolRefs":[],"sliceRules":[]}']) {
    for (const r of [openExportedFile(bad, w), installBundle(bad, w)]) {
      assert.equal(r.ok, false, bad);
      if (!r.ok) { assert.ok(r.message.length > 10, bad); assert.doesNotMatch(r.message, /SyntaxError|undefined|\[object|at \w+\.|JSON\.parse/, r.message); }
    }
  }
  const secretBundle = JSON.parse(bundleText(buildBundle(world, ['global']))) as { toolRefs: { secret: Record<string, unknown> | null }[] };
  const ref = secretBundle.toolRefs.find(t => t.secret !== null)!;
  ref.secret = { ...ref.secret, value: 'hunter2' };
  const r = openExportedFile(JSON.stringify(secretBundle), w);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.message, /never accepts a secret value/);
});

test('the words for a clash and a secret', () => {
  assert.match(clashWords({ itemId: 'a', name: 'Plan', reason: 'same-name' }), /Plan.*already there/);
  assert.match(clashWords({ itemId: 'a', name: 'Plan', reason: 'different-text' }), /Plan.*different text.*new name/);
  assert.match(secretWords({ kind: 'env', name: 'X_TOKEN' }), /X_TOKEN.*environment variable/);
  assert.match(secretWords({ kind: 'keychain', name: 'Y_KEY' }), /Y_KEY.*keychain entry/);
});
