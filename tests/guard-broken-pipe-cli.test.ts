// Track 11 of beta.3, follow-up item 2 (decided: fail closed): when the reader of the guard's output closes early,
// `bowerloom-guard` and the hook form of `bowerloom context guard` exit 2, which blocks the call. They never crash
// with exit 1, which Claude Code treats as a non-blocking error. Through the real binaries.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli } from './support/config-cli.js';
import { GUARD_OUTPUT_LOST_TEXT } from '../apps/cli/src/broken-pipe.js';
import { envFor, guardArgs, guardMain, hookInput, run, sliceProject } from './support/slice-project.js';
import type { SliceProject } from './support/slice-project.js';
import { readLimited } from '../apps/cli/src/guard-run.js';

const LOST = `${GUARD_OUTPUT_LOST_TEXT}\n`;
assert.equal(GUARD_OUTPUT_LOST_TEXT, 'Bowerloom guard: the hook output could not be written, so the call is blocked.');
interface Closed { status: number | null; signal: NodeJS.Signals | null; stderr: string; errors: string[] }
/** PR 102 round 1, item 4: a preload records each stdout and stderr error, so a test proves that the pipe broke. */
const RECORDER = fileURLToPath(new URL('./support/record-stdio-errors.js', import.meta.url));
let records = 0;
/** Runs a guard entry with `input` on stdin and the read end of stdout closed before the child writes a byte. */
function closedStdout(p: SliceProject, entry: string, args: string[], input: string): Promise<Closed> {
  return new Promise((resolve, reject) => {
    const log = join(p.home, `stdio-errors-${++records}.log`);
    const child = spawn(process.execPath, ['--import', RECORDER, entry, ...args], { cwd: p.dir, env: { ...envFor(p.home), TEST_STDIO_LOG: log }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.destroy();
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (d: string) => { stderr += d; });
    child.stdin.on('error', () => { /* the child may exit before it reads stdin */ });
    child.stdin.end(input);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the guard did not exit')); }, 60000);
    child.on('error', reject);
    child.on('close', (status, signal) => { clearTimeout(timer); let errors: string[] = []; try { errors = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { /* none recorded */ } resolve({ status, signal, stderr, errors }); });
  });
}
const forms = (p: SliceProject): [string, string, string[]][] => [['bowerloom-guard', guardMain, guardArgs(p)], ['bowerloom context guard', cli, ['context', 'guard', ...guardArgs(p)]]];

test('a deny whose reader closed early exits 2 with the reason on stderr and no stack, in both guard forms', async t => {
  const p = sliceProject(t), input = hookInput('Read', { file_path: join(p.dir, 'wiki/secret.txt') }, p.dir);
  for (const [name, entry, args] of forms(p)) {
    const open = run(p.dir, args, p.home, { input }, entry);
    assert.equal(open.status, 0, name); assert.match(open.stdout, /"permissionDecision":"deny"/, name);
    const closed = await closedStdout(p, entry, args, input);
    assert.equal(closed.signal, null, name); assert.equal(closed.status, 2, `${name}: ${closed.stderr}`);
    assert.ok(closed.errors.length >= 1 && closed.errors.includes('stdout EPIPE'), `${name}: the pipe broke (${closed.errors.join(', ')})`);
    assert.doesNotMatch(closed.stderr, /EPIPE|Unhandled 'error' event|node:events|\n\s+at /, name);
    assert.equal(closed.stderr, LOST, name);
  }
});

test('an allowed call writes nothing, so a closed reader changes nothing: exit 0 in both guard forms', async t => {
  const p = sliceProject(t), input = hookInput('Read', { file_path: join(p.dir, 'wiki/a.md') }, p.dir);
  for (const [name, entry, args] of forms(p)) {
    const closed = await closedStdout(p, entry, args, input);
    assert.equal(closed.status, 0, `${name}: ${closed.stderr}`); assert.equal(closed.stderr, '', name); assert.deepEqual(closed.errors, [], name);
  }
});

// PR 102 rounds 1 and 2, item 5: a stdin that fails after the read timed out. readLimited returns null at the timeout,
// and the late failure leaves no unhandled rejection, which would crash with exit 1. Promise.race already handles that
// rejection, so this test passes with or without the safeguard line in guard-run.ts; it pins the behaviour.
test('readLimited returns null on timeout, and a stdin that fails later leaves no unhandled rejection', async () => {
  const unhandled: unknown[] = [], seen = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', seen);
  try {
    const late: AsyncIterable<unknown> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise((_, reject) => setTimeout(() => reject(new Error('stdin failed late')), 60)) }) };
    assert.equal(await readLimited(late, 1024, 20), null);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.deepEqual(unhandled, []);
  } finally { process.removeListener('unhandledRejection', seen); }
});
