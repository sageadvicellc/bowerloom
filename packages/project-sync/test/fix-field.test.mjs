// Round 13 of the reviews of PR 101, item 3 (decided): a runnable command is marked when it is built. A refusal whose step
// runs a rerun command keeps `next` as the sentence and sets `fix` to the bare command; words that name a command never
// become a fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquisitionRefusal, interrupted, prunedPin, syncRerun } from '../../../dist/packages/project-sync/src/apply.js';
import { command, runnable, SYNC_COMMAND } from '../../../dist/packages/project-sync/src/refusal.js';
import { migrateFlow } from '../../../dist/packages/project-sync/src/migrate.js';
import { applyRerun } from '../../../dist/packages/project-sync/src/apply-project.js';
import { NpmAcquisitionError } from '../../../dist/packages/skill-sources/src/npm.js';

const live = new AbortController().signal;
const WORDS = 'the same bowerloom skills sync command';

test('runnable is true only for a command a builder made, never for the same text typed by hand or for words', () => {
  assert.equal(runnable(SYNC_COMMAND), true);
  assert.equal(runnable(syncRerun({ offline: false, team: 'research', frozen: true })), true);
  assert.equal(runnable(syncRerun({ offline: false, team: 'x;id' })), false, 'the words fallback');
  assert.equal(runnable('bowerloom never-built --flag'), false, 'text that only looks like a command');
  assert.equal(runnable(migrateFlow({ legacyStateDir: '/a/b' }).replan), true);
  assert.equal(runnable(migrateFlow({ legacyStateDir: '/a/x\\y' }).replan), false, 'the migrate words');
});

test('the unclear-cache and stopped-fetch refusals: fix is the command for a real rerun, and absent for words', () => {
  const unclear = new NpmAcquisitionError('NPM_NETWORK', ['NPM_CACHE_RELEASE_UNCERTAIN']), stop = new NpmAcquisitionError('NPM_ABORTED');
  const flows = [
    [{ rerun: SYNC_COMMAND }, SYNC_COMMAND],
    [{ rerun: syncRerun({ offline: false, team: null, frozen: true }) }, 'bowerloom skills sync --frozen'],
    [migrateFlow({ legacyStateDir: '/a/b' }), 'bowerloom skills migrate plan --state /a/b'],
    [{ rerun: WORDS }, undefined],
    [migrateFlow({ legacyStateDir: '/a/x\\y' }), undefined],
  ];
  for (const [flow, fix] of flows) for (const error of [unclear, stop]) {
    const e = acquisitionRefusal(error, live, 'x', flow);
    assert.equal(e.fix, fix, `${flow.rerun} ${error.code}`);
    assert.match(e.next, /^Run /, 'next stays a sentence');
  }
});

test('the interrupted refusal between items: fix for a real rerun, none for words', () => {
  assert.equal(interrupted(['a'], ['b'], command('bowerloom apply --frozen')).fix, 'bowerloom apply --frozen');
  assert.equal(interrupted(['a'], ['b']).fix, 'bowerloom skills sync');
  const words = interrupted(['a'], ['b'], WORDS);
  assert.equal(words.fix, undefined); assert.equal(words.next, `Run ${WORDS} to finish.`);
});

test('a pin pruned after the fetch: fix for a real rerun, none for words', t => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bowerloom-fix-'))); t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.chmodSync(base, 0o700);
  const stateRoot = path.join(base, 'state'), cache = path.join(stateRoot, 'cache');
  fs.mkdirSync(stateRoot, { mode: 0o700 }); fs.mkdirSync(cache, { mode: 0o700 });
  const s = fs.lstatSync(cache, { bigint: true }), cacheIdentity = { device: String(s.dev), inode: String(s.ino) };
  const real = prunedPin('alpha', cache, 'a'.repeat(32), { rerun: SYNC_COMMAND, stateRoot, cacheIdentity });
  assert.equal(real.code, 'STALE_APPROVAL'); assert.equal(real.next, 'Run bowerloom skills sync again.'); assert.equal(real.fix, 'bowerloom skills sync');
  const words = prunedPin('alpha', cache, 'a'.repeat(32), { rerun: WORDS, stateRoot, cacheIdentity });
  assert.equal(words.next, `Run ${WORDS} again.`); assert.equal(words.fix, undefined);
});

// Round 14 of the reviews of PR 101: the up --team rerun is marked when applyRerun builds it; its words fallback is not.
test('applyRerun marks the up --team command and the apply command, never their words', () => {
  assert.equal(runnable(applyRerun({ team: 'research', engines: ['claude-code', 'codex'], frozen: false })), true);
  assert.equal(interrupted([], ['a'], applyRerun({ team: 'research', engines: ['claude-code', 'codex'], frozen: false })).fix, 'bowerloom up --team research');
  assert.equal(runnable(applyRerun({ engines: ['claude-code'], frozen: true })), true);
  assert.equal(runnable(applyRerun({ team: 'a b', engines: ['claude-code', 'codex'] })), false);
});
