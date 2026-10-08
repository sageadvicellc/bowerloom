// A probe, not a suite file: npm test never lists it (its name does not end in .test.mjs). It is a test that never
// finishes while a live interval keeps the event loop busy, so --test-timeout alone does not end the run.
// tools/test/run-node-tests.test.mjs runs it on purpose, through tools/run-node-tests.mjs with a short wall-clock
// limit, to prove that such a run fails at the limit instead of hanging (review M6 finding 1). When
// BOWERLOOM_PROBE_PID_FILE is set, the probe writes its own pid and its node --test parent's pid there.
import fs from 'node:fs';
import test from 'node:test';
if (process.env.BOWERLOOM_PROBE_PID_FILE) fs.writeFileSync(process.env.BOWERLOOM_PROBE_PID_FILE, `${process.pid} ${process.ppid}\n`);
setInterval(() => {}, 1000);
test('stuck with a live handle', async () => { await new Promise(() => {}); });
