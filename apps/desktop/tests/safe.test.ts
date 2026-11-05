// Path rules of main/safe.ts, which the real-setup reader and the folder checks use: refusal outside a root, refusal through a link, and plain names and ids.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { OutsideRoot, isId, isInside, isPlainName, resolveInside } from '../main/safe.js';
import { tempDir } from './support.js';

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
