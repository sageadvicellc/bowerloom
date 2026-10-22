/**
 * Guarded reads of authored content: a local skill folder under `.bowerloom/skills/<id>/` and a prompt at
 * `.bowerloom/prompts/<name>.md`. Every read refuses a symlink, a second hard link, a foreign owner, group or
 * world write, special mode bits and oversize content, and a closing pass refuses any change during the read.
 * The result is content only, so two machines with the same authored bytes produce the same closure.
 *
 * Spec 06: the same readers serve a folder laid out like a store, the live store `~/.bowerloom` or a store cache folder,
 * through `root`. A store origin adds the file rules a lock can record (`storeFileFault`): at most 126 files of 65536 bytes,
 * 2 MiB in all, each a listed text type, not empty, no byte order mark, UTF-8, and no execute bit. Its closure source is
 * `store` or `store-prompt`, and names no folder.
 */
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { relativeSkillPath, freezeSkillData } from '../../skill-sources/src/validation.js';
import { LIMITS, check, boundary, hash, same, identity, names, path as projectPath } from './observed.js';
import { claudeCopyBytes } from './agent-copy.js';
import { STORE_FILE_LIMITS, storeFileFault } from '../../skill-manifest/src/content.js';
import { identityFrom, projectId } from '../../project-context/src/discovery.js';
import { parseSlice, SLICE_LIMITS } from '../../context-slices/src/slice-file.js';
import type { SliceDefinition } from '../../context-slices/src/slice-file.js';
import { resolveSlice, SliceTreeError } from '../../context-slices/src/resolve.js';
import type { EntryInfo, SliceResolution, TreeReader } from '../../context-slices/src/resolve.js';
import { renderSliceIndex } from '../../context-slices/src/render.js';
import { ManagedSkillError } from './observed.js';
import type { Identity } from './observed-types.js';
import type { AgentGuardSource, ItemFile, InventoryRow, LocalClosure, RegisteredLookup, RootIdentity, SliceRequestRoot } from './v2-types.js';

export const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function itemName(value: unknown): asserts value is string { check(typeof value === 'string' && value.length <= 64 && ITEM_ID.test(value)); }
const LOCAL = Object.freeze({ files: 128, entries: 512, bytes: 2 * 1024 * 1024, depth: 8 });

