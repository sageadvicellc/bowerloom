// A current-format receipt reads back whether or not a source carries `claimed`. `claimed`, when present, must be true.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyPortable, applyPortableRemoval, planPortable, planPortableRemoval, portableDrift, readPortableReceipt,
} from '../../../dist/packages/project-sync/src/index.js';
import { revisionOf } from '../../../dist/packages/project-sync/src/portable-files.js';
import { json, project, snapshot } from './portable-fixture.mjs';

const SOURCE = { name: 'review-kit', marketplace: 'example-market', version: '1.2.0', items: [{ part: 'skills', id: 'review' }] };
const withSources = (t, source = SOURCE) => project(t, { parts: { plugins: 'sources.json' }, files: { 'sources.json': json({ sources: [source] }) } });
const REF = { skill: 'review', name: 'review-kit', marketplace: 'example-market', version: '1.2.0' };

test('an install of a harness with an unclaimed source writes a receipt that read, drift, a second plan, and remove all read', async t => {
  const p = withSources(t);
  const before = snapshot(p.dir);
  const plan = planPortable(p.input());
  await applyPortable(p.input(), plan.revision);
  assert.deepEqual(readPortableReceipt(p.input()).sources, [REF], 'the receipt reads, with no claimed key');
  assert.deepEqual(portableDrift(p.input()), []);
  assert.equal(planPortable(p.input()).noop, true, 'a second plan is a no-op');
  const removal = planPortableRemoval(p.input());
  await applyPortableRemoval(p.input(), removal.revision);
  assert.deepEqual(snapshot(p.dir), before);
  assert.equal(readPortableReceipt(p.input()), null);
});

test('a claimed source reads back with claimed: true', async t => {
  const p = withSources(t, { ...SOURCE, claimed: true });
  await applyPortable(p.input(), planPortable(p.input()).revision);
  assert.deepEqual(readPortableReceipt(p.input()).sources, [{ ...REF, claimed: true }]);
  assert.equal(planPortable(p.input()).noop, true);
});

test('the parser: claimed may be absent or true, never anything else, and no other key is allowed', async t => {
  const p = withSources(t);
  await applyPortable(p.input(), planPortable(p.input()).revision);
  const file = path.join(p.stateDir, 'receipt.json');
  const { revision: _r, ...body } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = source => { const next = { ...body, sources: [source] }; fs.writeFileSync(file, JSON.stringify({ ...next, revision: revisionOf(next) }, null, 2) + '\n', { mode: 0o600 }); };
  write(REF); assert.deepEqual(readPortableReceipt(p.input()).sources, [REF]);
  write({ ...REF, claimed: true }); assert.deepEqual(readPortableReceipt(p.input()).sources, [{ ...REF, claimed: true }]);
  for (const bad of [{ ...REF, claimed: false }, { ...REF, claimed: 'yes' }, { ...REF, claimed: null }, { ...REF, extra: 1 }, { skill: 'review', name: 'review-kit', marketplace: 'example-market' }]) {
    write(bad);
    assert.throws(() => readPortableReceipt(p.input()), e => e.code === 'PORTABLE_STATE_INVALID', JSON.stringify(bad));
  }
});
