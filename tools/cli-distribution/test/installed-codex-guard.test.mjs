import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectInstalledCodex } from '../installed-codex-guard.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-codex-identity-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['index','boundary','installation','policy','supervisor','guardian'].map(name => {
    const path = `dist/packages/codex-adapter/src/${name}.js`, bytes = Buffer.from('export const inert = true;\n');
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root,path),bytes);
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  });
  const manifest = { schema:'bowerloom/cli-distribution/v0.1', name:'bowerloom', private:true, version:'0.7.0-alpha.0', files };
  function save() { const bytes=JSON.stringify(manifest); writeFileSync(join(root,'DISTRIBUTION.json'),bytes); return sha(bytes); }
  return { root, manifest, save, pins: { root, distributionSha256:save(), tarballSha256:'a'.repeat(64) } };
}
test('host-pinned complete installed inventory is measured without importing package code', t => {
  const f=fixture(t), identity=inspectInstalledCodex(f.pins);
  assert.equal(identity.files.length,6); assert.equal(identity.root,f.root); assert.ok(Object.isFrozen(identity.files));
});
test('changed installed bytes and changed manifest refuse even with unchanged path', t => {
  const f=fixture(t); writeFileSync(join(f.root,f.manifest.files[0].path),'changed');
  assert.throws(()=>inspectInstalledCodex(f.pins),/IDENTITY_REJECTED/);
  f.manifest.files[0].sha256=sha('changed');f.manifest.files[0].bytes=7;f.save();
  assert.throws(()=>inspectInstalledCodex(f.pins),/IDENTITY_REJECTED/);
});
test('missing guardian, duplicate path and traversal are rejected', t => {
  for(const mutate of [f=>f.manifest.files.pop(), f=>f.manifest.files.push(f.manifest.files[0]), f=>f.manifest.files[0].path='../outside']) {
    const f=fixture(t);mutate(f);f.pins.distributionSha256=f.save();assert.throws(()=>inspectInstalledCodex(f.pins),/IDENTITY_REJECTED/);
  }
});
test('symlink replacement refuses without reading its target',t=>{
  const f=fixture(t), file=join(f.root,f.manifest.files[0].path);rmSync(file);symlinkSync('/dev/null',file);
  assert.throws(()=>inspectInstalledCodex(f.pins),/IDENTITY_REJECTED/);
});
