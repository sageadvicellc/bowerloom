// The independent M5 review (REVIEW-M5-01), findings 7 and 8 at the CLI level. Findings 1 to 6 and 9 are in
// packages/project-sync/test/sync-review-fixes.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRefusal } from '../apps/cli/src/human.js';
import { interruptHandler, resultWords } from '../apps/cli/src/sync.js';

test('finding 7: hold text prints through plainText, and SKILLS_STATE_UNSAFE names the private state folder, not one path', () => {
  const words = resultWords({ format: 'bowerloom/skills-sync-result/v1beta1', planRevision: 'a'.repeat(64), applied: [{ id: 'alpha', action: 'install', receiptRevision: 'b'.repeat(64) }],
    held: [{ id: 'bravo', code: 'MANAGED_SKILL_LOCAL_DRIFT', next: 'Undo \u001b[31mred\u001b[0m and ‮gnp.exe' }], upToDate: [], orphaned: [], fetched: [], executionAuthorized: false });
  assert.doesNotMatch(words, /[\u001b‮]/); assert.match(words, /\\u001b\[31mred/); assert.match(words, /^ {2}alpha: installed$/m);
  const text = renderRefusal('SKILLS_STATE_UNSAFE', 'Unsafe.');
  assert.match(text, /^Next: .*the private state folder/m); assert.doesNotMatch(text, /Next: ls -ld ~\/\.local\/state\/bowerloom$/m);
});

test('finding 8: the first Ctrl-C stops between items; a second one names the item in progress and exits 130', () => {
  const controller = new AbortController(), out: string[] = [], exits: number[] = [];
  let current: string | null = 'alpha';
  const handler = interruptHandler(controller, () => current, text => { out.push(text); }, code => { exits.push(code); });
  handler();
  assert.equal(controller.signal.aborted, true); assert.deepEqual(exits, []); assert.match(out.join(''), /Stopping after the item in progress/);
  handler();
  assert.deepEqual(exits, [130]); assert.match(out.at(-1)!, /alpha/); assert.match(out.at(-1)!, /bowerloom skills recover plan --item alpha/);
  // With nothing in progress, the second Ctrl-C says so.
  const quiet: number[] = [], words: string[] = []; current = null;
  const idle = interruptHandler(new AbortController(), () => current, text => { words.push(text); }, code => { quiet.push(code); });
  idle(); idle(); assert.deepEqual(quiet, [130]); assert.match(words.at(-1)!, /No item was changing/);
});
