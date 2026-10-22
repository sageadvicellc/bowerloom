// Review S1 of PR 98: a store whose skills or teams folder is a link. localItemRows reads the area folder without
// following it, so every reader refuses instead of reading files outside the store: use, lock update, and the resolver
// behind ls, status, sync and apply.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { denyNetwork } from './sync-fixture.mjs';
import { configWorld, writeConfig, writeLock, storeItem, code, pushStore, storeTransport, lockOfRepo } from './config-fixture.mjs';
import { planConfigChange, planLockUpdate, resolveProject, localItemRows } from '../../../dist/packages/project-sync/src/index.js';
import { discoverProject } from '../../../dist/packages/project-context/src/index.js';

const network = denyNetwork();
after(() => assert.deepEqual(network, [], 'every network read goes to a fake'));
const ctx = w => discoverProject(w.projectDir, w.home);
const signal = () => new AbortController().signal;
function gitStore(w, repo) {
  const git = path.join(w.store, '.git'); fs.mkdirSync(path.join(git, 'refs/remotes/origin'), { recursive: true, mode: 0o755 }); fs.mkdirSync(path.join(git, 'refs/heads'), { recursive: true });
  fs.writeFileSync(path.join(git, 'config'), '[remote "origin"]\n\turl = git@github.com:SageAdviceLLC/store.git\n'); fs.writeFileSync(path.join(git, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(git, 'refs/remotes/origin/main'), `${repo.commit}\n`); fs.writeFileSync(path.join(git, 'refs/heads/main'), `${repo.commit}\n`);
}
/** A shared project whose store holds a skill and a team, pushed, with `area` of the store replaced by a link to a copy. */
async function linkedStore(t, area) {
  const w = configWorld(t, { folder: true });
  await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style');
  const repo = pushStore(w); gitStore(w, repo);
  const copy = path.join(w.base, `copy-${area}`); fs.cpSync(path.join(w.store, area), copy, { recursive: true }); fs.rmSync(path.join(w.store, area), { recursive: true }); fs.symlinkSync(copy, path.join(w.store, area));
  return { w, repo };
}
const notShareable = e => e.code === 'STORE_ITEM_NOT_SHAREABLE' && e.message.endsWith('The item holds a file that a lock cannot record.');

test('localItemRows refuses a linked skills, teams or prompts folder', async t => {
  for (const [area, kind, id] of [['skills', 'skill', 'house-style'], ['teams', 'team', 'research']]) {
    const { w } = await linkedStore(t, area);
    assert.throws(() => localItemRows(w.store, kind, id), notShareable, area);
  }
  const w = configWorld(t, { folder: true }); await storeItem(w, 'prompt', 'brief');
  const copy = path.join(w.base, 'copy'); fs.cpSync(path.join(w.store, 'prompts'), copy, { recursive: true }); fs.rmSync(path.join(w.store, 'prompts'), { recursive: true }); fs.symlinkSync(copy, path.join(w.store, 'prompts'));
  assert.throws(() => localItemRows(w.store, 'prompt', 'brief'), notShareable, 'prompts');
});

test('use refuses a store item behind a linked area in a shared project', async t => {
  for (const [area, kind, id] of [['skills', 'skill', 'house-style'], ['teams', 'team', 'research']]) {
    const { w, repo } = await linkedStore(t, area); writeConfig(w, {}); writeLock(w, {});
    await assert.rejects(planConfigChange({ project: ctx(w), home: w.home, op: 'use', kind, id, storeTransport: storeTransport(repo), signal: signal() }), notShareable, area);
  }
});

test('lock update and the resolver (ls, status, sync, apply) refuse a locked item behind a linked area', async t => {
  for (const [area, kind, id] of [['skills', 'skill', 'house-style'], ['teams', 'team', 'research']]) {
    const w = configWorld(t, { folder: true });
    await storeItem(w, 'team', 'research'); await storeItem(w, 'skill', 'house-style');
    const repo = pushStore(w); gitStore(w, repo);
    writeConfig(w, kind === 'skill' ? { skills: [{ id, source: 'store' }] } : { teams: [{ id, source: 'store' }] });
    writeLock(w, kind === 'skill' ? { skills: [lockOfRepo(w, repo, kind, id)] } : { teams: [lockOfRepo(w, repo, kind, id)] });
    const copy = path.join(w.base, `copy-${area}`); fs.cpSync(path.join(w.store, area), copy, { recursive: true }); fs.rmSync(path.join(w.store, area), { recursive: true }); fs.symlinkSync(copy, path.join(w.store, area));
    await assert.rejects(planLockUpdate({ project: ctx(w), home: w.home, items: null, commit: null, storeTransport: storeTransport(repo), signal: signal() }), notShareable, `lock update ${area}`);
    assert.throws(() => resolveProject({ project: ctx(w), home: w.home, frozen: false }), notShareable, `resolver ${area}`);
  }
});
