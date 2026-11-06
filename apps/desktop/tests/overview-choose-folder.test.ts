// The Overview asks main for one place by its label (journey 1, Overview M1): main refuses another folder before it registers it. These tests hold the window's side:
// the label goes over, a refusal for the wrong folder is the screen's own note and no failure, a cut label is not sent, and the sheets that ask for any folder send nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseFolderCall, chooseWanted } from '../renderer/harness/sheets/use-call.js';
import { NOTES_REFUSAL_WORDS } from '../renderer/harness/words-engine.js';
import { OVERVIEW } from '../renderer/harness/words-overview.js';
import type { Answer, EngineBridge, FolderInfo } from '../shared/engine/types.js';

const info = (label: string): FolderInfo => ({ id: 'folder-1', label, name: 'x', hasDefinition: false, engines: [], previewEngines: false, installedEngines: [], problem: null, projected: false, unfinished: { projection: false, adoption: false } });
/** A bridge that records the arguments of chooseFolder and answers as main does: a pick whose label is not the wanted one is refused, and registers nothing. */
function fake(picked: string | null): { engine: EngineBridge; calls: unknown[][]; registered: string[] } {
  const calls: unknown[][] = [], registered: string[] = [];
  const engine = {
    mode: 'real',
    chooseFolder: async (...args: unknown[]): Promise<Answer<FolderInfo> | null> => {
      calls.push(args);
      if (picked === null) return null;
      if (args[0] !== undefined && args[0] !== picked) return { ok: false, refusal: { code: 'NOT_THE_FOLDER_SHOWN', message: 'That is not the folder shown. Bowerloom did not add it.', paths: [] } };
      registered.push(picked);
      return { ok: true, value: info(picked) };
    },
    folders: async () => registered.map(info),
  } as unknown as EngineBridge;
  return { engine, calls, registered };
}

test('chooseFolderCall sends the wanted label only when it has one; the other sheets send nothing', async () => {
  const any = fake('~/Projects/a');
  await chooseFolderCall(any.engine);
  assert.deepEqual(any.calls, [[]]);
  const wanted = fake('~/Projects/a');
  await chooseFolderCall(wanted.engine, '~/Projects/a');
  assert.deepEqual(wanted.calls, [['~/Projects/a']]);
});

test('chooseWanted: the right folder goes on; the wrong one is the note, not a failure, and registers nothing; a closed chooser is null; a cut label goes to main too, which compares it before it registers', async () => {
  const right = fake('~/Projects/a');
  const ok = await chooseWanted(right.engine, '~/Projects/a', () => assert.fail('no note for the right folder'));
  assert.ok(ok.ok && ok.value?.info.label === '~/Projects/a' && ok.value.list.length === 1);
  const wrong = fake('~/Projects/b');
  let noted = 0;
  const refused = await chooseWanted(wrong.engine, '~/Projects/a', () => { noted += 1; });
  assert.deepEqual(refused, { ok: true, value: null });
  assert.equal(noted, 1);
  assert.deepEqual(wrong.registered, [], 'a refused pick stays out of the list');
  const closed = fake(null);
  assert.deepEqual(await chooseWanted(closed.engine, '~/Projects/a', () => assert.fail('no note')), { ok: true, value: null });
  const cut = fake('/Volumes/disk/other');
  let cutNoted = 0;
  const cutAnswer = await chooseWanted(cut.engine, '…/notes', () => { cutNoted += 1; });
  assert.deepEqual(cut.calls, [['…/notes']], 'main gets the cut label and compares it before it registers');
  assert.deepEqual([cutAnswer, cutNoted, cut.registered], [{ ok: true, value: null }, 1, []]);
  // Any other refusal passes on as it is.
  const odd = { ...right.engine, chooseFolder: async () => ({ ok: false, refusal: { code: 'NOT_A_FOLDER', message: 'x', paths: [] } }) } as unknown as EngineBridge;
  const passed = await chooseWanted(odd, '~/Projects/a', () => assert.fail('no note'));
  assert.ok(!passed.ok && passed.refusal.code === 'NOT_A_FOLDER');
});

test('chooseFolderCall: when the folder was added but the list cannot be read again, the answer says so in words and never claims nothing happened', async () => {
  const engine = { mode: 'real', chooseFolder: async () => ({ ok: true, value: info('~/Projects/a') }), folders: async () => { throw new Error('FAILED'); } } as unknown as EngineBridge;
  const answer = await chooseFolderCall(engine);
  assert.ok(!answer.ok);
  assert.match(answer.refusal.message, /was added/);
  assert.match(answer.refusal.message, /could not be read again/);
});

test('the refusal and the screen\'s note have words', () => {
  assert.equal(OVERVIEW.hint.wrongFolder, 'That is not the folder shown.');
  assert.ok(NOTES_REFUSAL_WORDS.NOT_THE_FOLDER_SHOWN?.length);
});
