import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, symlinkSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventLogOff, eventLogPath, readEvents, recordEvent } from '../../../dist/packages/diagnostics/src/index.js';
import { PLAN, at, stateRoot } from './fixture.mjs';

const opts = (root, env = {}, now = at()) => ({ stateRoot: root, env, now });
const lines = root => readFileSync(eventLogPath(root), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('a valid event is written as one JSON line with the allowlisted fields, in 0700 and 0600 modes', t => {
  const root = stateRoot(t);
  const r = recordEvent(opts(root), { source: 'cli', kind: 'scenario', scenario: 'S1', outcome: 'done', step: 'adopt', engines: ['claude-code', 'codex'], plan: PLAN });
  assert.deepEqual(r, { ok: true, written: true });
  assert.deepEqual(lines(root), [{ v: 1, at: '2026-10-30T14:00:00Z', source: 'cli', kind: 'scenario', scenario: 'S1', outcome: 'done', step: 'adopt', engines: ['claude-code', 'codex'], plan: PLAN }]);
  assert.equal(lstatSync(join(root, 'events')).mode & 0o777, 0o700);
  assert.equal(lstatSync(eventLogPath(root)).mode & 0o777, 0o600);
});

test('a field that fails validation is dropped and the event is still written', t => {
  const root = stateRoot(t);
  recordEvent(opts(root), {
    source: 'cli', kind: 'error', scenario: 'S9', outcome: 'maybe', code: 'lower_case', step: 'Not A Step', engines: ['codex', 'vim'], plan: 'xyz',
    answer: 'perhaps', note: 'not a check', extra: '/home/test-person/secret', targetRoot: 'relative/path',
  });
  assert.deepEqual(lines(root), [{ v: 1, at: '2026-10-30T14:00:00Z', source: 'cli', kind: 'error' }]);
  recordEvent(opts(root), { source: 'app', kind: 'error', code: 'IO_ERROR', engines: 'codex', plan: `sha256:${PLAN}`, step: 'adopt' });
  assert.deepEqual(lines(root)[1], { v: 1, at: '2026-10-30T14:00:00Z', source: 'app', kind: 'error', code: 'IO_ERROR', step: 'adopt', plan: `sha256:${PLAN}` });
});

test('an event with no valid source or kind is refused and nothing is written', t => {
  const root = stateRoot(t);
  assert.deepEqual(recordEvent(opts(root), { source: 'web', kind: 'scenario' }), { ok: false, code: 'EVENT_INVALID' });
  assert.deepEqual(recordEvent(opts(root), null), { ok: false, code: 'EVENT_INVALID' });
  assert.equal(existsSync(eventLogPath(root)), false);
});

test('BOWERLOOM_EVENT_LOG=off makes a write a no-op, and reading still works', t => {
  const root = stateRoot(t);
  recordEvent(opts(root), { source: 'cli', kind: 'check', answer: 'yes' });
  assert.deepEqual(recordEvent(opts(root, { BOWERLOOM_EVENT_LOG: 'off' }), { source: 'cli', kind: 'check', answer: 'no' }), { ok: true, written: false });
  assert.equal(readEvents(root).events.length, 1);
  assert.equal(recordEvent(opts(stateRoot(t), { BOWERLOOM_EVENT_LOG: 'off' }), { source: 'cli', kind: 'check' }).written, false);
});

test('check events keep an answer and a cleaned note of at most 500 characters; other kinds drop the note', t => {
  const root = stateRoot(t);
  recordEvent(opts(root), { source: 'app', kind: 'check', answer: 'partly', note: `  want\u0000 a\u202e\u200b team\nfile\u2028x ${'z'.repeat(600)}` });
  const [e] = lines(root);
  assert.equal(e.answer, 'partly');
  assert.ok(e.note.length <= 500);
  assert.doesNotMatch(e.note, /[\u0000-\u001f\u007f-\u009f\u200b\u202e\u2028]/);
  assert.match(e.note, /^want a team file x z+/);
  recordEvent(opts(root), { source: 'app', kind: 'check', answer: 'no', note: '   ' });
  assert.equal('note' in lines(root)[1], false);
});

test('the target id is the first 16 hex of an HMAC with a local salt, stable per root and different between roots', t => {
  const root = stateRoot(t);
  for (const dir of ['/home/test-person/a', '/home/test-person/a', '/home/test-person/b']) {
    recordEvent(opts(root), { source: 'cli', kind: 'scenario', scenario: 'S2', outcome: 'done', step: 'install', targetRoot: dir });
  }
  const [x, y, z] = lines(root).map(e => e.target);
  assert.match(x, /^[0-9a-f]{16}$/);
  assert.equal(x, y);
  assert.notEqual(x, z);
  const salt = join(root, 'events', 'salt');
  assert.equal(readFileSync(salt).length, 32);
  assert.equal(lstatSync(salt).mode & 0o777, 0o600);
  // Another state root has another salt, so the same folder gets another id.
  const other = stateRoot(t);
  recordEvent(opts(other), { source: 'cli', kind: 'scenario', step: 'install', targetRoot: '/home/test-person/a' });
  assert.notEqual(lines(other)[0].target, x);
});

test('the log keeps its newest 2,000 lines once it passes 1 MiB, and the rewrite leaves no temp file', t => {
  const root = stateRoot(t);
  recordEvent(opts(root), { source: 'cli', kind: 'check', answer: 'yes' });
  const pad = JSON.stringify({ v: 1, at: '2026-10-29T00:00:00Z', source: 'cli', kind: 'check', answer: 'no', note: 'p'.repeat(400) });
  const body = Array.from({ length: 3000 }, (_, i) => pad.replace('2026-10-29', `2026-09-${String(i % 28 + 1).padStart(2, '0')}`)).join('\n');
  writeFileSync(eventLogPath(root), `${body}\n`, { mode: 0o600 });
  assert.ok(readFileSync(eventLogPath(root)).length > 1024 * 1024);
  recordEvent(opts(root), { source: 'cli', kind: 'error', code: 'LATEST_ONE' });
  const kept = lines(root);
  assert.equal(kept.length, 2000);
  assert.equal(kept.at(-1).code, 'LATEST_ONE');
  assert.equal(lstatSync(eventLogPath(root)).mode & 0o777, 0o600);
  assert.deepEqual(readFileSync(eventLogPath(root), 'utf8').endsWith('\n'), true);
  assert.deepEqual(readdirSync(join(root, 'events')), ['events.jsonl']);
});

test('a write failure returns a code and never throws', t => {
  const root = stateRoot(t);
  mkdirSync(join(root, 'events'), { recursive: true });
  mkdirSync(eventLogPath(root));
  const r = recordEvent(opts(root), { source: 'cli', kind: 'check', answer: 'yes' });
  assert.equal(r.ok, false);
  assert.match(r.code, /^[A-Z][A-Z0-9_]{2,63}$/);
  // A state root that is a file cannot hold a folder.
  const file = join(stateRoot(t), '..', 'plain-file');
  writeFileSync(file, 'x');
  const r2 = recordEvent(opts(file), { source: 'cli', kind: 'check' });
  assert.equal(r2.ok, false);
  // A read-only folder fails the same way.
  const root3 = stateRoot(t);
  recordEvent(opts(root3), { source: 'cli', kind: 'check' });
  chmodSync(join(root3, 'events'), 0o500);
  try { assert.doesNotThrow(() => recordEvent(opts(root3), { source: 'cli', kind: 'check' })); } finally { chmodSync(join(root3, 'events'), 0o700); }
});

test('readEvents returns valid events, drops bad fields, and counts malformed lines', t => {
  const root = stateRoot(t);
  assert.deepEqual(readEvents(root), { events: [], malformed: 0 });
  recordEvent(opts(root), { source: 'cli', kind: 'error', code: 'USAGE' });
  appendFileSync(eventLogPath(root), [
    'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    '{"v":2,"at":"2026-10-30T14:00:00Z","source":"cli","kind":"error"}',
    '{"v":1,"at":"yesterday","source":"cli","kind":"error"}',
    '[1,2]',
    '{"v":1,"at":"2026-10-30T14:00:01Z","source":"app","kind":"scenario","scenario":"S5","outcome":"done","code":"bad code","note":"x","evil":"/home/test-person"}',
    '',
  ].join('\n'));
  const { events, malformed } = readEvents(root);
  assert.equal(malformed, 4);
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], { v: 1, at: '2026-10-30T14:00:01Z', source: 'app', kind: 'scenario', scenario: 'S5', outcome: 'done' });
});

