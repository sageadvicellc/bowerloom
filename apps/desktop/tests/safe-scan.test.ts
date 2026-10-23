// Path rules and the folder scan: depth cap, symlink refusal, outside-root refusal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OutsideRoot, isId, isInside, isPlainName, resolveInside } from '../main/safe.js';
import { SCAN_LIMITS, scanRoots } from '../main/scan.js';
import { tempDir } from './support.js';

const project = (dir: string): void => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'bowerloom.json'), '{}\n'); };

test('isInside accepts the root and what is below it, and nothing else', () => {
  assert.equal(isInside('/a/b', '/a/b'), true); assert.equal(isInside('/a/b', '/a/b/c/d'), true);
  assert.equal(isInside('/a/b', '/a/bc'), false); assert.equal(isInside('/a/b', '/a'), false); assert.equal(isInside('/a/b', '/a/b/../c'), false); assert.equal(isInside('a', '/a'), false);
});

test('resolveInside refuses a path outside every root', t => {
  const base = tempDir(t); mkdirSync(join(base, 'root')); mkdirSync(join(base, 'other'));
  assert.equal(resolveInside([join(base, 'root')], join(base, 'root')), join(base, 'root'));
  assert.throws(() => resolveInside([join(base, 'root')], join(base, 'other')), (e: unknown) => e instanceof OutsideRoot && e.code === 'OUTSIDE_ROOT');
  assert.throws(() => resolveInside([join(base, 'root')], join(base, 'root', '..', 'other')), (e: unknown) => e instanceof OutsideRoot);
  assert.throws(() => resolveInside([join(base, 'root')], 'relative/path'), OutsideRoot);
  assert.throws(() => resolveInside([join(base, 'root')], join(base, 'root', 'missing')), (e: unknown) => e instanceof OutsideRoot && e.code === 'NOT_FOUND');
  assert.throws(() => resolveInside([join(base, 'gone')], join(base, 'root')), OutsideRoot);
});

test('resolveInside refuses a path that goes through a link, even when the link stays inside the root', t => {
  const base = tempDir(t), root = join(base, 'root'); mkdirSync(join(root, 'real'), { recursive: true }); mkdirSync(join(base, 'outside'));
  symlinkSync(join(root, 'real'), join(root, 'inner-link')); symlinkSync(join(base, 'outside'), join(root, 'out-link'));
  assert.throws(() => resolveInside([root], join(root, 'inner-link')), (e: unknown) => e instanceof OutsideRoot && e.code === 'THROUGH_LINK');
  assert.throws(() => resolveInside([root], join(root, 'out-link')), (e: unknown) => e instanceof OutsideRoot);
  assert.equal(resolveInside([root], join(root, 'real')), join(root, 'real'));
});

test('names and ids', () => {
  for (const ok of ['house-style', 'a', 'a1-b2']) assert.equal(isId(ok), true);
  for (const bad of ['../x', 'A', 'a--b', '-a', 'a/b', '', 'a'.repeat(65), 'a b', 'a\0', 7, null]) assert.equal(isId(bad), false, String(bad));
  assert.equal(isPlainName('x.md'), true); for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a\0b', 'a\nb']) assert.equal(isPlainName(bad), false);
});

test('scan finds projects by their marker files and stops inside a project', t => {
  const base = tempDir(t);
  project(join(base, 'a')); project(join(base, 'work', 'b')); mkdirSync(join(base, 'c', '.bowerloom'), { recursive: true });
  writeFileSync(join(base, 'work', 'b', 'inner-file'), 'x'); project(join(base, 'work', 'b', 'nested'));
  mkdirSync(join(base, 'empty'));
  mkdirSync(join(base, 'lockonly2')); writeFileSync(join(base, 'lockonly2', 'bowerloom.lock.json'), '{}');
  const r = scanRoots([base]);
  assert.deepEqual(r.dirs.map(d => d.slice(base.length)).sort(), ['/a', '/c', '/lockonly2', '/work/b']);
  assert.equal(r.info.found, 4); assert.equal(r.info.truncated, false); assert.equal(r.info.roots[0]!.ok, true);
});

