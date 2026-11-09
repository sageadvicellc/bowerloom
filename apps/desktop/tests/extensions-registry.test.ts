// The extension registry is the only route table. These tests cover resolve, the protection of the default extensions, the manifest check and the pure-code boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry } from '../shared/extensions/registry.js';
import { checkManifest } from '../shared/extensions/manifest.js';
import { BASE_ROUTES, DEFAULT_EXTENSIONS, DEFAULT_IDS, ROUTE_OWNERS } from '../shared/extensions/defaults.js';
import type { DefaultId } from '../shared/extensions/defaults.js';
import type { Registry } from '../shared/extensions/registry.js';
import { FIRST_RUN } from '../shared/harness/route.js';
import type { RouteName } from '../shared/harness/route.js';
import { DESKTOP } from './support.js';

const mountOf = (id: string): string => `mount:${id}`;
/** A registry holding every default extension except the ones named in `without`. */
function registryWith(without: readonly string[] = []): Registry<string> {
  const registry = createRegistry<string>();
  for (const manifest of DEFAULT_EXTENSIONS) if (!without.includes(manifest.id)) assert.equal(registry.register(manifest, mountOf(manifest.id)).ok, true, manifest.id);
  return registry;
}
const good = { id: 'sample', title: 'Sample', kind: 'ui', routes: ['sample-route'], protected: false };

test('the six default areas are the ones the plan names, all protected', () => {
  assert.deepEqual([...DEFAULT_IDS], ['overview', 'harnesses', 'library', 'projects', 'interfaces-history-help', 'first-run']);
  assert.deepEqual(DEFAULT_EXTENSIONS.map(m => m.id), [...DEFAULT_IDS]);
  for (const manifest of DEFAULT_EXTENSIONS) { assert.equal(manifest.protected, true, manifest.id); assert.equal(manifest.kind, 'ui'); assert.equal(checkManifest(manifest).ok, true, manifest.id); }
});

test('resolve returns the mount for a registered route and a named not-found result otherwise', () => {
  const registry = registryWith();
  const found = registry.resolve('library');
  assert.deepEqual(found, { found: true, id: 'library', mount: 'mount:library' });
  const missing = registry.resolve('no-such-route');
  assert.deepEqual(missing, { found: false, code: 'ROUTE_NOT_FOUND', route: 'no-such-route' });
  assert.deepEqual(createRegistry<string>().resolve('overview'), { found: false, code: 'ROUTE_NOT_FOUND', route: 'overview' }, 'an empty registry has no route');
});

test('resolve and uninstall never throw for a value with no prototype, a symbol or an object that cannot become text', () => {
  const registry = registryWith();
  const strange: unknown[] = [Object.create(null), Symbol('x'), { toString() { throw new Error('no text'); } }, { toString: null, valueOf: null }, 10n, () => 'x'];
  for (const value of strange) {
    const found = registry.resolve(value as string);
    assert.equal(found.found, false);
    if (!found.found) { assert.equal(found.code, 'ROUTE_NOT_FOUND'); assert.equal(typeof found.route, 'string'); }
    const gone = registry.uninstall(value as string);
    assert.equal(gone.ok, false);
    if (!gone.ok) { assert.equal(gone.refusal.code, 'UNKNOWN_EXTENSION'); assert.equal(typeof gone.refusal.message, 'string'); }
  }
  assert.equal(registry.list().length, 6);
});

test('the registry object is frozen: its methods cannot be swapped', () => {
  const registry = registryWith();
  assert.equal(Object.isFrozen(registry), true);
  assert.throws(() => { (registry as { resolve: unknown }).resolve = () => ({ found: true }); }, TypeError);
});