test('notes are redacted when recorded: a planted home path and token never reach the log', t => {
  const root = stateRoot(t);
  recordEvent({ ...opts(root), home: ['/home/test-person'] }, { source: 'app', kind: 'check', answer: 'no', note: `I ran /home/test-person/x with ghp_${'Q1w2E3r4T5'.repeat(4)} and /Users/someone/y` });
  const text = readFileSync(eventLogPath(root), 'utf8');
  assert.equal(/test-person|someone|ghp_/.test(text), false);
  assert.equal(lines(root)[0].note, 'I ran ~/x with [redacted] and ~/y');
});

test('off accepts off, 0, false and no in any letter case', () => {
  for (const v of ['off', 'OFF', '0', 'false', 'No', ' off ']) assert.equal(eventLogOff({ BOWERLOOM_EVENT_LOG: v }), true, v);
  for (const v of [undefined, '', 'on', '1', 'yes']) assert.equal(eventLogOff({ BOWERLOOM_EVENT_LOG: v }), false, String(v));
});

test('an events folder that is a symbolic link is refused and nothing is written through it', t => {
  const root = stateRoot(t), elsewhere = stateRoot(t);
  mkdirSync(root, { recursive: true }); mkdirSync(elsewhere, { recursive: true });
  symlinkSync(elsewhere, join(root, 'events'));
  const r = recordEvent(opts(root), { source: 'cli', kind: 'check' });
  assert.deepEqual(r, { ok: false, code: 'EVENT_DIR_NOT_FOLDER' });
  assert.equal(existsSync(join(elsewhere, 'events.jsonl')), false);
});

