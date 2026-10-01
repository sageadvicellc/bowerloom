import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { assertPortablePath } from '../../contracts/src/index.js';
import { fail } from './contracts.js';

/** Read one bounded, non-linked source within a caller-selected stable root. No source text is executed. */
export async function readSource(root: string, path: string, limit: number): Promise<string> {
  assertPortablePath(path);
  let target = root;
  for (const [index, part] of path.split('/').entries()) {
    target = resolve(target, part);
    const entry = await lstat(target).catch(() => fail('AUTHORING_FILE_UNAVAILABLE'));
    if (entry.isSymbolicLink() || (index < path.split('/').length - 1 ? !entry.isDirectory() : !entry.isFile())) fail('AUTHORING_FILE_TYPE');
  }
  if (await realpath(target) !== target) fail('AUTHORING_SOURCE_CHANGED');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) fail('AUTHORING_FILE_TYPE');
    if (before.size > limit) fail('AUTHORING_LIMIT');
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const result = await handle.read(bytes, size, bytes.length - size, null); if (!result.bytesRead) break; size += result.bytesRead; }
    const after = await handle.stat(), current = await lstat(target);
    if (size > limit) fail('AUTHORING_LIMIT');
    if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || current.ino !== after.ino || current.dev !== after.dev || current.isSymbolicLink() || await realpath(target) !== target) fail('AUTHORING_SOURCE_CHANGED');
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)); } catch { fail('AUTHORING_ENCODING'); }
  } finally { await handle.close(); }
}
export async function sourceLocation(file: string, requestedRoot = dirname(resolve(file))): Promise<{ root: string; path: string }> {
  const root = await realpath(resolve(requestedRoot));
  const path = relative(resolve(requestedRoot), resolve(file)).split(sep).join('/');
  assertPortablePath(path);
  return { root, path };
}
