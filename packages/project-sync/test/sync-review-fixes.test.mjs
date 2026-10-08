// The independent M5 review (REVIEW-M5-01, ACCEPT WITH FINDINGS): one test per finding 1 to 6 and 9 at the package
// level. Findings 7 and 8 at the CLI level are in tests/m5-review-fixes.test.ts.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { ignoreCarrier } from '../../../dist/packages/project-sync/src/plan.js';
import { planProjectApply } from '../../../dist/packages/project-sync/src/index.js';
import { planManagedItem } from '../../../dist/packages/managed-skills/src/v2-observed.js';
import { applyManagedItem } from '../../../dist/packages/managed-skills/src/v2-transaction.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, fakeAcquirer, noAcquirer, exactTree, exists, deps, code, byId } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network.filter(c => !c.expected), []));
const sync = async (f, acquirer = noAcquirer()) => applySync(f.input(), (await planSync(f.input())).revision, deps(acquirer));

test('finding 1: a private state root inside the project, or one that holds it, refuses SKILLS_STATE_UNSAFE at plan time', async t => {
  const f = syncProject(t); localSkill(f, 'bravo'); writeManifest(f, [localEntry('bravo')]);
  fs.mkdirSync(path.join(f.projectDir, 'xdg'), { mode: 0o700 });
  const roots = [path.join(f.projectDir, 'xdg', 'bowerloom'), path.join(f.projectDir, 'bowerloom'), f.projectDir, f.base];
  // The same folder by another spelling: a case alias on a case-insensitive volume. Only path strings differ.
  const alias = path.join(path.dirname(f.projectDir), 'PROJECT');
  const aliased = fs.existsSync(alias) && fs.statSync(alias).ino === fs.statSync(f.projectDir).ino;
  if (aliased) roots.push(path.join(alias, 'xdg', 'bowerloom'));
  const before = exactTree(f.base);
  for (const stateRoot of roots) {
    await assert.rejects(planSync({ ...f.input(), stateRoot: path.resolve(stateRoot) }), code('SKILLS_STATE_UNSAFE'), stateRoot);
    await assert.rejects(planProjectApply({ project: f.project(), stateRoot: path.resolve(stateRoot), harnesses: ['claude', 'codex'], team: null }), code('SKILLS_STATE_UNSAFE'), stateRoot);
  }
  assert.equal(exactTree(f.base), before);
  t.diagnostic(aliased ? 'the case alias was checked' : 'this volume is case-sensitive: no case alias to check');
  // A sibling folder is fine.
  assert.equal((await planSync(f.input())).items[0].action, 'install');
});

test('finding 2: a phase C mismatch after earlier children names the finished skills and does not say nothing was applied', async t => {
  const f = syncProject(t); localSkill(f, 'alpha'); localSkill(f, 'bravo'); writeManifest(f, [localEntry('alpha'), localEntry('bravo')]);
  let bravoPlans = 0;
  const managed = {
    async plan(req, o) { if (req.item.id === 'bravo' && ++bravoPlans === 2) fs.appendFileSync(path.join(f.projectDir, '.bowerloom/skills/bravo/SKILL.md'), 'Edited between the phases.\n'); return planManagedItem(req, o); },
    apply: (h, r, v, o) => applyManagedItem(h, r, v, o),
  };
  const plan = await planSync(f.input());
  await assert.rejects(applySync(f.input(), plan.revision, deps(noAcquirer(), { managed })),
    e => code('STALE_APPROVAL')(e) && /Finished before it: alpha\./.test(e.message) && /bravo/.test(e.message) && !/Nothing was applied/.test(e.message));
  assert.ok(exists(f, '.claude/skills/alpha/SKILL.md')); assert.equal(exists(f, '.claude/skills/bravo'), false);
  // Before any child, the words stay as they were.
  const g = syncProject(t); localSkill(g, 'bravo'); writeManifest(g, [localEntry('bravo')]); bravoPlans = 0;
  const managedG = { ...managed, async plan(req, o) { if (++bravoPlans === 2) fs.appendFileSync(path.join(g.projectDir, '.bowerloom/skills/bravo/SKILL.md'), 'Edited.\n'); return planManagedItem(req, o); } };
  await assert.rejects(applySync(g.input(), (await planSync(g.input())).revision, deps(noAcquirer(), { managed: managedG })), e => code('STALE_APPROVAL')(e) && /Nothing was applied/.test(e.message));
});

test('finding 3: a stray entry in an item\'s private folder gets its own hold, by relative name, with mv', async t => {
  const f = syncProject(t); localSkill(f, 'bravo'); writeManifest(f, [localEntry('bravo')]); await sync(f);
  fs.writeFileSync(path.join(f.itemsRoot, 'bravo', '.DS_Store'), 'x');
  fs.appendFileSync(path.join(f.projectDir, '.bowerloom/skills/bravo/SKILL.md'), 'More.\n');
  const item = (await planSync(f.input())).items[0];
  assert.deepEqual([item.action, item.hold.code], ['hold', 'SKILLS_STATE_STRAY_ENTRY']);
  assert.match(item.hold.next, /items\/bravo\/\.DS_Store/); assert.match(item.hold.next, /\bmv\b/); assert.match(item.hold.next, /the private state folder/);
  assert.ok(!item.hold.next.includes(f.stateRoot), item.hold.next);
  fs.rmSync(path.join(f.itemsRoot, 'bravo', '.DS_Store'));
  assert.equal((await planSync(f.input())).items[0].action, 'update');
});