test('a damaged salt is replaced with a notice; a salt that is a link is refused; the salt mode is fixed on read', t => {
  const root = stateRoot(t), salt = join(root, 'events', 'salt');
  recordEvent(opts(root), { source: 'cli', kind: 'check', targetRoot: '/home/test-person/a' });
  chmodSync(salt, 0o644);
  recordEvent(opts(root), { source: 'cli', kind: 'check', targetRoot: '/home/test-person/a' });
  assert.equal(lstatSync(salt).mode & 0o777, 0o600);
  writeFileSync(salt, 'short', { mode: 0o600 });
  const r = recordEvent(opts(root), { source: 'cli', kind: 'check', targetRoot: '/home/test-person/a' });
  assert.equal(r.ok, true); assert.match(r.notice, /count of repositories restarts/);
  assert.equal(readFileSync(salt).length, 32);
  const other = stateRoot(t);
  recordEvent(opts(other), { source: 'cli', kind: 'check' });
  symlinkSync(salt, join(other, 'events', 'salt'));
  assert.equal(recordEvent(opts(other), { source: 'cli', kind: 'check', targetRoot: '/home/test-person/a' }).ok, false);
});

test('readEvents: a log that cannot be read sets readError, a missing log does not, and only the newest 4 MiB is read', t => {
  const root = stateRoot(t);
  assert.equal('readError' in readEvents(root), false);
  mkdirSync(eventLogPath(root), { recursive: true });
  assert.match(readEvents(root).readError, /^[A-Z]+$/);
  const big = stateRoot(t);
  mkdirSync(join(big, 'events'), { recursive: true });
  const row = JSON.stringify({ v: 1, at: '2026-10-30T10:00:00Z', source: 'cli', kind: 'error', code: 'BULK_ROW', note: 'x' });
  writeFileSync(eventLogPath(big), `${`${row}\n`.repeat(Math.ceil((5 * 1024 * 1024) / (row.length + 1)))}`);
  const { events, malformed } = readEvents(big);
  assert.equal(malformed, 0, 'the partial first line is dropped, not counted');
  assert.ok(events.length * (row.length + 1) <= 4 * 1024 * 1024 && events.length > 3 * 1024 * 1024 / (row.length + 1));
});
