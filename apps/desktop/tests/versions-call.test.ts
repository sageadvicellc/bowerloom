// The save points as one answer (renderer/harness/sheets/use-call.ts): a read that throws is the save points' own refusal in words, so a save point record
// that cannot be read never undoes a plan or a set-aside that worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { versionsCall } from '../renderer/harness/sheets/use-call.js';
import type { Answer, EngineBridge, VersionView } from '../shared/engine/types.js';

const bridge = (listVersions: () => Promise<Answer<readonly VersionView[]>>): EngineBridge => ({ listVersions } as unknown as EngineBridge);

test('a read that answers is passed on as it is, a refusal too', async () => {
  const value: Answer<readonly VersionView[]> = { ok: true, value: [{ id: 'v1', created: '2026-10-31T12:00:00Z', label: 'As it was', files: 3, current: true }] };
  assert.equal(await versionsCall(bridge(async () => value), 'folder-1'), value);
  const refused: Answer<readonly VersionView[]> = { ok: false, refusal: { code: 'VERSION_CORRUPT', message: 'Damaged.', paths: [] } };
  assert.equal(await versionsCall(bridge(async () => refused), 'folder-1'), refused);
});

test('a read that throws is a refusal in words, with the real code when the bridge gave one', async () => {
  const failed = await versionsCall(bridge(async () => { throw new Error('disk gone'); }), 'folder-1');
  assert.equal(failed.ok, false);
  if (!failed.ok) { assert.equal(failed.refusal.code, 'FAILED'); assert.match(failed.refusal.message, /could not finish/); assert.equal(failed.refusal.message.includes('disk gone'), false); }
  const known = await versionsCall(bridge(async () => { throw new Error('UNKNOWN_FOLDER'); }), 'folder-1');
  assert.equal(known.ok, false);
  if (!known.ok) assert.equal(known.refusal.code, 'UNKNOWN_FOLDER');
});
