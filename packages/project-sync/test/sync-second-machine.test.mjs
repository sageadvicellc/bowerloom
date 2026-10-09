import test from '../../../dist/tests/support/lock-slot-retry.js';
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planSync, applySync } from '../../../dist/packages/project-sync/src/index.js';
import { denyNetwork, npmPackage, localEntry, syncProject, writeManifest, localSkill, fakeAcquirer, contentTree, deps } from './sync-fixture.mjs';

const network = denyNetwork();
after(() => assert.deepEqual(network, []));

test('two machines with only skills.json and the authored files copied end with the same project tree and catalogs', async t => {
  const first = syncProject(t, '.bowerloom-sync-a-'), second = syncProject(t, '.bowerloom-sync-b-');
  const a = npmPackage('alpha'), b = npmPackage('bravo', { name: 'bravo-tools' });
  localSkill(first, 'house-style', { 'SKILL.md': '---\nname: house-style\ndescription: Our voice.\n---\nWrite plainly.\n', 'references/words.md': '# Words\nShort ones.\n' });
  writeManifest(first, [a.entry, b.entry, localEntry('house-style')]);
  // What a clone carries: skills.json and the authored files, nothing else of .bowerloom.
  fs.cpSync(path.join(first.projectDir, '.bowerloom/skills.json'), path.join(second.projectDir, '.bowerloom/skills.json'));
  fs.cpSync(path.join(first.projectDir, '.bowerloom/skills'), path.join(second.projectDir, '.bowerloom/skills'), { recursive: true });
  for (const machine of [first, second]) {
    const plan = await planSync(machine.input());
    assert.deepEqual(plan.items.map(i => [i.id, i.action]), [['alpha', 'install'], ['bravo', 'install'], ['house-style', 'install']]);
    const result = await applySync(machine.input(), plan.revision, deps(fakeAcquirer([a, b])));
    assert.deepEqual(result.applied.map(x => x.id), ['alpha', 'bravo', 'house-style']);
  }
  assert.notEqual(first.stateRoot, second.stateRoot); assert.notEqual(first.projectDir, second.projectDir);
  assert.equal(contentTree(first.projectDir), contentTree(second.projectDir));
  for (const id of ['alpha', 'bravo', 'house-style']) {
    const rel = `.bowerloom/managed/catalog/${id}.json`, bytes = fs.readFileSync(path.join(first.projectDir, rel));
    assert.ok(bytes.equals(fs.readFileSync(path.join(second.projectDir, rel))), id);
    assert.ok(!bytes.includes(first.base) && !bytes.includes(second.base), 'a catalog holds no machine path');
  }
  for (const machine of [first, second]) assert.deepEqual((await planSync(machine.input())).items.map(i => i.state), ['up-to-date', 'up-to-date', 'up-to-date']);
});
