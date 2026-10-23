// Track 11 of beta.3, follow-up item 2 (decided: fail closed): when the reader of the guard's output closes early,
// `bowerloom-guard` and the hook form of `bowerloom context guard` exit 2, which blocks the call. They never crash
// with exit 1, which Claude Code treats as a non-blocking error. Through the real binaries.
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { cli } from './support/config-cli.js';
import { GUARD_OUTPUT_LOST_TEXT } from '../apps/cli/src/broken-pipe.js';
import { envFor, guardArgs, guardMain, hookInput, run, sliceProject } from './support/slice-project.js';
import type { SliceProject } from './support/slice-project.js';

const LOST = `${GUARD_OUTPUT_LOST_TEXT}\n`;
assert.equal(GUARD_OUTPUT_LOST_TEXT, 'Bowerloom guard: the hook output could not be written, so the call is blocked.');
interface Closed { status: number | null; signal: NodeJS.Signals | null; stderr: string }
/** Runs a guard entry with `input` on stdin and the read end of stdout closed before the child writes a byte. */
function closedStdout(p: SliceProject, entry: string, args: string[], input: string): Promise<Closed> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: p.dir, env: envFor(p.home), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stdout.destroy();
    child.stderr.setEncoding('utf8'); child.stderr.on('data', (d: string) => { stderr += d; });
    child.stdin.on('error', () => { /* the child may exit before it reads stdin */ });
    child.stdin.end(input);
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('the guard did not exit')); }, 60000);
    child.on('error', reject);
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stderr }); });
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
    assert.doesNotMatch(closed.stderr, /EPIPE|Unhandled 'error' event|node:events|\n\s+at /, name);
    assert.equal(closed.stderr, LOST, name);
  }
});

test('an allowed call writes nothing, so a closed reader changes nothing: exit 0 in both guard forms', async t => {
  const p = sliceProject(t), input = hookInput('Read', { file_path: join(p.dir, 'wiki/a.md') }, p.dir);
  for (const [name, entry, args] of forms(p)) {
    const closed = await closedStdout(p, entry, args, input);
    assert.equal(closed.status, 0, `${name}: ${closed.stderr}`); assert.equal(closed.stderr, '', name);
  }
});
