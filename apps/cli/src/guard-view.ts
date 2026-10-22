/**
 * Loads what the read guard needs from the project (spec 05, section 3.9.1, steps 4 to 6): that the project is the one
 * the copy was written for, that the agent and each slice are installed and unchanged, and where each slice root is.
 * Reads only; it creates no folder. Any failure is a state the decision turns into a deny.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { catalogPath, currentV2 } from '../../../packages/managed-skills/src/v2-observed.js';
import { identityFrom, projectId } from '../../../packages/project-context/src/discovery.js';
import type { GuardSliceView, GuardView } from '../../../packages/context-slices/src/guard.js';
import { isFolderName, validRootPath } from '../../../packages/context-slices/src/slice-file.js';
import { resolveRegisteredRoot } from '../../../packages/project-context/src/registered-folders.js';
import { nodeGuardFs } from './guard-fs.js';

export interface GuardArgs { role: string; project: string; projectId: string; slices: string[]; roots: string[] }

/** A reference of a slice catalog: a member path, a covered folder (ending in `/`), or `./`. Spaces and Unicode are fine; a hidden or climbing segment is not. */
export function safeReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 1024 || value.startsWith('/') || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\\]/u.test(value)) return false;
  if (value === './') return true;
  return (value.endsWith('/') ? value.slice(0, -1) : value).split('/').every(s => s !== '' && !s.startsWith('.'));
}
/** An unexpected system error (EACCES, EIO, ELOOP...) is not a missing file: it ends the call as an internal error, never as a mismatch. */
function unexpected(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^E[A-Z0-9]+$/.test(code) && code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
const realFolder = (p: string): fs.BigIntStats => { const s = fs.lstatSync(p, { bigint: true }); if (s.isSymbolicLink() || !s.isDirectory()) throw new Error('not a real folder'); return s; };

/** The catalog of an installed item, read once and checked against the catalog pin of its current receipt. */
function installedCatalog(project: string, itemsRoot: string, ref: { kind: 'agent' | 'slice'; id: string }): Record<string, any> | null {
  const receipt = currentV2(project, join(itemsRoot, `${ref.kind}_${ref.id}`), ref);
  if (receipt === null) return null;
  const bytes = fs.readFileSync(catalogPath(project, ref)), pin = receipt.installed.find(s => s.id === 'catalog')?.pins?.[0];
  if (bytes.length > 262144 || !pin || pin.sha256 !== sha(bytes)) return null;
  const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), 262144) as Record<string, any>;
  return value.item?.kind === ref.kind && value.item?.id === ref.id ? value : null;
}

function sliceView(args: GuardArgs, itemsRoot: string, id: string, expectedRoot: string | undefined, home: string, stateRoot: string): GuardSliceView {
  const lost = (state: 'not-installed' | 'root-missing' | 'not-allowed', mode: 'root' | 'none' = 'root', folder?: string): GuardSliceView => ({ id, mode, state, root: '', display: '', prefix: '', members: [], covered: [], ...(folder !== undefined ? { folder } : {}) });
  let catalog: Record<string, any> | null, mode: 'root' | 'none', rootPath: string, registered: string | null, members: string[], covered: string[];
  try {
    catalog = installedCatalog(args.project, itemsRoot, { kind: 'slice', id });
    if (catalog === null) return lost('not-installed');
    const source = catalog.source, refs = catalog.references;
    if (source?.kind !== 'slice' || (source.guard !== 'root' && source.guard !== 'none') || (source.root?.kind !== 'project' && source.root?.kind !== 'registered') || !validRootPath(source.root.path)
      || (source.root.kind === 'registered' ? !isFolderName(source.root.name) : false) || !Array.isArray(refs) || refs.length > 4096 || !refs.every(safeReference)) return lost('not-installed');
    mode = source.guard; rootPath = source.root.path; registered = source.root.kind === 'registered' ? source.root.name : null;
    members = refs.filter((r: string) => !r.endsWith('/')); covered = refs.filter((r: string) => r.endsWith('/'));
  } catch (error) { unexpected(error); return lost('not-installed'); }
  try {
    // A registered folder resolves through the store, as apply resolved it. A project root is walked from the project folder.
    // Either way the root's id must be the one the copy names, so a folder that was replaced since apply denies every call.
    let real: string, display: string;
    if (registered !== null) {
      const found = resolveRegisteredRoot(home, registered, rootPath, { projectId: args.projectId, stateRoot });
      if (!found.ok) {
        if (found.code === 'FOLDER_NOT_ALLOWED') return lost('not-allowed', mode, registered);
        // A fault of the system, such as a record that cannot be read, is not a verdict about the folder: it ends the call as an internal error.
        if (found.cause !== undefined) throw Object.assign(new Error('unreadable'), { code: /^E[A-Z0-9]+$/.test(found.cause) ? found.cause : 'EACCES' });
        return lost('root-missing', mode);
      }
      real = fs.realpathSync(found.dir); display = relative(args.project, real);
    } else {
      let at = args.project;
      for (const seg of rootPath === '.' ? [] : rootPath.split('/')) { at = join(at, seg); realFolder(at); }
      real = fs.realpathSync(at); display = rootPath === '.' ? 'the project folder' : rootPath;
    }
    if (expectedRoot === undefined || projectId(real, identityFrom(realFolder(real))) !== expectedRoot) return lost('root-missing', mode);
    return { id, mode, state: 'ok', root: real, display, prefix: registered !== null ? display : rootPath === '.' ? '' : rootPath, members, covered };
  } catch (error) { unexpected(error); return lost('root-missing', mode); }
}

/** Steps 4 to 6 of the hook form. Never throws: a failure is `projectOk: false` or a slice state. */
/** `explain` skips the check that the agent copy lists these slices, because `--explain --slice` may name any installed slice. */
export function loadGuardView(args: GuardArgs, stateRoot: string, options: { explain?: boolean; home?: string } = {}): GuardView {
  const fsView = nodeGuardFs();
  try {
    const s = fs.lstatSync(args.project, { bigint: true });
    if (!s.isDirectory() || s.isSymbolicLink() || fs.realpathSync(args.project) !== args.project) return { projectOk: false, slices: [], fs: fsView };
    realFolder(join(args.project, '.bowerloom'));
    if (projectId(args.project, identityFrom(s)) !== args.projectId) return { projectOk: false, slices: [], fs: fsView };
    const itemsRoot = join(stateRoot, args.projectId, 'items'), agent = installedCatalog(args.project, itemsRoot, { kind: 'agent', id: args.role });
    if (agent === null || (options.explain !== true && (!Array.isArray(agent.source?.guard) || !same(agent.source.guard, args.slices)))) return { projectOk: false, slices: [], fs: fsView };
    const roots = new Map(args.roots.map(r => [r.slice(0, r.lastIndexOf(':')), r.slice(r.lastIndexOf(':') + 1)] as const));
    return { projectOk: true, slices: args.slices.map(id => sliceView(args, itemsRoot, id, roots.get(id), options.home ?? homedir(), stateRoot)), fs: fsView };
  } catch (error) { unexpected(error); return { projectOk: false, slices: [], fs: fsView }; }
}
