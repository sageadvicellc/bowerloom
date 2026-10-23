// Track 11 of beta.3, item 1, through the real binary: a reader that closes early, as `bowerloom use ... | head -1`
// does, never crashes a command with an unhandled EPIPE. The command finishes its work, prints no stack, and exits with
// the status it has when the reader stays.
import './support/isolate-home.js';
import test from './support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { quietBrokenPipe, readerGone } from '../apps/cli/src/broken-pipe.js';
import { join } from 'node:path';
import { world, run, mustApprove, baseEnv, cli, project, EMPTY_CONFIG } from './support/config-cli.js';
import type { World } from './support/config-cli.js';

interface Closed { status: number | null; signal: NodeJS.Signals | null; stderr: string; stdout: string; errors: string[] }
/** PR 102 round 1, item 4: a preload records each stdout and stderr error, so a test proves that the pipe broke. */
const RECORDER = fileURLToPath(new URL('./support/record-stdio-errors.js', import.meta.url));
let records = 0;
/**
 * Runs the CLI with the read end of stdout (or stderr) closed before the child writes a byte. Node starts in tens of
 * milliseconds, and the pipe closes at once after the spawn, so every write of the child meets a reader that is gone.
 */
function closedReader(cwd: string, args: string[], env: Record<string, string>, close: 'stdout' | 'stderr' = 'stdout'): Promise<Closed> {
  return new Promise((resolve, reject) => {
    const log = join(env.HOME!, '..', `stdio-errors-${process.pid}-${++records}.log`);
    const child = spawn(process.execPath, ['--import', RECORDER, cli, ...args], { cwd, env: { ...baseEnv(), ...env, TEST_STDIO_LOG: log }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', stdout = '';
    child[close].destroy();
    const other = close === 'stdout' ? child.stderr : child.stdout;
    other.setEncoding('utf8'); other.on('data', (d: string) => { if (close === 'stdout') stderr += d; else stdout += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${args.join(' ')} did not exit`)); }, 60000);
    child.on('error', reject);
    child.on('close', (status, signal) => { clearTimeout(timer); let errors: string[] = []; try { errors = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch { /* no error was recorded */ } resolve({ status, signal, stderr, stdout, errors }); });
  });
}
const noCrash = (r: Closed, what: string, stream: 'stdout' | 'stderr' = 'stdout'): void => {
  assert.equal(r.signal, null, what);
  assert.ok(r.errors.includes(`${stream} EPIPE`), `${what}: the pipe did not break (${r.errors.join(', ')})`);
  assert.doesNotMatch(r.stderr, /EPIPE|Unhandled 'error' event|node:events|\n\s+at /, `${what}: ${r.stderr}`);
  assert.doesNotMatch(r.stdout, /EPIPE|Unhandled 'error' event|node:events|\n\s+at /, `${what}: ${r.stdout}`);
};
/** A project with bowerloom.json that lists the store skill house-style, and a store that holds it. */
function picked(t: Parameters<typeof world>[0]): { w: World; dir: string } {
  const w = world(t), dir = project(w, 'app', EMPTY_CONFIG);
  mustApprove(w.home, ['skill', 'create', 'house-style', '--global'], w.env);
  mustApprove(w.home, ['skill', 'create', 'tone', '--global'], w.env);
  mustApprove(dir, ['use', 'skill', 'house-style'], w.env);
  return { w, dir };
}

test('use and unuse plans: a reader that closes early gets no crash, and the status is the plan status, 3', async t => {
  const { w, dir } = picked(t);
  for (const args of [['use', 'skill', 'tone'], ['unuse', 'skill', 'house-style'], ['use', 'skill', 'tone', '--json']]) {
    const open = run(dir, args, w.env);
    assert.equal(open.status, 3, open.stderr); assert.ok(open.stdout.length > 0);
    const closed = await closedReader(dir, args, w.env);
    noCrash(closed, args.join(' ')); assert.equal(closed.stderr, '', args.join(' ')); assert.equal(closed.status, 3, args.join(' '));
  }
});

test('use with --approve: a reader that closes early still gets the change applied, and the status is 0', async t => {
  const { w, dir } = picked(t);
  const planned = run(dir, ['use', 'skill', 'tone', '--json'], w.env), revision = (JSON.parse(planned.stdout) as { revision: string }).revision;
  const closed = await closedReader(dir, ['use', 'skill', 'tone', '--approve', revision], w.env);
  noCrash(closed, 'use --approve'); assert.equal(closed.stderr, ''); assert.equal(closed.status, 0);
  assert.deepEqual((JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')) as { skills: unknown[] }).skills, [{ id: 'house-style', source: 'store' }, { id: 'tone', source: 'store' }]);
  const unplanned = run(dir, ['unuse', 'skill', 'tone', '--json'], w.env), unrevision = (JSON.parse(unplanned.stdout) as { revision: string }).revision;
  const unclosed = await closedReader(dir, ['unuse', 'skill', 'tone', '--approve', unrevision], w.env);
  noCrash(unclosed, 'unuse --approve'); assert.equal(unclosed.status, 0);
  assert.deepEqual((JSON.parse(readFileSync(join(dir, 'bowerloom.json'), 'utf8')) as { skills: unknown[] }).skills, [{ id: 'house-style', source: 'store' }]);
});

test('commands that print long output: help advanced, ls, store status, and skills sync exit quietly with their own status', async t => {
  const { w, dir } = picked(t);
  const help = run(dir, ['help', 'advanced'], w.env);
  assert.equal(help.status, 0); assert.ok(help.stdout.length > 8000, 'help advanced prints more than a few lines');
  for (const args of [['help', 'advanced'], ['help'], ['ls'], ['store', 'status'], ['skills', 'sync'], ['--version']]) {
    const open = run(dir, args, w.env), closed = await closedReader(dir, args, w.env);
    assert.ok(open.stdout.length > 0, args.join(' '));
    noCrash(closed, args.join(' ')); assert.equal(closed.stderr, '', args.join(' ')); assert.equal(closed.status, open.status, args.join(' '));
  }
});

test('a refusal whose stderr reader closes early exits with the refusal status and no crash', async t => {
  const { w, dir } = picked(t);
  // A usage refusal exits 2, and a crash exits 1, so the status tells them apart while stderr cannot be read.
  for (const [args, status, code] of [[['use', 'skill'], 2, 'USAGE'], [['use', 'skill', 'missing-skill'], 1, 'STORE_ITEM_NOT_FOUND']] as const) {
    const open = run(dir, [...args], w.env);
    assert.equal(open.status, status); assert.match(open.stderr, new RegExp(code));
    const closed = await closedReader(dir, [...args], w.env, 'stderr');
    noCrash(closed, args.join(' '), 'stderr'); assert.equal(closed.stdout, ''); assert.equal(closed.status, status, args.join(' '));
  }
});

// PR 102 round 1, item 4: quietBrokenPipe drops only the errors of a reader that has gone, and throws any other.
test('quietBrokenPipe: EPIPE and ERR_STREAM_DESTROYED end the output quietly; EIO and an error with no code throw', () => {
  const stream = new EventEmitter(); quietBrokenPipe(stream as unknown as NodeJS.WritableStream);
  const fail = (code?: string): Error => Object.assign(new Error(code ?? 'no code'), code ? { code } : {});
  assert.doesNotThrow(() => stream.emit('error', fail('EPIPE')));
  assert.doesNotThrow(() => stream.emit('error', fail('ERR_STREAM_DESTROYED')));
  assert.throws(() => stream.emit('error', fail('EIO')), (e: { code?: string }) => e.code === 'EIO');
  assert.throws(() => stream.emit('error', fail()), /no code/);
  assert.equal(readerGone(fail('EPIPE')), true); assert.equal(readerGone(fail('EIO')), false); assert.equal(readerGone(null), false);
});

test('the release notes say that with stderr closed a refusal keeps its status but loses its text (PR 102 round 1, item 7)', () => {
  const notes = readFileSync(new URL('../../apps/docs/src/content/docs/releases.md', import.meta.url), 'utf8');
  assert.ok(notes.includes('With stderr closed, a refusal keeps its exit status, but its text is lost.'));
});