test('scan depth is capped', t => {
  const base = tempDir(t);
  project(join(base, 'l1', 'l2', 'l3')); project(join(base, 'l1', 'l2', 'l3', 'l4', 'l5', 'too-deep'));
  assert.deepEqual(scanRoots([base]).dirs.map(d => d.slice(base.length)), ['/l1/l2/l3']);
  assert.equal(SCAN_LIMITS.depth, 4);
  const deep = join(base, 'd1', 'd2', 'd3', 'd4', 'd5', 'd6'); project(deep);
  assert.deepEqual(scanRoots([join(base, 'd1')]).dirs, [], 'a project five levels down is not found');
  assert.deepEqual(scanRoots([join(base, 'd1')], { depth: 5 }).dirs.length, 1);
  assert.deepEqual(scanRoots([base], { depth: 0 }).dirs, []);
});

test('scan skips node_modules and hidden folders', t => {
  const base = tempDir(t); project(join(base, 'node_modules', 'pkg')); project(join(base, '.hidden', 'p')); project(join(base, 'visible'));
  assert.deepEqual(scanRoots([base]).dirs.map(d => d.slice(base.length)), ['/visible']);
});

test('scan never follows a link: not a linked project, not a linked folder, not a linked root', t => {
  const base = tempDir(t), outside = join(base, 'outside'), root = join(base, 'root');
  project(join(outside, 'secret-project')); mkdirSync(root); project(join(root, 'real'));
  symlinkSync(join(outside, 'secret-project'), join(root, 'linked-project')); symlinkSync(outside, join(root, 'linked-folder'));
  const r = scanRoots([root]);
  assert.deepEqual(r.dirs.map(d => d.slice(root.length)), ['/real']);
  assert.equal(r.info.skipped.length, 2); assert.ok(r.info.skipped.every(s => /link/.test(s.reason)));
  const viaRoot = scanRoots([join(base, 'root-link-does-not-exist')]); assert.equal(viaRoot.info.roots[0]!.ok, false);
  symlinkSync(outside, join(base, 'root-link'));
  const linked = scanRoots([join(base, 'root-link')]);
  assert.deepEqual(linked.dirs, []); assert.equal(linked.info.roots[0]!.ok, false); assert.match(linked.info.roots[0]!.reason!, /shortcut/);
});

test('scan caps the number of results and says so', t => {
  const base = tempDir(t); for (let i = 0; i < 7; i++) project(join(base, `p${i}`));
  const r = scanRoots([base], { results: 3 }); assert.equal(r.dirs.length, 3); assert.equal(r.info.truncated, true);
  const e = scanRoots([base], { entries: 2 }); assert.equal(e.info.truncated, true);
});

test('scan reports a root that is gone or is a file', t => {
  const base = tempDir(t); writeFileSync(join(base, 'file'), 'x');
  const r = scanRoots([join(base, 'gone'), join(base, 'file')]);
  assert.deepEqual(r.info.roots.map(x => x.ok), [false, false]); assert.deepEqual(r.dirs, []);
});

test('scan says when the depth limit hid folders, when a folder could not be opened, and when links were skipped', t => {
  const base = tempDir(t); mkdirSync(join(base, 'a', 'b', 'c', 'd', 'e', 'f'), { recursive: true });
  const r = scanRoots([base]); assert.equal(r.info.depthReached, true); assert.equal(r.info.depthLimit, 4);
  const shallow = tempDir(t); mkdirSync(join(shallow, 'a', 'b'), { recursive: true }); assert.equal(scanRoots([shallow]).info.depthReached, false);
  const locked = tempDir(t); mkdirSync(join(locked, 'closed')); chmodSync(join(locked, 'closed'), 0o000);
  try { const l = scanRoots([locked]); assert.ok(l.info.skipped.some(x => /cannot be opened/.test(x.reason))); } finally { chmodSync(join(locked, 'closed'), 0o700); }
  const many = tempDir(t); for (let i = 0; i < 60; i++) symlinkSync(base, join(many, `l${i}`));
  assert.equal(scanRoots([many]).info.skippedMore, true);
});

test('a root is matched as a whole folder name: a folder whose name only starts the same is not inside it', t => {
  const base = tempDir(t); mkdirSync(join(base, 'root')); mkdirSync(join(base, 'root-evil', 'x'), { recursive: true });
  assert.throws(() => resolveInside([join(base, 'root')], join(base, 'root-evil', 'x')), (e: unknown) => e instanceof OutsideRoot && e.code === 'OUTSIDE_ROOT');
  symlinkSync(join(base, 'root-evil'), join(base, 'root', 'in'));
  assert.throws(() => resolveInside([join(base, 'root')], join(base, 'root', 'in', 'x')), OutsideRoot);
});
