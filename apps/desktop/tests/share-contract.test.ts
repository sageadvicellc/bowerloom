// The contract of export and import between the window and main (shared/engine/types.ts) and between main and packages/harness-bundle. Stage 1 of Task 1 fixes
// the names, the argument counts, the codes and the words; later lanes build behind them. This file stays true when they do.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENGINE_ARITY, ENGINE_CALLS, ENGINE_CALL_REFUSALS, ENGINE_CHANNELS, SHARE_BUNDLE_ID, SHARE_HELD_BUNDLES, SHARE_LIST_LIMIT, SHARE_MAIN_WORDS, SHARE_NAME_LIMIT, SHARE_NOTES_LIMIT,
} from '../shared/engine/types.js';
import { BUNDLE_LIMITS, BUNDLE_MESSAGES } from '../../../packages/harness-bundle/src/index.js';
import { engineCodeOf } from '../renderer/harness/real/engine-bridge.js';
import { callRefusal } from '../renderer/harness/sheets/call-lanes.js';

const SHARE_CALLS = { planExport: 1, runExport: 3, chooseBundle: 0, planImport: 3, runImport: 5, discardBundle: 1 } as const;

test('the six share calls are in the call list with their argument counts and their own channels', () => {
  for (const [call, count] of Object.entries(SHARE_CALLS)) {
    assert.ok((ENGINE_CALLS as readonly string[]).includes(call), call);
    assert.equal(ENGINE_ARITY[call as keyof typeof ENGINE_ARITY], count, call);
    assert.equal(ENGINE_CHANNELS[call as keyof typeof ENGINE_CHANNELS], `bowerloom-engine:${call}`);
  }
  assert.equal(new Set(ENGINE_CALLS).size, ENGINE_CALLS.length, 'no call twice');
  assert.deepEqual(Object.keys(ENGINE_ARITY).sort(), [...ENGINE_CALLS].sort());
});

test('UNKNOWN_BUNDLE is a short refusal code that survives the bridge, the preload and the lanes', () => {
  assert.ok((ENGINE_CALL_REFUSALS as readonly string[]).includes('UNKNOWN_BUNDLE'));
  assert.equal(engineCodeOf(new Error("Error invoking remote method 'bowerloom-engine:planImport': Error: UNKNOWN_BUNDLE")), 'UNKNOWN_BUNDLE');
  assert.equal(callRefusal(new Error('UNKNOWN_BUNDLE')).code, 'UNKNOWN_BUNDLE');
  assert.match(callRefusal(new Error('UNKNOWN_BUNDLE')).message, /no longer holds that file/);
});

test('a bundle id is bundle-<n>, apart from folder ids and notes ids', () => {
  for (const ok of ['bundle-1', 'bundle-123456']) assert.match(ok, SHARE_BUNDLE_ID);
  for (const bad of ['folder-1', 'notes-1', 'bundle-', 'bundle-1234567', 'bundle-01x', '../bundle-1', 'bundle-1\n']) assert.doesNotMatch(bad, SHARE_BUNDLE_ID, bad);
});

test('the window limits equal the package limits', () => {
  assert.equal(SHARE_LIST_LIMIT, BUNDLE_LIMITS.listRows);
  assert.equal(SHARE_HELD_BUNDLES, BUNDLE_LIMITS.heldBundles);
  assert.equal(SHARE_NOTES_LIMIT, BUNDLE_LIMITS.notesNames);
  assert.equal(SHARE_NAME_LIMIT, BUNDLE_LIMITS.nameChars);
});

test('the words main shares with the package are the package words, sentence for sentence', () => {
  for (const code of ['IMPORT_FOLDER_HAS_HARNESS', 'IMPORT_NEEDS_ACKNOWLEDGEMENT', 'EXPORT_NEEDS_ACKNOWLEDGEMENT'] as const) assert.equal(SHARE_MAIN_WORDS[code], BUNDLE_MESSAGES[code], code);
  assert.match(SHARE_MAIN_WORDS.EXPORT_NO_DEFINITION, /nothing to put in a file\. .*Nothing was written\.$/);
  for (const words of Object.values(SHARE_MAIN_WORDS)) assert.doesNotMatch(words, /[\u0000-\u001f]/);
  // Neither banned screen word ("export", "import") is in a sentence that reaches a screen, so the sheets can use any name the owner picks.
  for (const words of [...Object.values(SHARE_MAIN_WORDS), ...Object.values(BUNDLE_MESSAGES)]) assert.doesNotMatch(words, /\b(?:export|import)/i, words);
});
