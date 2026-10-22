// Spec 08, 4.4: writeReceiptRecord, the one writer of an authoring receipt. It writes a temporary record named for the
// plan, runs live(), checks that the receipt still has the hash the plan read, then links (a new receipt) or renames (an
// existing one). It parses its own text first, and leaves no temporary file behind.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import '../../../dist/tests/support/isolate-home.js';
import { writeReceiptRecord } from '../../../dist/packages/project-authoring/src/index.js';
import { readAuthoringState, receiptOf, recordText, tempName } from '../../../dist/packages/project-authoring/src/state.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const code = expected => error => { assert.equal(error?.code, expected, error?.stack); return true; };
const REV = 'a'.repeat(64), REV2 = 'b'.repeat(64);
const item = (kind, id, text = `# ${id}\n`) => ({ kind, id, teams: [], files: [{ path: kind === 'prompt' ? `prompts/${id}.md` : `${kind}s/${id}/SKILL.md`, sha256: sha(text), bytes: Buffer.byteLength(text) }], planRevision: REV });

function folder(t) {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-receipt-write-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const bowerloom = join(base, '.bowerloom'), auth = join(bowerloom, 'authoring');
  fs.mkdirSync(auth, { recursive: true, mode: 0o700 });
  const readNow = () => readAuthoringState(bowerloom).receipt?.read ?? null;
  return { bowerloom, auth, readNow, names: () => fs.readdirSync(auth).sort() };
}
/** Replaces one fs call for the length of `work`, recording its calls. */
function spy(name, work) {
  const original = fs[name], calls = [];
  fs[name] = (...args) => { calls.push(args); return original(...args); };
  try { return { result: work(), calls }; } finally { fs[name] = original; }
}

test('1. a new receipt is made with link; an existing one is replaced with rename; the Read of the new bytes is returned', t => {
  const f = folder(t), first = [item('prompt', 'brief')];
  const made = spy('linkSync', () => spy('renameSync', () => writeReceiptRecord(f.auth, REV, null, first, () => {}, f.readNow)));
  assert.equal(made.calls.length, 1, 'link for a new receipt'); assert.equal(made.result.calls.length, 0, 'no rename');
  const text = recordText(receiptOf(first));
  assert.deepEqual(made.result.result, { sha256: sha(text), bytes: Buffer.byteLength(text) });
  assert.equal(fs.readFileSync(join(f.auth, 'receipt.json'), 'utf8'), text);
  assert.deepEqual(f.names(), ['receipt.json']);
  const before = f.readNow(), second = [...first, item('skill', 'notes')];
  const replaced = spy('linkSync', () => spy('renameSync', () => writeReceiptRecord(f.auth, REV2, before, second, () => {}, f.readNow)));
  assert.equal(replaced.calls.length, 0, 'no link'); assert.equal(replaced.result.calls.length, 1, 'rename over the existing receipt');
  assert.equal(fs.readFileSync(join(f.auth, 'receipt.json'), 'utf8'), recordText(receiptOf(second)));
  assert.deepEqual(f.names(), ['receipt.json']);
  // An empty list is a valid receipt: receipt clean may remove every item.
  const empty = writeReceiptRecord(f.auth, REV, f.readNow(), [], () => {}, f.readNow);
  assert.equal(empty.sha256, sha(recordText(receiptOf([]))));
});

test('2. a receipt whose hash changed after the plan, or one that appeared, refuses STALE_APPROVAL and is left as it is', t => {
  const f = folder(t);
  writeReceiptRecord(f.auth, REV, null, [item('prompt', 'brief')], () => {}, f.readNow);
  const planned = f.readNow();
  fs.writeFileSync(join(f.auth, 'receipt.json'), recordText(receiptOf([item('prompt', 'other')])));
  const edited = fs.readFileSync(join(f.auth, 'receipt.json'));
  assert.throws(() => writeReceiptRecord(f.auth, REV2, planned, [item('prompt', 'brief'), item('prompt', 'more')], () => {}, f.readNow), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(join(f.auth, 'receipt.json')), edited);
  // The plan saw no receipt, and one is there now: the link finds the name taken.
  assert.throws(() => writeReceiptRecord(f.auth, REV2, null, [item('prompt', 'more')], () => {}, () => null), code('STALE_APPROVAL'));
  assert.deepEqual(fs.readFileSync(join(f.auth, 'receipt.json')), edited);
  assert.deepEqual(f.names(), ['receipt.json']);
});

test('3. no temporary file stays: after a write, after live() throws, after a stale check, and after an invalid record', t => {
  const f = folder(t), temp = join(f.auth, tempName(REV, 'receipt'));
  writeReceiptRecord(f.auth, REV, null, [item('prompt', 'brief')], () => {}, f.readNow);
  assert.equal(fs.existsSync(temp), false);
  const before = f.readNow(), bytes = fs.readFileSync(join(f.auth, 'receipt.json'));
  const lost = Object.assign(new Error('lock lost'), { code: 'PROJECT_LOCKED' });
  assert.throws(() => writeReceiptRecord(f.auth, REV, before, [item('prompt', 'other')], () => { assert.equal(fs.existsSync(temp), true, 'live() runs after the temporary record is written'); throw lost; }, f.readNow), code('PROJECT_LOCKED'));
  assert.equal(fs.existsSync(temp), false); assert.deepEqual(fs.readFileSync(join(f.auth, 'receipt.json')), bytes);
  assert.throws(() => writeReceiptRecord(f.auth, REV, { sha256: 'c'.repeat(64), bytes: 1 }, [item('prompt', 'other')], () => {}, f.readNow), code('STALE_APPROVAL'));
  assert.equal(fs.existsSync(temp), false);
  // A record this writer would not read back is refused before anything is written.
  const bad = { ...item('prompt', 'brief'), id: 'Not An Id' };
  assert.throws(() => writeReceiptRecord(f.auth, REV, before, [bad], () => {}, f.readNow), code('AUTHORING_RECEIPT_INVALID'));
  assert.equal(fs.existsSync(temp), false); assert.deepEqual(fs.readFileSync(join(f.auth, 'receipt.json')), bytes);
  assert.deepEqual(f.names(), ['receipt.json']);
});
