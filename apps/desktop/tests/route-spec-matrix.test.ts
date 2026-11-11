// The route-to-spec matrix (docs/v0.9/route-spec-matrix.json) must list every route of the registry, and every file it names must exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_ROUTES, DEFAULT_IDS, ROUTE_OWNERS } from '../shared/extensions/defaults.js';
import { DESKTOP } from './support.js';

const REPO = join(DESKTOP, '..', '..');
interface Row {
  id: string; kind: 'route' | 'param' | 'sheet' | 'launch' | 'chrome' | 'state'; route?: string; name?: string; routes?: string[];
  params?: string[]; sheets?: string[]; modes: string[]; screenFiles?: string[]; targetExtension: string | null;
  e2e: { sample: string[]; real: string[]; noBridge: string[] }; unit: string[]; newSpec?: string | null;
}
const matrix = JSON.parse(readFileSync(join(REPO, 'docs', 'v0.9', 'route-spec-matrix.json'), 'utf8')) as { rows: Row[] };
const rows = matrix.rows;
const ofKind = (kind: Row['kind']): Row[] => rows.filter(r => r.kind === kind);
const MODES = ['sample', 'real', 'no-bridge'];
const SHEETS = ['start', 'adopt', 'project', 'save', 'install', 'add', 'export', 'import'];
const PARAMS = ['id', 'kind', 'partId', 'group'];

test('the matrix has exactly one route row for each route of BASE_ROUTES, in no other number', () => {
  const names = ofKind('route').map(r => r.route);
  assert.deepEqual([...names].sort(), [...BASE_ROUTES].sort());
  assert.equal(new Set(names).size, names.length, 'no route has two rows');
  assert.equal(BASE_ROUTES.length, 15);
});

test('every route row names the default extension that owns the route', () => {
  for (const row of ofKind('route')) assert.equal(row.targetExtension, ROUTE_OWNERS[row.route as keyof typeof ROUTE_OWNERS], row.id);
  for (const row of rows) if (row.targetExtension !== null) assert.ok((DEFAULT_IDS as readonly string[]).includes(row.targetExtension), `${row.id}: ${row.targetExtension}`);
});

test('the params of each route row are the params the Route type declares in shared/harness/route.ts', () => {
  const source = readFileSync(join(DESKTOP, 'shared', 'harness', 'route.ts'), 'utf8');
  for (const row of ofKind('route')) {
    const line = source.split('\n').find(l => l.includes(`readonly name: '${row.route}'`));
    assert.ok(line !== undefined, `${row.id}: found in route.ts`);
    const declared = [...line.matchAll(/readonly (\w+)\??:/g)].map(m => m[1]!).filter(n => n !== 'name');
    assert.deepEqual([...(row.params ?? [])].sort(), declared.sort(), row.id);
  }
});

test('the matrix has a row for each route param, each sheet, the sample and real launches, the no-bridge launch, and the shell chrome', () => {
  assert.deepEqual(ofKind('param').map(r => r.name).sort(), [...PARAMS].sort());
  assert.deepEqual(ofKind('sheet').map(r => r.name).sort(), [...SHEETS].sort());
  assert.deepEqual(ofKind('launch').map(r => r.id).sort(), ['launch:no-bridge', 'launch:real', 'launch:sample', 'launch:sample-preview-engines']);
  assert.deepEqual(ofKind('chrome').map(r => r.id).sort(), ['chrome:navigation', 'chrome:toast', 'chrome:unsaved-title']);
  for (const row of ofKind('route')) for (const sheet of row.sheets ?? []) assert.ok(SHEETS.includes(sheet), `${row.id}: sheet ${sheet}`);
  for (const row of ofKind('param')) for (const route of row.routes ?? []) assert.ok(BASE_ROUTES.includes(route as never), `${row.id}: route ${route}`);
});

test('row ids are unique, and every mode is one of sample, real and no-bridge', () => {
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  for (const row of rows) { assert.ok(row.modes.length > 0, row.id); for (const mode of row.modes) assert.ok(MODES.includes(mode), `${row.id}: ${mode}`); }
});

test('Runs and Compare have a sample mode only, as at the base', () => {
  for (const name of ['runs', 'compare']) assert.deepEqual(ofKind('route').find(r => r.route === name)?.modes, ['sample']);
});