test('resolve never throws and never answers blank for a strange route', () => {
  const registry = registryWith();
  for (const route of ['', ' ', '__proto__', 'constructor', 'toString', 'Library', 'library/', '../library', 'a'.repeat(10000), '📚']) {
    const answer = registry.resolve(route);
    assert.equal(answer.found, false, JSON.stringify(route));
    if (!answer.found) { assert.equal(answer.code, 'ROUTE_NOT_FOUND'); assert.equal(answer.route, route); }
  }
  for (const bad of [undefined, null, 7, {}, []]) assert.equal(registry.resolve(bad as unknown as string).found, false);
});

for (const area of DEFAULT_IDS) {
  test(`without the ${area} registration its routes are not found and the other areas still resolve`, () => {
    const registry = registryWith([area]);
    const own = DEFAULT_EXTENSIONS.find(m => m.id === area)!;
    for (const route of own.routes) assert.deepEqual(registry.resolve(route), { found: false, code: 'ROUTE_NOT_FOUND', route }, route);
    for (const other of DEFAULT_EXTENSIONS) {
      if (other.id === area) continue;
      for (const route of other.routes) assert.deepEqual(registry.resolve(route), { found: true, id: other.id, mount: mountOf(other.id) }, route);
    }
    assert.deepEqual(registry.list().map(m => m.id), DEFAULT_IDS.filter(id => id !== area));
  });

  test(`uninstall of ${area} is refused as PROTECTED, and it stays registered and resolves`, () => {
    const registry = registryWith();
    const answer = registry.uninstall(area);
    assert.equal(answer.ok, false);
    if (!answer.ok) { assert.equal(answer.refusal.code, 'PROTECTED'); assert.ok(answer.refusal.message.length > 0); assert.deepEqual(answer.refusal.paths, []); }
    assert.ok(registry.list().some(m => m.id === area));
    assert.equal(registry.list().length, 6);
    for (const route of DEFAULT_EXTENSIONS.find(m => m.id === area)!.routes) assert.deepEqual(registry.resolve(route), { found: true, id: area, mount: mountOf(area) }, route);
    assert.equal(registry.uninstall(area).ok, false, 'a second try is refused too');
  });
}

test('uninstall of an unknown id is refused as UNKNOWN_EXTENSION, and an unprotected extension can be removed', () => {
  const registry = registryWith();
  for (const id of ['nope', '', '__proto__', 'Overview']) {
    const answer = registry.uninstall(id);
    assert.equal(answer.ok, false, id);
    if (!answer.ok) assert.equal(answer.refusal.code, 'UNKNOWN_EXTENSION', id);
  }
  assert.equal(registry.list().length, 6);
  assert.equal(registry.register(good, 'm').ok, true);
  assert.equal(registry.resolve('sample-route').found, true);
  const gone = registry.uninstall('sample');
  assert.equal(gone.ok, true);
  assert.equal(registry.resolve('sample-route').found, false, 'its route is free again');
  assert.equal(registry.uninstall('sample').ok, false, 'it is gone');
  assert.equal(registry.register(good, 'm2').ok, true, 'the id and route can be registered again');
});

// Type-level check: every route name has an owner. A new Route member is a type error until ROUTE_OWNERS names its owner. A key that is not a route is caught at run time, below.
type OwnedKeys = keyof typeof ROUTE_OWNERS;
const noMissingRoute: [Exclude<RouteName, OwnedKeys>] extends [never] ? true : never = true;
const ownersAreDefaults: [(typeof ROUTE_OWNERS)[RouteName]] extends [DefaultId] ? true : never = true;

const ROUTE_NAMES_EXPECTED: readonly RouteName[] = ['welcome', 'choose', 'read', 'notes', 'overview', 'harnesses', 'builder', 'file', 'library', 'projects', 'runs', 'compare', 'interfaces', 'history', 'help'];

