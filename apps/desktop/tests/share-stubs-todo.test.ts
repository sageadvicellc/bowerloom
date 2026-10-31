// A reminder that fails the day the stubs are gone and passes the day they are: the six share calls answer "not built" in main and in the sample bridge until Task 1
// lane C builds main/engine-bundle.ts and lane D builds the sample. Each test is marked `todo`, so it reports but never fails the gates while a stub remains. When the
// lane that owns a stub has built it, that lane removes the `todo` option from its test, so the guard binds from then on. The test does not pin a stub: it asserts there is none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const CALLS = ['planExport', 'runExport', 'chooseBundle', 'planImport', 'runImport', 'discardBundle'];

test('lane C: main/engine-service.ts has no "not built" stub for a share call', { todo: 'Task 1 lane C builds main/engine-bundle.ts, then removes this todo' }, () => {
  const source = read('main/engine-service.ts');
  const left = CALLS.filter(call => new RegExp(`${call}: .*not built`).test(source));
  assert.deepEqual(left, [], 'these calls are still stubs');
  assert.doesNotMatch(source, /'not built'/);
});

test('lane D: shared/engine/sample.ts has no "not built" stub for a share call', { todo: 'Task 1 lane D builds the in-memory sample calls, then removes this todo' }, () => {
  const source = read('shared/engine/sample.ts');
  const left = CALLS.filter(call => new RegExp(`${call}: .*not built`).test(source));
  assert.deepEqual(left, [], 'these calls are still stubs');
  assert.doesNotMatch(source, /'not built'/);
});