test('a mode that lists a spec is a mode of the row, and the no-bridge specs sit on a no-bridge row', () => {
  for (const row of rows) {
    if (row.e2e.noBridge.length > 0) assert.ok(row.modes.includes('no-bridge'), row.id);
    if (row.e2e.sample.length > 0) assert.ok(row.modes.includes('sample'), row.id);
    if (row.e2e.real.length > 0 && !['runs', 'compare'].includes(row.route ?? '')) assert.ok(row.modes.includes('real'), row.id);
  }
});

test('every file the matrix names exists, and every spec file is under e2e or tests', () => {
  for (const row of rows) {
    const named = [...(row.screenFiles ?? []), ...row.unit, ...row.e2e.sample, ...row.e2e.real, ...row.e2e.noBridge, ...(row.newSpec ? [row.newSpec] : [])];
    assert.ok(named.length > 0, `${row.id} names something`);
    for (const path of named) assert.ok(existsSync(join(REPO, path)), `${row.id}: ${path} exists`);
    for (const path of [...row.e2e.sample, ...row.e2e.real, ...row.e2e.noBridge]) assert.match(path, /^apps\/desktop\/e2e\/[\w-]+\.spec\.ts$/);
    for (const path of row.unit) assert.match(path, /^apps\/desktop\/tests\/[\w-]+\.test\.ts$/);
  }
});

test('every route has a dedicated e2e spec in each of its modes, or names the spec written for it', () => {
  for (const row of ofKind('route')) {
    for (const mode of row.modes) {
      const key = mode === 'no-bridge' ? 'noBridge' : mode as 'sample' | 'real';
      const specs = row.e2e[key];
      if (mode === 'real' && ['runs', 'compare'].includes(row.route ?? '')) continue;
      assert.ok(specs.length > 0 || row.newSpec, `${row.id}: a spec in ${mode} mode`);
    }
  }
});

test('the five routes that had no spec at the base each name the spec written for them, and it asserts that route', () => {
  const expected: Record<string, string> = { file: 'harness-file', runs: 'harness-runs', interfaces: 'harness-interfaces', history: 'harness-history', help: 'harness-help' };
  for (const row of ofKind('route')) {
    if (row.route! in expected) {
      assert.equal(row.newSpec, `apps/desktop/e2e/${expected[row.route!]}.spec.ts`, row.id);
      assert.match(readFileSync(join(REPO, row.newSpec!), 'utf8'), new RegExp(`#sample/${row.route}`), `${row.id} opens its own address`);
    } else assert.equal(row.newSpec ?? null, null, `${row.id} had a spec at the base`);
  }
});

// ---- the routes of bundled extensions, listed apart from the 15 base routes

const extensionRows = (JSON.parse(readFileSync(join(REPO, 'docs', 'v0.9', 'route-spec-matrix.json'), 'utf8')) as { extensionRoutes?: Row[] }).extensionRoutes ?? [];

test('extensionRoutes lists local-models, owned by the bundled extension of that name and by no base route', () => {
  assert.deepEqual(extensionRows.map(r => r.route), ['local-models']);
  const row = extensionRows[0]!;
  assert.equal(row.targetExtension, 'local-models');
  assert.equal((DEFAULT_IDS as readonly string[]).includes(row.targetExtension!), false);
  assert.equal((BASE_ROUTES as readonly string[]).includes(row.route!), false);
  assert.ok(existsSync(join(DESKTOP, 'extensions', row.targetExtension!, 'manifest.json')));
  assert.equal(rows.some(r => r.route === 'local-models'), false, 'the base rows are unchanged');
});

test('every file an extension route names exists, and it has an e2e spec in each of its modes', () => {
  for (const row of extensionRows) {
    for (const path of [...(row.screenFiles ?? []), ...row.unit, ...row.e2e.sample, ...row.e2e.real, ...row.e2e.noBridge]) assert.ok(existsSync(join(REPO, path)), `${row.id}: ${path}`);
    for (const mode of row.modes) assert.ok(MODES.includes(mode), `${row.id}: ${mode}`);
    for (const mode of row.modes) assert.ok(row.e2e[mode === 'no-bridge' ? 'noBridge' : (mode as 'sample' | 'real')].length > 0, `${row.id}: a spec in ${mode} mode`);
  }
});