interface Pin { path: string; identity: Identity; size: string; mtimeNs: string; ctimeNs: string }
/** Where the authored item is read from: `.bowerloom` of the project (the default) or a folder laid out like a store. */
export interface ItemRoot { bowerloom: string; origin: 'project' | 'store' }
const owned = (s: fs.BigIntStats): boolean => Number(s.uid) === process.getuid?.() && (Number(s.mode) & 0o7022) === 0;
const pinOf = (p: string, s: fs.BigIntStats): Pin => ({ path: p, identity: identity(s), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
function folder(p: string): Pin { const s = fs.lstatSync(p, { bigint: true }); check(!s.isSymbolicLink() && s.isDirectory() && owned(s)); return pinOf(p, s); }
/** One authored file: O_NOFOLLOW, one link, owner, no group or world write, bounded, unchanged across the read. */
function authored(p: string, max: number, ignoreBOM = false): { text: string; bytes: Buffer; pin: Pin } {
  const got = authoredBytes(p, max);
  return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM }).decode(got.bytes), bytes: got.bytes, pin: got.pin };
}
/** The bytes of `authored`, undecoded, so that a caller can count a file that is not text instead of refusing it. */
function authoredBytes(p: string, max: number): { bytes: Buffer; pin: Pin } {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true }); check(before.isFile() && before.nlink === 1n && before.size >= 0n && before.size <= BigInt(max) && owned(before));
    const bytes = Buffer.alloc(Number(before.size)); let at = 0; while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); check(n > 0); at += n; }
    check(fs.readSync(fd, Buffer.alloc(1), 0, 1, null) === 0); const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(p, { bigint: true });
    check(!named.isSymbolicLink() && named.nlink === 1n && owned(after) && owned(named) && same(pinOf(p, before), pinOf(p, after)) && same(pinOf(p, before), pinOf(p, named)));
    return { bytes, pin: pinOf(p, before) };
  } finally { fs.closeSync(fd); }
}
/** The closing pass: the same entries with the same identities, sizes and times. */
function closing(pins: Pin[], live: () => void): void {
  for (const pin of pins) { live(); const s = fs.lstatSync(pin.path, { bigint: true }); check(!s.isSymbolicLink() && owned(s) && same(pinOf(pin.path, s), pin)); }
}
const byPath = <T extends { path: string }>(rows: T[]): T[] => rows.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
function closure(source: LocalClosure['source'], files: ItemFile[], sourceSha256?: string, references: string[] = []): LocalClosure {
  const sorted = byPath(files), inventory: InventoryRow[] = sorted.map(f => ({ path: f.path, sha256: f.sha256, bytes: Buffer.byteLength(f.text) }));
  return freezeSkillData({ format: 'bowerloom/local-item-closure/v1beta2', source, files: sorted, inventory, references, executionAuthorized: false, ...(sourceSha256 === undefined ? {} : { sourceSha256 }) });
}
/** The fixed folders from the project down to `.bowerloom/<area>`, or from a store folder down to `<area>`. */
function base(projectDir: string, area: 'skills' | 'prompts' | 'teams' | 'slices', pins: Pin[], root?: ItemRoot): string {
  projectPath(projectDir); const s = fs.lstatSync(projectDir, { bigint: true }); check(s.isDirectory() && !s.isSymbolicLink() && Number(s.uid) === process.getuid?.() && !(Number(s.mode) & 0o7022));
  const bowerloom = rootOf(projectDir, root); if (root !== undefined) projectPath(bowerloom);
  const at = join(bowerloom, area); pins.push(folder(bowerloom), folder(at)); return at;
}
const rootOf = (projectDir: string, root?: ItemRoot): string => root === undefined ? join(projectDir, '.bowerloom') : root.bowerloom;
const isStore = (root?: ItemRoot): boolean => { check(root === undefined || (root !== null && typeof root === 'object' && typeof root.bowerloom === 'string' && (root.origin === 'project' || root.origin === 'store'))); return root?.origin === 'store'; };
/** The store file rules of one file. */
function storeFile(path: string, bytes: Buffer, mode: number): void { check(storeFileFault(path, bytes, mode) === null); }

export function readLocalSkill(projectDir: string, relPath: string, live: () => void, from?: ItemRoot): LocalClosure {
  try {
    const store = isStore(from);
    check(typeof relPath === 'string' && relPath.startsWith('skills/')); const id = relPath.slice('skills/'.length); itemName(id);
    const pins: Pin[] = []; live(); const root = join(base(projectDir, 'skills', pins, from), id), files: ItemFile[] = []; let bytes = 0, entries = 0;
    const visit = (abs: string, rel: string, depth: number): void => {
      live(); check(++entries <= LOCAL.entries && depth <= LOCAL.depth); const s = fs.lstatSync(abs, { bigint: true }); check(!s.isSymbolicLink());
      // A folder is never skipped silently: a hidden name refuses as a hidden file does, and so does an empty folder.
      if (s.isDirectory()) { pins.push(folder(abs)); if (rel) relativeSkillPath(rel); const children = names(abs); check(children.length > 0); for (const n of children) visit(join(abs, n), rel ? rel + '/' + n : n, depth + 1); return; }
      relativeSkillPath(rel); const got = authored(abs, LIMITS.file); pins.push(got.pin);
      if (store) { storeFile(rel, got.bytes, got.pin.identity.mode); check(files.length < STORE_FILE_LIMITS.files && bytes + got.bytes.length <= STORE_FILE_LIMITS.totalBytes); }
      bytes += Buffer.byteLength(got.text); check(files.length < LOCAL.files && bytes <= LOCAL.bytes);
      files.push({ path: rel, text: got.text, sha256: hash(got.text), mode: 420 });
    };
    visit(root, '', 0); check(files.some(f => f.path === 'SKILL.md')); closing(pins, live); live();
    return closure(store ? { kind: 'store', path: relPath } : { kind: 'local', path: relPath }, files);
  } catch (e) { return boundary(e); }
}

