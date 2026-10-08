// A probe, not a suite file: npm test never lists it (its name does not end in .test.mjs). It is a test that never
// finishes while a live interval keeps the event loop busy. tools/test/force-exit.test.mjs runs it on purpose, to prove
// that --test-force-exit ends such a run as a failure and that --test-timeout alone does not (review M6 finding 1).
import test from 'node:test';
setInterval(() => {}, 1000);
test('stuck with a live handle', async () => { await new Promise(() => {}); });
