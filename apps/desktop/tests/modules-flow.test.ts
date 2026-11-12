// The steps of the approved folders of one module (shared/modules/places-flow.ts), driven with a fake bridge: the first read, an approval, a removal, and every refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModuleApproval, ModulePlace, ModulesBridge } from '../shared/api/modules.js';
import { approveFlow, firstPlaces, loadPlaces, removeFlow } from '../shared/modules/places-flow.js';
import { MODULE_WORDS, removeWords } from '../shared/modules/view-model.js';

const A: ModulePlace = { id: 'place-aaaaaaaaaaaa', label: '~/Documents/notes', approvedAt: '2026-11-12T10:00:00.000Z' };
const B: ModulePlace = { id: 'place-bbbbbbbbbbbb', label: '~/Documents/other', approvedAt: '2026-11-12T11:00:00.000Z' };

function fake(over: Partial<ModulesBridge> = {}): ModulesBridge & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    listModulePlaces: async id => { asked.push(`list ${id}`); return { places: [A] }; },
    approveModulePlace: async id => { asked.push(`approve ${id}`); return { status: 'kept', place: B }; },
    revokeModulePlace: async (id, place) => { asked.push(`revoke ${id} ${place}`); return { places: [B] }; },
    readModuleFile: async () => ({ text: '' }),
    ...over,
  };
}
const refuse = (code: string) => async (): Promise<never> => { throw new Error(`Error invoking remote method 'bowerloom-modules:x': Error: ${code}`); };

test('no bridge is the state "none", and a bridge starts as "loading" with nothing approved', () => {
  assert.deepEqual(firstPlaces(null), { status: 'none', places: [], code: null, busy: false, notice: null });
  assert.deepEqual(firstPlaces(fake()), { status: 'loading', places: [], code: null, busy: false, notice: null });
});

test('the first read gives the approved folders of that module only', async () => {
  const bridge = fake();
  assert.deepEqual(await loadPlaces(bridge, 'memory'), { status: 'ready', places: [A], code: null });
  assert.deepEqual(bridge.asked, ['list memory']);
});

test('a refused read is the state "failed" with the short code and no folder, never a blank page', async () => {
  for (const code of ['RECORD_DAMAGED', 'RECORD_BLOCKED', 'UNKNOWN_MODULE', 'NOT_ALLOWED']) {
    assert.deepEqual(await loadPlaces(fake({ listModulePlaces: refuse(code) }), 'memory'), { status: 'failed', places: [], code }, code);
  }
  assert.deepEqual(await loadPlaces(fake({ listModulePlaces: refuse('SURPRISE') }), 'memory'), { status: 'failed', places: [], code: 'FAILED' }, 'a code the page does not know is FAILED');
  assert.deepEqual(await loadPlaces(fake({ listModulePlaces: () => { throw new Error('/Users/someone/secret'); } }), 'memory'), { status: 'failed', places: [], code: 'FAILED' }, 'a call that throws at once, and a message with a path, never reach the page');
});

test('an approval calls the chooser of main with the module id only, reads the list again, and says "Approved."', async () => {
  const bridge = fake({ listModulePlaces: async () => ({ places: [A, B] }) });
  const seen: unknown[][] = [];
  const wrapped = { ...bridge, approveModulePlace: async (...args: unknown[]) => { seen.push(args); return { status: 'kept', place: B } as ModuleApproval; } } as unknown as ModulesBridge;
  assert.deepEqual(await approveFlow(wrapped, 'memory'), { status: 'ready', places: [A, B], code: null, busy: false, notice: 'Approved.' });
  assert.deepEqual(seen, [['memory']], 'the page gives no folder');
});

test('a cancelled chooser changes nothing but the busy flag, and a refused pick keeps the list and says why', async () => {
  const cancelled = await approveFlow(fake({ approveModulePlace: async () => ({ status: 'cancelled' }) }), 'memory');
  assert.deepEqual(cancelled, { busy: false, notice: null });
  const refused = await approveFlow(fake({ approveModulePlace: async () => ({ status: 'refused', code: 'NOT_IN_HOME' }) }), 'memory');
  assert.deepEqual(refused, { busy: false, notice: 'Choose a folder inside your home folder.' });
  assert.equal('places' in refused, false, 'the list is not touched');
  for (const patch of [cancelled, refused]) assert.equal('status' in patch, false);
});

test('an approval that the bridge refuses is the state "failed" with its code, and not busy', async () => {
  assert.deepEqual(await approveFlow(fake({ approveModulePlace: refuse('UNKNOWN_MODULE') }), 'memory'), { status: 'failed', code: 'UNKNOWN_MODULE', busy: false, notice: null });
});

test('an approval that kept the folder but whose list then fails keeps the old places and drops "Approved."', async () => {
  const patch = await approveFlow(fake({ listModulePlaces: refuse('RECORD_BLOCKED') }), 'memory');
  assert.deepEqual(patch, { status: 'failed', code: 'RECORD_BLOCKED', busy: false, notice: MODULE_WORDS.approvedNoRefresh });
  assert.equal('places' in patch, false, 'the places the page holds are kept when the list cannot be read again');
  assert.notEqual(patch.notice, 'Approved.');
});

test('a removal gives the folders that are left and says the files are untouched', async () => {
  const bridge = fake();
  assert.deepEqual(await removeFlow(bridge, 'memory', A.id), { status: 'ready', places: [B], code: null, busy: false, notice: MODULE_WORDS.removed });
  assert.deepEqual(bridge.asked, [`revoke memory ${A.id}`]);
  assert.match(MODULE_WORDS.removed, /untouched/);
  const failed = await removeFlow(fake({ revokeModulePlace: refuse('FAILED') }), 'memory', A.id);
  assert.deepEqual(failed, { code: 'FAILED', busy: false, notice: removeWords('FAILED') }, 'a failed removal keeps the list and says the folder is still approved');
  assert.equal('status' in failed, false);
  assert.equal('places' in failed, false);
});

test('a failed approve call keeps the places the page holds: no places key in the patch, for a thrown call, FAILED and UNKNOWN_MODULE', async () => {
  for (const code of ['FAILED', 'UNKNOWN_MODULE']) {
    const patch = await approveFlow(fake({ approveModulePlace: refuse(code) }), 'memory');
    assert.equal('places' in patch, false, code);
    assert.deepEqual(patch, { status: 'failed', code, busy: false, notice: null });
  }
  const thrown = await approveFlow(fake({ approveModulePlace: () => { throw new Error('/Users/someone/secret'); } }), 'memory');
  assert.equal('places' in thrown, false);
  assert.equal(thrown.code, 'FAILED');
  assert.equal('places' in await loadPlaces(fake({ listModulePlaces: refuse('FAILED') }), 'memory'), true, 'the first load still empties the list');
});

test('a kept place after a reset whose list then cannot be read again says both: approved, list not read, old list set aside', async () => {
  const bridge = fake({ approveModulePlace: async () => ({ status: 'kept', place: B, listReset: true }), listModulePlaces: refuse('FAILED') });
  const patch = await approveFlow(bridge, 'memory');
  assert.equal(patch.notice, `${MODULE_WORDS.approvedNoRefresh} ${MODULE_WORDS.resetNote}`);
  assert.match(patch.notice ?? '', /could not be read again/);
  assert.match(patch.notice ?? '', /set aside/);
  assert.equal('places' in patch, false);
});