export function readLocalPrompt(projectDir: string, name: string, live: () => void, from?: ItemRoot): LocalClosure {
  try {
    const store = isStore(from);
    itemName(name); const pins: Pin[] = []; live(); const file = join(base(projectDir, 'prompts', pins, from), name + '.md');
    const got = authored(file, LIMITS.file); pins.push(got.pin);
    if (store) storeFile(name + '.md', got.bytes, got.pin.identity.mode);
    closing(pins, live); live();
    return closure({ kind: store ? 'store-prompt' : 'prompt', path: 'prompts/' + name + '.md' }, [{ path: name + '.md', text: got.text, sha256: hash(got.text), mode: 420 }]);
  } catch (e) { return boundary(e); }
}

/**
 * One team agent, `.bowerloom/teams/<team>/agents/<role>.md` (spec 01a). The folders down to `agents/` are pinned. The
 * one file is read with the prompt rules, and a leading byte order mark stays in the text so that the parser can refuse
 * it. The closure file is the Claude copy of the source.
 */
/** The project id of a project folder: the first 32 hex characters of sha256 over its real path, device and inode. */
export function projectIdOfDir(projectDir: string): string { return projectId(projectDir, identityFrom(fs.lstatSync(projectDir, { bigint: true }))); }
export function readLocalAgent(projectDir: string, team: string, role: string, live: () => void, guard: AgentGuardSource | null = null): LocalClosure {
  try {
    itemName(role); itemName(team); const pins: Pin[] = []; live();
    const teamDir = join(base(projectDir, 'teams', pins), team), agents = join(teamDir, 'agents'); pins.push(folder(teamDir), folder(agents));
    const got = authored(join(agents, role + '.md'), LIMITS.file, true); pins.push(got.pin); closing(pins, live); live();
    const extras = guard === null ? null : { role, slices: guard.slices, roots: guard.roots, projectDir, projectId: projectIdOfDir(projectDir) };
    const text = claudeCopyBytes(got.text, { guard: extras });
    return closure({ kind: 'agent', path: `teams/${team}/agents/${role}.md`, guard: guard === null ? null : guard.slices }, [{ path: role + '.md', text, sha256: hash(text), mode: 420 }], hash(got.text));
  } catch (e) { return boundary(e); }
}

/** What `readSliceTree` found. A hold is a reason that the slice cannot be applied; it is never thrown. */
export interface SliceTreeResult {
  definition: SliceDefinition | null;
  /** The sha256 and size of the slice file when it was read. */
  file: { sha256: string; bytes: number } | null;
  resolution: SliceResolution;
  index: string | null;
  hold: { code: string; detail: string; errno?: string; inside?: boolean } | null;
  /** The absolute path of the root folder once it passed the folder checks, else null. */
  rootDir: string | null;
  /** For a registered root found through the store: the sha256 of its record. Null otherwise. */
  recordSha256: string | null;
}
const staleFile = (): never => { throw new ManagedSkillError('MANAGED_SKILL_STALE_APPROVAL'); };
const EMPTY: SliceResolution = Object.freeze({ members: [], covered: [], notes: { unparsed: [], unresolvedLinks: 0, ambiguousLinks: 0, emptyPatterns: [], notText: 0, oversize: [], skippedEntries: 0, truncatedLinks: 0 }, hold: null, readBytes: 0 }) as SliceResolution;

