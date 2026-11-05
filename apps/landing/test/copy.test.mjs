// The copy button: the helper writes the exact command to the clipboard and says what happened. A fake clipboard stands in for the browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText, copyLabel } from '../src/copy.ts';

test('copying writes the exact text and reports success', async () => {
  const written = [];
  const result = await copyText('npm install -g bowerloom@beta', { writeText: async text => { written.push(text); } });
  assert.equal(result, 'copied');
  assert.deepEqual(written, ['npm install -g bowerloom@beta']);
});

test('a clipboard that refuses, throws, or is missing reports failure and never throws', async () => {
  assert.equal(await copyText('x', { writeText: async () => { throw new Error('denied'); } }), 'failed');
  assert.equal(await copyText('x', { writeText: () => { throw new Error('denied'); } }), 'failed');
  assert.equal(await copyText('x', undefined), 'failed');
  assert.equal(await copyText('x', null), 'failed');
});

test('each state has a plain label for the button and its live region', () => {
  assert.equal(copyLabel('idle'), 'Copy');
  assert.equal(copyLabel('copied'), 'Copied');
  assert.match(copyLabel('failed'), /select the command/i);
});
