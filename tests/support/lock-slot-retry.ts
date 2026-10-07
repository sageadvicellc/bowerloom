// The `test` of every test file that takes a project lock. Not a test file: npm test runs dist/tests/*.test.js only.
//
// A project lock is a local port picked from the project folder's key. Test runs make thousands of fresh folders,
// and node runs test files in parallel, so now and then a fresh folder's port is held by another file's lock or by a
// long-lived program on this machine. The product refuses that with LOCK_SLOT_COLLISION and changes nothing. That is
// a fact about the machine, not about the code under test, so a test that meets one runs again from the start, which
// makes fresh folders and so fresh ports. Nothing else is retried: any other failure is reported at once.
import nodeTest from 'node:test';
import type { TestContext, TestOptions } from 'node:test';
import { syncBuiltinESMExports } from 'node:module';

/** Runs of one test before a collision is reported as a failure. */
export const ATTEMPTS = 5;
const PATTERN = /LOCK_SLOT_COLLISION/;

/** True when an error, or the error an assertion wraps, names a lock slot collision (a child process prints the code). */
export function namesSlotCollision(value: unknown, depth = 0): boolean {
  if (depth > 4 || value === null || value === undefined) return false;
  if (typeof value === 'string') return PATTERN.test(value);
  if (typeof value !== 'object') return false;
  const v = value as { code?: unknown; message?: unknown; actual?: unknown; cause?: unknown; errors?: unknown };
  if ([v.code, v.message].some(x => typeof x === 'string' && PATTERN.test(x))) return true;
  return namesSlotCollision(v.actual, depth + 1) || namesSlotCollision(v.cause, depth + 1) || (Array.isArray(v.errors) && v.errors.some(e => namesSlotCollision(e, depth + 1)));
}

type Body = (t: TestContext) => unknown;
/**
 * Runs `run` and runs it again from the start, up to ATTEMPTS runs, only while the error it throws names a lock slot
 * collision (namesSlotCollision). A collision met during a run that then fails for another reason is not retried, so
 * a flaky real failure cannot pass on a later run.
 */
export async function retrying(t: TestContext, run: Body): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try { await run(t); return; }
    catch (error) {
      if (attempt >= ATTEMPTS || !namesSlotCollision(error)) throw error;
      t.mock.restoreAll(); syncBuiltinESMExports();
      t.diagnostic(`attempt ${attempt} met a lock slot collision on this machine; running again with fresh folders`);
    }
  }
}
/** `node:test`'s `test(name, [options], body)`, run again from the start after a lock slot collision. */
export default function test(name: string, options: TestOptions | Body, body?: Body): Promise<void> {
  const run = (typeof options === 'function' ? options : body)!, opts = typeof options === 'function' ? {} : options;
  return nodeTest(name, opts, t => retrying(t, run));
}
