// The display logic of the Modules view (shared/modules/view-model.ts): which extensions are listed as modules, the words, and the manifest of the view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_PICK_REFUSALS } from '../shared/api/modules.js';
import { CALL_CODES, MODULES_ID, MODULE_WORDS, approvalNotice, approvedDay, callWords, moduleCount, moduleRows, pickWords } from '../shared/modules/view-model.js';
import { LOCAL_MODELS_MANIFEST, MODULES_MANIFEST } from '../shared/local-models/sample.js';
import { DEFAULT_EXTENSIONS } from '../shared/extensions/defaults.js';
import { bannedHere, countWords } from '../shared/harness/words.js';
import { DESKTOP } from './support.js';

const ext = (id: string, over: Record<string, unknown> = {}) => ({ id, title: id.toUpperCase(), kind: 'ui' as const, routes: [`${id}-route`], protected: false, ...over });

test('the manifest of the Modules view is bundled, not protected, owns the route modules, and the sample manifest equals it', () => {
  const manifest = JSON.parse(readFileSync(join(DESKTOP, 'extensions/modules/manifest.json'), 'utf8')) as unknown;
  assert.deepEqual(manifest, { id: 'modules', title: 'Modules', kind: 'ui', routes: ['modules'], protected: false });
  assert.deepEqual(manifest, JSON.parse(JSON.stringify(MODULES_MANIFEST)));
  assert.equal(MODULES_ID, 'modules');
});

test('the view lists every unprotected extension except itself, in the order main gave, and marks the open one', () => {
  const rows = moduleRows([LOCAL_MODELS_MANIFEST, MODULES_MANIFEST, ext('memory')], 'memory');
  assert.deepEqual(rows.map(r => [r.id, r.title, r.route, r.current]), [['local-models', 'Local models', 'local-models', false], ['memory', 'MEMORY', 'memory-route', true]]);
  assert.equal(Object.isFrozen(rows), true);
  assert.deepEqual(moduleRows([LOCAL_MODELS_MANIFEST], null).map(r => r.current), [false]);
  assert.deepEqual(moduleRows([LOCAL_MODELS_MANIFEST], 'nothing').map(r => r.current), [false], 'an id that is not listed marks nothing');
});

test('the view never lists a protected default, and never lists the view itself', () => {
  assert.deepEqual(moduleRows(DEFAULT_EXTENSIONS, null), []);
  assert.deepEqual(moduleRows([MODULES_MANIFEST], null), []);
  assert.deepEqual(moduleRows([ext('claims', { protected: true })], null), []);
  assert.deepEqual(moduleRows([], null), []);
  assert.deepEqual(moduleRows([ext('noroute', { routes: [] })], null), [], 'a manifest with no route has nothing to open');
});

test('the count line says one module or several, and nothing for none', () => {
  assert.equal(moduleCount(moduleRows([], null)), undefined);
  assert.equal(moduleCount(moduleRows([LOCAL_MODELS_MANIFEST], null)), '1 module');
  assert.equal(moduleCount(moduleRows([LOCAL_MODELS_MANIFEST, ext('a'), ext('b')], null)), '3 modules');
});

test('an approval reads as one line, a cancel says nothing, and every refusal of a pick has words of its own', () => {
  assert.equal(approvalNotice({ status: 'cancelled' }), null);
  assert.equal(approvalNotice({ status: 'kept', place: { id: 'place-0123456789ab', label: '~/x', approvedAt: '2026-11-12T10:00:00.000Z' } }), 'Approved.');
  const seen = new Set<string>();
  for (const code of MODULE_PICK_REFUSALS) {
    const words = approvalNotice({ status: 'refused', code });
    assert.ok(words !== null && words.length > 0, code);
    assert.equal(words, pickWords(code));
    seen.add(words!);
  }
  assert.equal(seen.size, MODULE_PICK_REFUSALS.length, 'each refusal has its own sentence');
  assert.equal(pickWords('SOMETHING_ELSE'), pickWords('FAILED'));
  for (const odd of [undefined, null, 5, {}, '__proto__', 'constructor']) assert.equal(pickWords(odd), pickWords('FAILED'), String(odd));
});

test('every code a list or a removal can end with has words, and an unknown code reads as the failure line', () => {
  for (const code of CALL_CODES) assert.ok(callWords(code).length > 0, code);
  assert.match(callWords('RECORD_DAMAGED'), /Approve a folder to start a new list/);
  assert.equal(callWords('NEW_CODE'), callWords('FAILED'));
  for (const odd of [undefined, null, 5, {}, '__proto__', 'constructor']) assert.equal(callWords(odd), callWords('FAILED'), String(odd));
});

test('an approval day is the saved day, with no clock', () => {
  assert.equal(approvedDay({ id: 'place-0123456789ab', label: '~/x', approvedAt: '2026-11-12T10:00:00.000Z' }), '2026-11-12');
  assert.equal(approvedDay({ id: 'place-0123456789ab', label: '~/x', approvedAt: 'yesterday' }), 'yesterday');
});

test('the words of the view obey the rules of the preview: no banned word, and a short line each', () => {
  for (const [key, text] of Object.entries(MODULE_WORDS)) {
    assert.equal(bannedHere(text), null, key);
    assert.ok(countWords(text) <= 25, `${key}: ${text}`);
    assert.equal(text, text.trim(), key);
  }
  for (const code of MODULE_PICK_REFUSALS) assert.equal(bannedHere(pickWords(code)), null, code);
  for (const code of CALL_CODES) assert.equal(bannedHere(callWords(code)), null, code);
});

test('the rule of the view is said in its words: only what the person picks, once for each module, on this computer', () => {
  assert.match(MODULE_WORDS.hint, /reads only what you pick/);
  assert.match(MODULE_WORDS.readsFolders, /once for this module/);
  assert.match(MODULE_WORDS.readsLocal, /Nothing leaves this computer/);
});
