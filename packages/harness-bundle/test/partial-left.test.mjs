// A write on a volume with no hard links is not atomic. When it fails and the file it made cannot be removed, the words must say a partial file may remain, never "Nothing was
// read or written". The other failures keep the general words.
import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BundleRefusal, BUNDLE_MESSAGES, writeBundleFile } from '../../../dist/packages/harness-bundle/src/index.js';
import { PARTIAL_LEFT } from '../../../dist/packages/harness-bundle/src/codes.js';
import { clearFileIoHooks, setFileIoHook } from '../../../dist/packages/harness-bundle/src/file-io.js';
import { tempDir } from './fixture.mjs';

const hook = (name, fn) => setFileIoHook(name, fn);
const errno = (code, text = 'simulated') => Object.assign(new Error(text), { code });
const bytes = Buffer.from('{"made":"up"}\n');
const failure = async run => { try { await run; } catch (error) { assert.ok(error instanceof BundleRefusal, String(error)); return error; } throw new Error('the call did not fail'); };

describe('a partial file on a volume with no hard links', () => {
  beforeEach(() => { clearFileIoHooks(); hook('link', () => { throw errno('EPERM'); }); });
  afterEach(clearFileIoHooks);

  test('a size that is not ours declines the removal: the refusal says a partial file may remain, and does not say nothing was written', async t => {
    const dir = tempDir(t);
    const grown = path.join(dir, 'grown.json');
    hook('afterWrite', () => { fs.appendFileSync(grown, 'more bytes from someone else\n'); throw errno('ENOSPC', 'disk full'); });
    const r = await failure(writeBundleFile(grown, bytes));
    assert.equal(r.code, 'BUNDLE_FILE_FAILED');
    assert.equal(r.cause, PARTIAL_LEFT);
    assert.match(r.message, /A partial file may remain at the place you chose\. Delete it by hand\./);
    assert.doesNotMatch(r.message, /Nothing was read or written/);
    assert.ok(r.message.startsWith(BUNDLE_MESSAGES.BUNDLE_FILE_FAILED.replace(' Nothing was read or written.', '')), 'the table sentence is the same up to its last sentence');
    assert.ok(fs.existsSync(grown), 'the file is there, as the words say');
  });

  test('a file that is removed again keeps the general words and the reason of the system error', async t => {
    const dir = tempDir(t);
    const gone = path.join(dir, 'gone.json');
    hook('afterWrite', () => { throw errno('ENOSPC', 'disk full'); });
    const r = await failure(writeBundleFile(gone, bytes));
    assert.equal(r.cause, 'ENOSPC');
    assert.match(r.message, /Nothing was read or written/);
    assert.match(r.message, /The disk is full\./);
    assert.equal(fs.existsSync(gone), false);
  });

  test('the cause survives a worker boundary: toJSON then fromPlain gives the same words', async t => {
    const dir = tempDir(t);
    const grown = path.join(dir, 'grown.json');
    hook('afterWrite', () => { fs.appendFileSync(grown, 'x'); throw errno('ENOSPC'); });
    const r = await failure(writeBundleFile(grown, bytes));
    const back = BundleRefusal.fromPlain(JSON.parse(JSON.stringify(r.toJSON())));
    assert.equal(back.message, r.message);
    assert.equal(back.cause, PARTIAL_LEFT);
  });
});
