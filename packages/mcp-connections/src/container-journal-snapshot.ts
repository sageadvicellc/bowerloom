import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { fail, sha256 } from './model.js';
function requireValue(value: unknown, code = 'INPUT'): asserts value { if (!value) fail('MCP_RECOVERY_COLLECTOR_' + code); }
const pin = (s: BigIntStats) => ({ dev: String(s.dev), ino: String(s.ino), uid: String(s.uid), gid: String(s.gid), mode: String(s.mode), nlink: String(s.nlink), size: String(s.size), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) });
const directoryPin = (s: BigIntStats) => ({ dev: String(s.dev), ino: String(s.ino), uid: String(s.uid), gid: String(s.gid), mode: String(s.mode) });
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
type Snapshot = { text: string | null; sha256: string | null; bytes: number; pins: unknown };
async function ancestors(path: string, privateRoot: string): Promise<Record<string, unknown>> {
  requireValue(await realpath(path) === path, 'FILESYSTEM');
  const result: Record<string, unknown> = {}, uid = BigInt(process.getuid!());
  for (let p = path; ; p = dirname(p)) {
    const stat = await lstat(p, { bigint: true });
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && (stat.uid === uid || stat.uid === 0n) && (stat.mode & 0o022n) === 0n, 'FILESYSTEM');
    if (p === privateRoot || p.startsWith(privateRoot + '/')) requireValue(stat.uid === uid && (stat.mode & 0o7777n) === 0o700n, 'FILESYSTEM');
    result[p] = directoryPin(stat); if (p === '/') break;
  }
  return result;
}
export async function snapshotContainerJournal(root: string, operationKey: string): Promise<Snapshot> {
  const rootPins = await ancestors(root, root), directory = join(root, operationKey.slice(7)), path = join(directory, 'journal.json');
  try {
    const directoryStat = await lstat(directory, { bigint: true });
    requireValue(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), 'FILESYSTEM');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    requireValue(same(rootPins, await ancestors(root, root)), 'FILESYSTEM_CHANGED');
    return { text: null, sha256: null, bytes: 0, pins: { rootPins, missing: 'operation-directory' } };
  }
  const before = await ancestors(directory, root);
  requireValue(Object.entries(rootPins).every(([p, value]) => same(value, before[p])), 'FILESYSTEM_CHANGED');
  let named: BigIntStats;
  try { named = await lstat(path, { bigint: true }); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    requireValue(same(before, await ancestors(directory, root)), 'FILESYSTEM_CHANGED');
    return { text: null, sha256: null, bytes: 0, pins: { before, missing: 'journal' } };
  }
  function file(s: BigIntStats): void {
    requireValue(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.uid === BigInt(process.getuid!()) && (s.mode & 0o7777n) === 0o600n && s.size > 0n && s.size <= 12288n, 'FILESYSTEM');
  }
  file(named);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat({ bigint: true }); file(first); requireValue(same(pin(named), pin(first)), 'FILESYSTEM_CHANGED');
    const buffer = Buffer.alloc(12289); let size = 0;
    for (;;) { const chunk = await handle.read(buffer, size, buffer.length - size, null); if (!chunk.bytesRead) break; size += chunk.bytesRead; requireValue(size <= 12288, 'FILESYSTEM'); }
    const after = await handle.stat({ bigint: true }), finalNamed = await lstat(path, { bigint: true }); file(after); file(finalNamed);
    requireValue(same(pin(first), pin(after)) && same(pin(first), pin(finalNamed)) && same(before, await ancestors(directory, root)), 'FILESYSTEM_CHANGED');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
    return { text, sha256: 'sha256:' + sha256(text), bytes: size, pins: { before, file: pin(first) } };
  } finally { await handle.close(); }
}
