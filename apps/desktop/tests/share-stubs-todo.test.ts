// A guard for the share stubs: the six share calls answered "not built" in main and in the sample bridge until Task 1 lane C built main/engine-bundle.ts and lane D built the
// sample. Lane D built the sample, so its test binds now. Lane C's test stays marked `todo` (it reports but never fails the gates) until lane C removes the `todo` option.
// The tests do not pin a stub: they assert there is none.
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

test('lane D: shared/engine/sample.ts has no "not built" stub for a share call', () => {
  const source = read('shared/engine/sample.ts');
  const left = CALLS.filter(call => new RegExp(`${call}: .*not built`).test(source));
  assert.deepEqual(left, [], 'these calls are still stubs');
  assert.doesNotMatch(source, /'not built'/);
});