test('the owner table covers exactly the routes of the Route union, and the first-run default owns exactly FIRST_RUN', () => {
  assert.deepEqual([noMissingRoute, ownersAreDefaults], [true, true]);
  assert.deepEqual(Object.keys(ROUTE_OWNERS), [...BASE_ROUTES]);
  assert.equal(BASE_ROUTES.length, 15);
  assert.deepEqual([...BASE_ROUTES].sort(), [...ROUTE_NAMES_EXPECTED].sort(), 'an extra key in the owner table is not a route');
  assert.equal(Object.isFrozen(ROUTE_OWNERS), true);
  assert.equal(Object.isFrozen(BASE_ROUTES), true);
  for (const owner of Object.values(ROUTE_OWNERS)) assert.ok((DEFAULT_IDS as readonly string[]).includes(owner), owner);
  const firstRun = DEFAULT_EXTENSIONS.find(m => m.id === 'first-run')!;
  assert.deepEqual([...firstRun.routes].sort(), [...FIRST_RUN].sort());
  for (const manifest of DEFAULT_EXTENSIONS) for (const route of manifest.routes) assert.equal(ROUTE_OWNERS[route as RouteName], manifest.id, route);
});

test('the registry is the only route table: each of the 15 base routes is owned by exactly one default extension', () => {
  const expected: readonly RouteName[] = ['welcome', 'choose', 'read', 'notes', 'overview', 'harnesses', 'builder', 'file', 'library', 'projects', 'runs', 'compare', 'interfaces', 'history', 'help'];
  assert.deepEqual([...BASE_ROUTES].sort(), [...expected].sort());
  assert.equal(BASE_ROUTES.length, 15);
  const owners = new Map<string, string[]>();
  for (const manifest of DEFAULT_EXTENSIONS) for (const route of manifest.routes) owners.set(route, [...(owners.get(route) ?? []), manifest.id]);
  assert.equal(owners.size, 15, 'no route beyond the 15');
  for (const route of expected) assert.equal(owners.get(route)?.length, 1, `${route} has one owner`);
  const ownerOf = (route: string): string | undefined => owners.get(route)?.[0];
  for (const route of ['welcome', 'choose', 'read', 'notes']) assert.equal(ownerOf(route), 'first-run');
  for (const route of ['harnesses', 'builder', 'file']) assert.equal(ownerOf(route), 'harnesses');
  for (const route of ['projects', 'runs', 'compare']) assert.equal(ownerOf(route), 'projects');
  for (const route of ['interfaces', 'history', 'help']) assert.equal(ownerOf(route), 'interfaces-history-help');
  assert.equal(ownerOf('overview'), 'overview');
  assert.equal(ownerOf('library'), 'library');
  const registry = registryWith();
  for (const route of expected) assert.equal(registry.resolve(route).found, true, route);
});

test('register refuses a route that another extension already owns, and keeps the first owner', () => {
  const registry = registryWith();
  const answer = registry.register({ ...good, routes: ['sample-route', 'library'] }, 'thief');
  assert.equal(answer.ok, false);
  if (!answer.ok) { assert.equal(answer.refusal.code, 'ROUTE_TAKEN'); assert.match(answer.refusal.message, /library/); }
  assert.deepEqual(registry.resolve('library'), { found: true, id: 'library', mount: mountOf('library') });
  assert.equal(registry.resolve('sample-route').found, false, 'a refused registration leaves no half of itself');
  assert.equal(registry.list().length, 6);
});

test('register refuses a second extension with the same id', () => {
  const registry = createRegistry<string>();
  assert.equal(registry.register(good, 'a').ok, true);
  const again = registry.register({ ...good, routes: ['other-route'] }, 'b');
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.refusal.code, 'EXTENSION_EXISTS');
  assert.deepEqual(registry.resolve('sample-route'), { found: true, id: 'sample', mount: 'a' });
  assert.equal(registry.resolve('other-route').found, false);
});

test('register refuses a manifest that lists one route twice', () => {
  const registry = createRegistry<string>();
  const answer = registry.register({ ...good, routes: ['a-route', 'a-route'] }, 'm');
  assert.equal(answer.ok, false);
  if (!answer.ok) assert.equal(answer.refusal.code, 'BAD_MANIFEST');
});

