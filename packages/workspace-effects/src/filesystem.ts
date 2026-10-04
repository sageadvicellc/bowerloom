import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, realpath, open, link, unlink, rename } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson, digest } from '../../contracts/src/index.js';
import { BROKER_LIMITS } from '../../broker/src/index.js';
import type { EffectRequest } from '../../broker/src/index.js';
import { identifier, registeredPath, WorkspaceEffectError } from './validation.js';

export interface WorkspaceRegistration { workspaceId: string; root: string; writablePaths: string[] }
type Directory = { path: string; device: string; inode: string };
export interface RegisteredWorkspace { workspaceId: string; root: string; paths: Set<string>; directories: Directory[]; binding: string }
export interface Snapshot { digest: string | null; identity: string | null }
const identity = (stat: BigIntStats): string => canonicalJson({ device: String(stat.dev), inode: String(stat.ino), size: String(stat.size),
  modified: String(stat.mtimeNs), changed: String(stat.ctimeNs) });
function directory(stat: BigIntStats): void {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid!()) || (stat.mode & 0o077n) !== 0n) {
    throw new WorkspaceEffectError('UNSAFE_DIRECTORY', 'Workspace directories must be private, owned, and free of symlinks.');
  }
}
function file(stat: BigIntStats): void {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== BigInt(process.getuid!()) || stat.size > BigInt(BROKER_LIMITS.contentBytes)) {
    throw new WorkspaceEffectError('UNSAFE_TARGET', 'A target must be a bounded, owned regular file with one link.');
  }
}
export async function register(inputs: WorkspaceRegistration[]): Promise<Map<string, RegisteredWorkspace>> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new WorkspaceEffectError('UNSUPPORTED_PLATFORM', 'This experimental adapter needs POSIX file flags.');
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 16) throw new WorkspaceEffectError('INVALID_REGISTRY', 'Register between one and sixteen workspaces.');
  const registry = new Map<string, RegisteredWorkspace>();
  try {
    for (const input of structuredClone(inputs)) {
      if (!identifier(input.workspaceId) || registry.has(input.workspaceId) || typeof input.root !== 'string' || !isAbsolute(input.root)
        || resolve(input.root) !== input.root || await realpath(input.root) !== input.root
        || !Array.isArray(input.writablePaths) || input.writablePaths.length < 1 || input.writablePaths.length > 128
        || new Set(input.writablePaths).size !== input.writablePaths.length) throw new Error('registry');
      for (const prior of registry.values()) if (input.root === prior.root || input.root.startsWith(prior.root + sep) || prior.root.startsWith(input.root + sep)) throw new Error('overlap');
      const paths = [...input.writablePaths].sort(); const directories = new Set([input.root]);
      for (const path of paths) {
        registeredPath(path);
        let parent = dirname(join(input.root, path));
        while (parent !== input.root) { directories.add(parent); parent = dirname(parent); }
      }
      const identities: Directory[] = [];
      for (const path of [...directories].sort()) {
        const stat = await lstat(path, { bigint: true }); directory(stat);
        if (await realpath(path) !== path) throw new Error('alias');
        identities.push({ path, device: String(stat.dev), inode: String(stat.ino) });
      }
      const binding = digest(canonicalJson({ root: input.root, paths, directories: identities }));
      registry.set(input.workspaceId, { workspaceId: input.workspaceId, root: input.root, paths: new Set(paths), directories: identities, binding });
    }
    return registry;
  } catch { throw new WorkspaceEffectError('INVALID_REGISTRY', 'Register only distinct, existing private workspace directories and safe lowercase file paths.'); }
}
export async function verifyDirectories(workspace: RegisteredWorkspace): Promise<void> {
  try {
    for (const saved of workspace.directories) {
      const stat = await lstat(saved.path, { bigint: true }); directory(stat);
      if (String(stat.dev) !== saved.device || String(stat.ino) !== saved.inode || await realpath(saved.path) !== saved.path) throw new Error('identity');
    }
  } catch { throw new WorkspaceEffectError('DIRECTORY_CHANGED', 'A registered directory is unsafe or no longer has its registered identity.'); }
}
export async function snapshot(workspace: RegisteredWorkspace, path: string): Promise<Snapshot> {
  const target = join(workspace.root, path);
  let initial: BigIntStats;
  try { initial = await lstat(target, { bigint: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { digest: null, identity: null };
    throw new WorkspaceEffectError('UNSAFE_TARGET', 'The target cannot be inspected safely.');
  }
  file(initial);
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true }); file(before);
    if (identity(initial) !== identity(before)) throw new Error('changed');
    const bytes = Buffer.alloc(BROKER_LIMITS.contentBytes + 1); let count = 0;
    while (count < bytes.length) {
      const read = await handle.read(bytes, count, bytes.length - count, count);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    const after = await handle.stat({ bigint: true }); file(after);
    if (count > BROKER_LIMITS.contentBytes || identity(before) !== identity(after) || BigInt(count) !== before.size) throw new Error('changed');
    return { digest: digest(bytes.subarray(0, count)), identity: identity(before) };
  } catch { throw new WorkspaceEffectError('UNSAFE_TARGET', 'The target changed or could not be read safely.'); }
  finally { await handle.close(); }
}

// Path-based POSIX calls require the documented sole-writer directory assumption.
// This is not protection against a hostile process swapping directories between checks.
export async function publish(workspace: RegisteredWorkspace, request: EffectRequest, before: Snapshot, active: () => void): Promise<boolean> {
  const path = request.proposal.edit.path; const target = join(workspace.root, path);
  const parent = dirname(target); const temporary = join(parent, `.trellis-${randomUUID()}.tmp`);
  let temporaryIdentity: { device: bigint; inode: bigint } | null = null;
  try {
    active(); await verifyDirectories(workspace);
    if (canonicalJson(await snapshot(workspace, path)) !== canonicalJson(before)) return false;
    active();
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await handle.stat({ bigint: true }); temporaryIdentity = { device: stat.dev, inode: stat.ino };
      await handle.writeFile(request.proposal.edit.content, 'utf8'); await handle.sync();
    } finally { await handle.close(); }
    await verifyDirectories(workspace);
    if (canonicalJson(await snapshot(workspace, path)) !== canonicalJson(before)) return false;
    active();
    if (before.digest === null) {
      try { await link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      await unlink(temporary);
    } else { await rename(temporary, target); }
    temporaryIdentity = null;
    const directoryHandle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    return true;
  } finally {
    if (temporaryIdentity) {
      // Never follow a changed directory merely to clean up a staging file.
      await verifyDirectories(workspace);
      const stat = await lstat(temporary, { bigint: true });
      if (stat.dev !== temporaryIdentity.device || stat.ino !== temporaryIdentity.inode || !stat.isFile()) {
        throw new WorkspaceEffectError('STAGING_CHANGED', 'The staging file cannot be safely removed.');
      }
      await unlink(temporary);
    }
  }
}
