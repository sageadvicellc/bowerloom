// Spec 05, section 10.11: the authoring owner of `.bowerloom/slices`.
import test from '../../../dist/tests/support/lock-slot-retry.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planStartup, applyStartup } from '../../../dist/packages/startup/src/index.js';
import { withProjectLock } from '../../../dist/packages/project-context/src/index.js';
import { planCreate, applyCreate, authoringVerifier } from '../../../dist/packages/project-authoring/src/index.js';

const signal = () => new AbortController().signal;
async function project(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'bowerloom-slices-owner-'))); fs.chmodSync(parent, 0o700);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const dir = join(parent, 'studio'); fs.mkdirSync(dir, { mode: 0o755 });
  const input = { mode: 'existing', targetDir: dir, brief: { projectName: 'Studio handbook', goal: 'Prepare a fictional onboarding kit for an independent design studio.', profile: 'founder' } };
  await applyStartup(input, (await planStartup(input)).revision);
  const request = { kind: 'slice', project: dir, name: 'wiki', root: null, includes: null };
  await withProjectLock(dir, signal(), async held => applyCreate(request, (await planCreate(request)).revision, held));
  return { dir, bowerloom: join(dir, '.bowerloom'), file: join(dir, '.bowerloom', 'slices', 'wiki.yaml') };
}
const verify = (p) => authoringVerifier(p.dir).verify('slices', 'directory', signal());

test('1. a registered valid slice folder verifies as verified', async t => { const p = await project(t); assert.deepEqual(await verify(p), { result: 'verified' }); assert.equal(authoringVerifier(p.dir).claims('slices', 'directory'), true); });
test('2. an edited registered slice is edited', async t => { const p = await project(t); fs.appendFileSync(p.file, 'maxFiles: 10\n'); assert.deepEqual(await verify(p), { result: 'edited' }); });
test('3. an unregistered file refuses AUTHORING_UNREGISTERED', async t => {
  const p = await project(t); fs.copyFileSync(p.file, join(p.bowerloom, 'slices', 'other.yaml')); assert.deepEqual(await verify(p), { result: 'refused', code: 'AUTHORING_UNREGISTERED' });
  fs.rmSync(join(p.bowerloom, 'slices', 'other.yaml')); fs.writeFileSync(join(p.bowerloom, 'slices', 'notes.txt'), 'x'); assert.deepEqual(await verify(p), { result: 'refused', code: 'AUTHORING_UNREGISTERED' });
});
test('4. a registered file that fails parseSlice, including an unknown key, refuses SLICE_INVALID', async t => {
  const p = await project(t); fs.appendFileSync(p.file, 'includes: [x]\n'); assert.deepEqual(await verify(p), { result: 'refused', code: 'SLICE_INVALID' });
  const q = await project(t); fs.writeFileSync(q.file, 'not: [valid'); assert.deepEqual(await verify(q), { result: 'refused', code: 'SLICE_INVALID' });
});
test('5. a link in slices/ refuses AUTHORING_UNSAFE_PATH', async t => {
  const p = await project(t); fs.symlinkSync(p.file, join(p.bowerloom, 'slices', 'link.yaml')); assert.deepEqual(await verify(p), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
  const q = await project(t); fs.rmSync(q.file); fs.symlinkSync('/etc/hosts', q.file); assert.deepEqual(await verify(q), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' });
});
test('a slices folder that others can write refuses AUTHORING_UNSAFE_PATH', async t => { const p = await project(t); fs.chmodSync(join(p.bowerloom, 'slices'), 0o777); assert.deepEqual(await verify(p), { result: 'refused', code: 'AUTHORING_UNSAFE_PATH' }); });