test('BAD_MANIFEST: a missing id, empty routes, a wrong kind, a non-string route and other bad shapes', () => {
  const { id: _id, ...noId } = good;
  const cases: [string, unknown][] = [
    ['missing id', noId], ['empty id', { ...good, id: '' }], ['id with a slash', { ...good, id: 'a/b' }], ['id with spaces', { ...good, id: 'a b' }], ['numeric id', { ...good, id: 4 }],
    ['empty routes', { ...good, routes: [] }], ['routes not a list', { ...good, routes: 'sample-route' }], ['missing routes', { id: 'x', title: 'X', kind: 'ui', protected: false }],
    ['wrong kind', { ...good, kind: 'theme' }], ['missing kind', { id: 'x', title: 'X', routes: ['r'], protected: false }],
    ['non-string route', { ...good, routes: ['ok', 5] }], ['null route', { ...good, routes: [null] }], ['empty route', { ...good, routes: [''] }], ['route with a slash', { ...good, routes: ['a/b'] }],
    ['missing title', { ...good, title: undefined }], ['empty title', { ...good, title: '  ' }],
    ['protected not a boolean', { ...good, protected: 'yes' }], ['protected missing', { id: 'x', title: 'X', kind: 'ui', routes: ['r'] }],
    ['null', null], ['undefined', undefined], ['a string', 'manifest'], ['a number', 3], ['an array', [good]],
  ];
  for (const [name, manifest] of cases) {
    const check = checkManifest(manifest);
    assert.equal(check.ok, false, name);
    if (!check.ok) assert.equal(check.refusal.code, 'BAD_MANIFEST', name);
    const registry = createRegistry<string>();
    const answer = registry.register(manifest, 'm');
    assert.equal(answer.ok, false, name);
    if (!answer.ok) assert.equal(answer.refusal.code, 'BAD_MANIFEST', name);
    assert.equal(registry.list().length, 0, `${name} leaves nothing registered`);
  }
  assert.equal(checkManifest(good).ok, true);
});

test('a checked manifest is a frozen copy: changing the caller\'s object later changes nothing', () => {
  const registry = createRegistry<string>();
  const routes = ['sample-route'];
  const mine = { ...good, routes, protected: false };
  assert.equal(registry.register(mine, 'm').ok, true);
  routes.push('library'); mine.protected = true; mine.id = 'changed';
  assert.equal(registry.resolve('library').found, false);
  assert.equal(registry.list()[0]?.id, 'sample');
  assert.equal(registry.list()[0]?.protected, false);
  assert.equal(Object.isFrozen(registry.list()[0]), true);
});

test('shared/extensions is pure code: no electron, no node: module, no file, no network', () => {
  const dir = join(DESKTOP, 'shared', 'extensions');
  const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
  assert.ok(files.length >= 4, `${files.length} files`);
  const strip = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const file of files) {
    const code = strip(readFileSync(join(dir, file), 'utf8'));
    assert.doesNotMatch(code, /['"`]electron['"`]/, `${file} names electron`);
    assert.doesNotMatch(code, /['"`]node:[a-z]/, `${file} imports a node: module`);
    assert.doesNotMatch(code, /\brequire\(/, `${file} uses require`);
    assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|WebSocket|\beval\(|new Function\(/, `${file} reaches out or runs text`);
    for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) assert.match(m[1]!, /^\.\.?\//, `${file} imports ${m[1]}, only relative files are allowed`);
    for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) assert.match(m[1]!, /^\.\.?\//, `${file} has a bare import of ${m[1]}, only relative files are allowed`);
    assert.doesNotMatch(code, /\bimport\s*\(/, `${file} uses a dynamic import()`);
    assert.doesNotMatch(code, /\bimport\.meta\b|\bprocess\b|\brequire\b/, `${file} reaches the host`);
  }
});