/** A tree reader over the real root folder. It pins what it reads, and `close` checks the pins again. */
class RootTree implements TreeReader {
  constructor(private root: string, private pins: Pin[], private live: () => void) {}
  /** A path that vanished or changed kind is a stale plan. Any other operating system error is a hold that names the path and the errno. */
  private fail(error: unknown, path: string): never {
    const errno = (error as NodeJS.ErrnoException | null)?.code;
    if (typeof errno !== 'string' || !/^E[A-Z0-9]+$/.test(errno) || errno === 'ENOENT' || errno === 'ENOTDIR') return staleFile();
    throw new SliceTreeError('SLICE_SOURCE_UNSAFE', path === '' ? '.' : path, errno);
  }
  list(dir: string): string[] {
    this.live(); const abs = dir === '' ? this.root : join(this.root, dir);
    let s: fs.BigIntStats; try { s = fs.lstatSync(abs, { bigint: true }); } catch (e) { return this.fail(e, dir); }
    if (s.isSymbolicLink() || !s.isDirectory() || !owned(s)) throw new SliceTreeError('SLICE_SOURCE_UNSAFE', dir === '' ? '.' : dir);
    let names: string[]; try { names = fs.readdirSync(abs); } catch (e) { return this.fail(e, dir); }
    if (names.length > LIMITS.names) throw new SliceTreeError('SLICE_TOO_LARGE', dir === '' ? '.' : dir);
    this.pins.push(pinOf(abs, s)); return names;
  }
  stat(path: string): EntryInfo | null {
    this.live(); const abs = path === '' ? this.root : join(this.root, path);
    let s: fs.BigIntStats; try { s = fs.lstatSync(abs, { bigint: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; return this.fail(e, path); }
    const type = s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other';
    return { type, size: Number(s.size), nlink: Number(s.nlink), safe: owned(s), id: `${s.dev}:${s.ino}` };
  }
  read(path: string): Uint8Array {
    this.live();
    try { const got = authoredBytes(join(this.root, path), SLICE_LIMITS.memberBytes); this.pins.push(got.pin); return got.bytes; } catch (e) { return this.fail(e, path); }
  }
  close(): void { closingStale(this.pins, this.live); }
}
/** The closing pass of a slice read: any change since the read is a stale plan, not a refusal. */
function closingStale(pins: Pin[], live: () => void): void {
  for (const pin of pins) {
    live(); let s: fs.BigIntStats; try { s = fs.lstatSync(pin.path, { bigint: true }); } catch { return staleFile(); }
    if (s.isSymbolicLink() || !owned(s) || !same(pinOf(pin.path, s), pin)) staleFile();
  }
}

/**
 * Reads `.bowerloom/slices/<name>.yaml`, resolves its root (spec 05, section 3.4), selects its files (section 3.5), and
 * renders the index. It never throws for a hold: a bad definition, a root that is gone or unsafe, or a selection that
 * fails comes back as `hold`. A change found by the closing pass throws MANAGED_SKILL_STALE_APPROVAL.
 *
 * A project root is walked from the project folder. A registered root comes from `registered`, the store lookup that the
 * planner passes in, or, in the child of an approved plan, from `root`, which names the folder and its identity: then the
 * live folder must still be that folder, or the read is stale. A registered root inside the project is a hold.
 */
export function readSliceTree(projectDir: string, name: string, root: SliceRequestRoot, live: () => void, registered?: RegisteredLookup): SliceTreeResult {
  try {
    const pins: Pin[] = []; live();
    const file = join(base(projectDir, 'slices', pins), name + '.yaml');
    let got: { text: string; pin: Pin };
    try { got = authored(file, SLICE_LIMITS.fileBytes); }
    catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return staleFile();
      return { definition: null, file: null, resolution: EMPTY, index: null, hold: { code: 'SLICE_INVALID', detail: 'the file cannot be read as a plain text file that you own, with one link, no write access for others, and at most 16 KiB' }, rootDir: null, recordSha256: null };
    }
    pins.push(got.pin);
    const info = { sha256: hash(got.text), bytes: Buffer.byteLength(got.text) };
    const parsed = parseSlice(got.text, name);
    if (!parsed.ok) { closingStale(pins, live); return { definition: null, file: info, resolution: EMPTY, index: null, hold: { code: parsed.code, detail: parsed.detail }, rootDir: null, recordSha256: null }; }
    const def = parsed.slice;
    const held = (hold: { code: string; detail: string; inside?: boolean }, recordSha256: string | null = null): SliceTreeResult => { closingStale(pins, live); return { definition: def, file: info, resolution: EMPTY, index: null, hold, rootDir: null, recordSha256 }; };
    let at: string, prefix: string, source: string, recordSha256: string | null = null;
    const rootPath = def.root.path;
    if (def.root.kind === 'project') {
      // The request says where the plan read; a file that now says another kind of root is a change since the plan.
      if (root.kind !== 'project') return staleFile();
      // The folders from the project down to the root must be real folders that only this user can change.
      at = projectDir;
      for (const seg of rootPath === '.' ? [] : rootPath.split('/')) {
        at = join(at, seg); let s: fs.BigIntStats;
        try { s = fs.lstatSync(at, { bigint: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return held({ code: 'SLICE_PATH_MISSING', detail: rootPath }); return staleFile(); }
        if (s.isSymbolicLink() || !s.isDirectory() || !owned(s)) return held({ code: 'SLICE_ROOT_UNSAFE', detail: rootPath });
        pins.push(pinOf(at, s));
      }
      prefix = rootPath === '.' ? '' : rootPath; source = rootPath === '.' ? 'the project folder' : rootPath;
    } else {
      const folderName = def.root.name;
      let identityWanted: RootIdentity | null = null;
      if (root.kind === 'registered') {
        if (root.name !== folderName) return staleFile();
        at = root.dir; identityWanted = root.identity;
      } else if (registered !== undefined) {
        const found = registered(folderName, rootPath);
        if (!found.ok) return held({ code: found.code, detail: found.detail });
        at = found.dir; recordSha256 = found.recordSha256;
      } else return held({ code: 'SLICE_ROOT_MISSING', detail: folderName });
      let s: fs.BigIntStats;
      try { s = fs.lstatSync(at, { bigint: true }); } catch (e) { const c = (e as NodeJS.ErrnoException).code; if (c === 'ENOENT' || c === 'ENOTDIR') return identityWanted !== null ? staleFile() : held({ code: 'SLICE_ROOT_MISSING', detail: folderName }); return staleFile(); }
      if (s.isSymbolicLink() || !s.isDirectory() || !owned(s)) return held({ code: 'SLICE_ROOT_UNSAFE', detail: at });
      if (identityWanted !== null) {
        const now = identity(s);
        if (now.device !== identityWanted.device || now.inode !== identityWanted.inode || now.birthtimeNs !== identityWanted.birthtimeNs) return staleFile();
      }
      // A registered folder inside the project would be a project root with a second name: use the project root.
      if (at === projectDir || at.startsWith(projectDir + '/')) return held({ code: 'SLICE_ROOT_UNSAFE', detail: relative(projectDir, at) || '.', inside: true });
      pins.push(pinOf(at, s));
      prefix = relative(projectDir, at); source = `${prefix} (registered folder ${folderName})`;
    }
    const resolution = resolveSlice(def, new RootTree(at, pins, live));
    closingStale(pins, live);
    // A path in a hold is named from the project folder, as the person writes it.
    const qualify = (detail: string): string => prefix === '' ? detail : detail === '.' ? prefix : `${prefix}/${detail}`;
    if (resolution.hold !== null) {
      const h = resolution.hold, named = h.code === 'SLICE_PATH_MISSING' || h.code === 'SLICE_SOURCE_UNSAFE';
      return { definition: def, file: info, resolution, index: null, hold: named ? { code: h.code, detail: qualify(h.detail), ...(h.errno === undefined ? {} : { errno: h.errno }) } : h, rootDir: at, recordSha256 };
    }
    const index = renderSliceIndex(name, def, resolution, { source, prefix });
    if (Buffer.byteLength(index) > SLICE_LIMITS.indexBytes) return { definition: def, file: info, resolution, index: null, hold: { code: 'SLICE_TOO_LARGE', detail: 'the index' }, rootDir: at, recordSha256 };
    return { definition: def, file: info, resolution, index, hold: null, rootDir: at, recordSha256 };
  } catch (e) { return boundary(e); }
}

/** One slice, as a closure: the index is the one file, and the members and covered folders are its references. */
export function readLocalSlice(projectDir: string, name: string, root: SliceRequestRoot, live: () => void): LocalClosure {
  try {
    const got = readSliceTree(projectDir, name, root, live);
    check(got.hold === null && got.definition !== null && got.index !== null);
    const def = got.definition!, index = got.index!;
    return closure({ kind: 'slice', path: `slices/${name}.yaml`, root: def.root, guard: def.guard }, [{ path: 'SKILL.md', text: index, sha256: hash(index), mode: 420 }], undefined, [...got.resolution.members.map(m => m.path), ...got.resolution.covered]);
  } catch (e) { return boundary(e); }
}
