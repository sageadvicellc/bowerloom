// registerDefaults and registerLoaded: the order of protection is loud. A loaded extension can never take a default's id or route, or claim to be protected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../shared/extensions/registry.js';
import { DEFAULT_EXTENSIONS, DEFAULT_IDS } from '../shared/extensions/defaults.js';
import { registerDefaults, registerLoaded } from '../shared/extensions/register.js';
import { EXTENSION_CODES } from '../shared/extensions/types.js';

const good = { id: 'sample', title: 'Sample', kind: 'ui', routes: ['sample-route'], protected: false };
const code = (answer: { ok: boolean; refusal?: { code: string } }): string | undefined => answer.refusal?.code;

test('RESERVED is one of the extension refusal codes', () => {
  assert.ok((EXTENSION_CODES as readonly string[]).includes('RESERVED'));
});

test('registerDefaults registers the six defaults, all protected, in order', () => {
  const registry = createRegistry();
  registerDefaults(registry);
  assert.deepEqual(registry.list().map(m => m.id), [...DEFAULT_IDS]);
  assert.equal(registry.list().every(m => m.protected), true);
  assert.deepEqual(registry.resolve('library'), { found: true, id: 'library', mount: undefined });
});

test('registerDefaults takes a mount for each default when it is given one', () => {
  const registry = createRegistry<string>();
  registerDefaults(registry, id => `mount:${id}`);
  assert.deepEqual(registry.resolve('builder'), { found: true, id: 'harnesses', mount: 'mount:harnesses' });
});

test('registerDefaults twice throws a plain Error that names the extension id and the refusal code', () => {
  const registry = createRegistry();
  registerDefaults(registry);
  assert.throws(() => registerDefaults(registry), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /"overview"/);
    assert.match(error.message, /EXTENSION_EXISTS/);
    return true;
  });
  assert.equal(registry.list().length, 6, 'nothing doubled');
});

test('registerDefaults throws when a route is already taken, naming the id and ROUTE_TAKEN', () => {
  const registry = createRegistry();
  assert.equal(registry.register({ ...good, routes: ['library'] }, undefined).ok, true);
  assert.throws(() => registerDefaults(registry), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /"library"/);
    assert.match(error.message, /ROUTE_TAKEN/);
    return true;
  });
});

test('a loaded manifest with a default id or a default route is RESERVED, even before the defaults register', () => {
  const registry = createRegistry();
  const results = registerLoaded(registry, [
    { ...good, id: 'help' }, { ...good, id: 'overview' }, { ...good, id: 'first-run' },
    { ...good, routes: ['overview'] }, { ...good, routes: ['fine', 'interfaces-history-help'] }, { ...good, routes: ['welcome'] },
  ]);
  assert.deepEqual(results.map(code), ['RESERVED', 'RESERVED', 'RESERVED', 'RESERVED', 'RESERVED', 'RESERVED']);
  assert.equal(registry.list().length, 0);
  registerDefaults(registry);
  assert.equal(registry.list().length, 6, 'the defaults still register after the refused loaded ones');
});

test('a loaded manifest that says protected: true is RESERVED and registers nothing', () => {
  const registry = createRegistry();
  const results = registerLoaded(registry, [{ ...good, protected: true }]);
  assert.deepEqual(results.map(code), ['RESERVED']);
  assert.equal(registry.list().length, 0);
});

test('registerLoaded registers a good manifest, answers each one in order, and passes BAD_MANIFEST and duplicates through', () => {
  const registry = createRegistry<string>();
  const results = registerLoaded(registry, [good, 42, good, { ...good, id: 'other', routes: ['sample-route'] }, { ...good, id: 'third', routes: ['third-route'] }], m => `mount:${(m as { id: string }).id}`);
  assert.deepEqual(results.map(r => r.ok ? 'ok' : r.refusal.code), ['ok', 'BAD_MANIFEST', 'EXTENSION_EXISTS', 'ROUTE_TAKEN', 'ok']);
  assert.deepEqual(registry.list().map(m => m.id), ['sample', 'third']);
  assert.deepEqual(registry.resolve('sample-route'), { found: true, id: 'sample', mount: 'mount:sample' });
  assert.equal(registry.uninstall('sample').ok, true, 'a loaded extension is not protected');
});

test('registerLoaded returns BAD_MANIFEST (not a throw) for strange input, and an empty list gives an empty result', () => {
  const registry = createRegistry();
  assert.deepEqual(registerLoaded(registry, []), []);
  const results = registerLoaded(registry, [null, undefined, 'x', [], Object.create(null)]);
  assert.deepEqual(results.map(code), ['BAD_MANIFEST', 'BAD_MANIFEST', 'BAD_MANIFEST', 'BAD_MANIFEST', 'BAD_MANIFEST']);
});

test('defaults cannot be uninstalled, or replaced by an id from a loaded source', () => {
  const registry = createRegistry<string>();
  registerDefaults(registry, id => `mount:${id}`);
  for (const manifest of DEFAULT_EXTENSIONS) {
    assert.equal(code(registry.uninstall(manifest.id)), 'PROTECTED', manifest.id);
    const replaced = registerLoaded(registry, [{ ...good, id: manifest.id, routes: ['x-route'] }], () => 'thief');
    assert.equal(code(replaced[0]!), 'RESERVED', manifest.id);
  }
  assert.equal(registry.list().length, 6);
  assert.deepEqual(registry.resolve('library'), { found: true, id: 'library', mount: 'mount:library' });
});

test('registering { ...good, id: "library", protected: false } directly is refused and leaves the default intact', () => {
  const registry = createRegistry<string>();
  registerDefaults(registry, id => `mount:${id}`);
  const answer = registry.register({ ...good, id: 'library', protected: false }, 'thief');
  assert.equal(answer.ok, false);
  assert.equal(code(answer), 'EXTENSION_EXISTS');
  assert.equal(registry.list().find(m => m.id === 'library')?.protected, true);
  assert.deepEqual(registry.resolve('library'), { found: true, id: 'library', mount: 'mount:library' });
  assert.equal(code(registry.uninstall('library')), 'PROTECTED');
});
