// A guard for the six share calls: none answers "not built" in main or in the sample bridge. tools/check-not-built.mjs holds the same files for the release gate; these tests
// name the calls. They do not pin a stub: they assert there is none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DESKTOP } from './support.js';

const read = (file: string): string => readFileSync(join(DESKTOP, file), 'utf8');
const CALLS = ['planExport', 'runExport', 'chooseBundle', 'planImport', 'runImport', 'discardBundle'];

test('main/engine-service.ts has no "not built" stub for a share call', () => {
  const source = read('main/engine-service.ts');
  const left = CALLS.filter(call => new RegExp(`${call}: .*not built`).test(source));
  assert.deepEqual(left, [], 'these calls are still stubs');
  assert.doesNotMatch(source, /'not built'/);
});

test('shared/engine/sample.ts has no "not built" stub for a share call', () => {
  const source = read('shared/engine/sample.ts');
  const left = CALLS.filter(call => new RegExp(`${call}: .*not built`).test(source));
  assert.deepEqual(left, [], 'these calls are still stubs');
  assert.doesNotMatch(source, /'not built'/);
});