test('finding 4: a later skill whose copy would go where an earlier one goes is held; the earlier one applies', async t => {
  const f = syncProject(t), a = npmPackage('alpha', { name: 'shared' }); localSkill(f, 'shared');
  writeManifest(f, [a.entry, localEntry('shared')]);
  const plan = await planSync(f.input()), items = byId(plan);
  assert.equal(items.alpha.action, 'install');
  assert.deepEqual([items.shared.action, items.shared.hold.code], ['hold', 'MANAGED_SKILL_PATH_OCCUPIED']);
  assert.match(items.shared.hold.next, /alpha/); assert.match(items.shared.hold.next, /\.claude\/skills\/shared/);
  const result = await applySync(f.input(), plan.revision, deps(fakeAcquirer([a])));
  assert.deepEqual(result.applied.map(x => x.id), ['alpha']); assert.deepEqual(result.held.map(h => h.id), ['shared']);
  // Once alpha is installed, shared is still held, now by the installed alpha.
  assert.equal(byId(await planSync(f.input())).shared.hold.code, 'MANAGED_SKILL_PATH_OCCUPIED');
});

test('finding 5: putting back the ignore file promotes an item with room in its history, never a full one', async t => {
  // A full history takes 64 real operations (minutes under load), so the choice is checked on plan items directly,
  // and the end-to-end promotion on a real project.
  const item = (id, history, extra = {}) => ({ id, kind: 'local', state: 'up-to-date', action: 'none', history, hold: null, ...extra });
  assert.equal(ignoreCarrier([item('alpha', 64), item('bravo', 3)])?.id, 'bravo');
  assert.equal(ignoreCarrier([item('alpha', 64)]), undefined);
  assert.equal(ignoreCarrier([item('alpha', 2, { kind: null, state: 'orphaned' }), item('bravo', 2)])?.id, 'bravo');
  const f = syncProject(t); localSkill(f, 'alpha'); writeManifest(f, [localEntry('alpha')]); await sync(f);
  fs.rmSync(path.join(f.projectDir, '.bowerloom/managed/.gitignore'));
  assert.equal((await planSync(f.input())).items[0].action, 'update');
  assert.deepEqual((await sync(f)).applied.map(x => x.id), ['alpha']);
  assert.equal(fs.readFileSync(path.join(f.projectDir, '.bowerloom/managed/.gitignore'), 'utf8'), '*\n');
});

test('finding 6: a parent folder an earlier child created must keep that exact identity for the later children', async t => {
  const f = syncProject(t); localSkill(f, 'alpha'); localSkill(f, 'bravo'); writeManifest(f, [localEntry('alpha'), localEntry('bravo')]);
  let bravoPlans = 0;
  const managed = {
    async plan(req, o) {
      if (req.item.id === 'bravo' && ++bravoPlans === 2) {
        // Swap .claude/skills for another folder that still holds alpha: same path, another folder.
        const skills = path.join(f.projectDir, '.claude/skills'), old = path.join(f.projectDir, '.claude/old');
        fs.renameSync(skills, old); fs.mkdirSync(skills, { mode: 0o700 }); fs.renameSync(path.join(old, 'alpha'), path.join(skills, 'alpha')); fs.rmdirSync(old);
      }
      return planManagedItem(req, o);
    },
    apply: (h, r, v, o) => applyManagedItem(h, r, v, o),
  };
  await assert.rejects(applySync(f.input(), (await planSync(f.input())).revision, deps(noAcquirer(), { managed })), e => code('STALE_APPROVAL')(e) && /alpha/.test(e.message));
  assert.equal(exists(f, '.claude/skills/bravo'), false);
});

test('finding 9: the test network guard also stops net.connect, tls.connect and fetch, and lets the lock reach 127.0.0.1', async () => {
  const mark = () => { network.at(-1).expected = true; };
  assert.throws(() => net.connect({ host: '192.0.2.1', port: 443 }), /TEST_NETWORK_DENIED/); mark();
  assert.throws(() => net.createConnection(443, '192.0.2.1'), /TEST_NETWORK_DENIED/); mark();
  assert.throws(() => tls.connect({ host: '192.0.2.1', port: 443 }), /TEST_NETWORK_DENIED/); mark();
  await assert.rejects(globalThis.fetch('https://192.0.2.1/'), /TEST_NETWORK_DENIED/); mark();
  assert.ok(network.every(c => c.expected), JSON.stringify(network));
  // The project lock still works: it listens and connects on the literal 127.0.0.1 only.
  const server = net.createServer().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const socket = net.connect({ host: '127.0.0.1', port: server.address().port }); await new Promise((r, j) => { socket.once('connect', r); socket.once('error', j); });
  socket.destroy(); await new Promise(r => server.close(r));
});
