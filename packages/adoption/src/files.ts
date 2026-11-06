/**
 * Every read of adoption inside the project. Reads go through the portable projection's file layer (`readProject`,
 * `checkAncestors`): no link is followed, each folder above a path is checked, a file must be a plain file of this user
 * with one link and at most 1 MiB. A path that fails is listed as unmapped with the reason, never read, and never
 * dropped silently. Nothing here writes.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { DEFINITION_LIMITS } from '../../harness-definition/src/index.js';
import { PortableRefusal, byBytes, checkAncestors, readProject } from '../../project-sync/src/portable-files.js';
import type { Gate, Missed, UnmappedPart } from './model.js';
import { refuse } from './refusal.js';

export interface ReadFile { readonly bytes: Buffer; readonly sha256: string; readonly executable: boolean }
export type Kind = 'file' | 'dir' | 'link' | 'other';
export interface Listed { readonly name: string; readonly kind: Kind }

/**
 * The budget of one run (ruling A5). It matches the definition loader: at most `files` files and `totalBytes` bytes
 * read, `folderEntries` entries in one folder, and `depth` folders deep. Folder entries listed over the whole run are
 * capped too. A read or a listing past the budget refuses ADOPTION_TOO_LARGE before it happens.
 */
export const READ_BUDGET = Object.freeze({
  files: DEFINITION_LIMITS.files, bytes: DEFINITION_LIMITS.totalBytes, folderEntries: DEFINITION_LIMITS.folderEntries,
  depth: DEFINITION_LIMITS.depth, entries: 16 * DEFINITION_LIMITS.folderEntries,
});

const LINK_REASON = 'This is a link. Adoption reads no link.';

export class ProjectReader {
  /** Files a reader took, mapped or not. The sweep lists every other file of an engine folder. */
  readonly consumed = new Set<string>();
  readonly unmapped: Missed[] = [];
  /** Every file read, with its hash, so the plan shows what it read and a test can see nothing changed. */
  readonly read = new Map<string, string>();
  private files = 0;
  private bytes = 0;
  private entries = 0;
  constructor(readonly projectDir: string) {}

  miss(path: string, part: UnmappedPart, reason: string, pointer?: string, gate: Gate = 'none'): void {
    this.unmapped.push({ path, ...(pointer !== undefined ? { pointer } : {}), part, reason, gate });
  }

  /** The kind of an entry without following a link, or null when it or a folder above it is missing. */
  kind(rel: string): Kind | null {
    try { if (checkAncestors(this.projectDir, rel).length) return null; } catch (e) { if (e instanceof PortableRefusal) return 'other'; throw e; }
    let st: fs.Stats;
    try { st = fs.lstatSync(join(this.projectDir, rel)); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; return 'other'; }
    return st.isSymbolicLink() ? 'link' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
  }

  /** The size of a plain file, or -1. */
  size(rel: string): number {
    try { const st = fs.lstatSync(join(this.projectDir, rel)); return st.isFile() ? st.size : -1; } catch { return -1; }
  }

  /** Reads one file. Null when it is missing. A link or an unsafe file is listed as unmapped, with the gate, and gives null. */
  file(rel: string, part: UnmappedPart, gate: Gate = 'none'): ReadFile | null {
    this.consumed.add(rel);
    const k = this.kind(rel);
    if (k === null) return null;
    if (k === 'link') { this.miss(rel, part, LINK_REASON, undefined, gate); return null; }
    if (k !== 'file') { this.miss(rel, part, 'This is not a plain file, or a folder above it is a link.', undefined, gate); return null; }
    const size = this.size(rel);
    if (this.files + 1 > READ_BUDGET.files || this.bytes + Math.max(size, 0) > READ_BUDGET.bytes) refuse('ADOPTION_TOO_LARGE', [rel]);
    let got: ReturnType<typeof readProject>;
    try { got = readProject(this.projectDir, rel); } catch (e) {
      if (e instanceof PortableRefusal) { this.miss(rel, part, 'This file cannot be read safely: it has more than one link, is not yours, or is larger than 1 MiB.', undefined, gate); return null; }
      throw e;
    }
    if (got === null) return null;
    this.files += 1;
    this.bytes += got.bytes.length;
    if (this.bytes > READ_BUDGET.bytes) refuse('ADOPTION_TOO_LARGE', [rel]);
    this.read.set(rel, got.state.sha256);
    return { bytes: got.bytes, sha256: got.state.sha256, executable: (got.state.mode & 0o111) !== 0 };
  }

  /** Counts folder entries a search outside the readers listed. False, with nothing counted, when they would pass the budget. */
  count(n: number): boolean {
    if (this.entries + n > READ_BUDGET.entries) return false;
    this.entries += n;
    return true;
  }

  /** The names of a folder, counted against the budget. */
  private names(rel: string): string[] | null {
    let names: string[];
    try { names = fs.readdirSync(join(this.projectDir, rel)); } catch { return null; }
    if (names.length > READ_BUDGET.folderEntries) refuse('ADOPTION_TOO_LARGE', [rel]);
    this.entries += names.length;
    if (this.entries > READ_BUDGET.entries) refuse('ADOPTION_TOO_LARGE', [rel]);
    return names.sort(byBytes);
  }

  /** The entries of a folder in byte order, or null when it is not a real folder. A link folder is listed as unmapped. */
  list(rel: string, part: UnmappedPart, gate: Gate = 'none'): Listed[] | null {
    const k = this.kind(rel);
    if (k === null) return null;
    if (k === 'link') { this.consumed.add(rel); this.miss(rel, part, LINK_REASON, undefined, gate); return null; }
    if (k !== 'dir') return null;
    const names = this.names(rel);
    if (names === null) { this.consumed.add(rel); this.miss(rel, part, 'This folder cannot be listed.', undefined, gate); return null; }
    return names.map(name => ({ name, kind: this.kind(`${rel}/${name}`) ?? 'other' }));
  }

  /**
   * Lists every entry of a folder a reader consumed that it did not take (ruling A1): a link, a subfolder, or a file
   * the engine does not read there. `gate` is `acknowledge` for a folder whose files could hold a deny or an ask.
   */
  rest(rel: string, listed: readonly Listed[], part: UnmappedPart, gate: Gate = 'none'): void {
    for (const { name, kind } of listed) {
      const child = `${rel}/${name}`;
      if (this.consumed.has(child)) continue;
      this.consumed.add(child);
      if (kind === 'file' && name === '.DS_Store') continue;
      const reason = kind === 'link' ? LINK_REASON
        : kind === 'dir' ? 'This is a subfolder. Adoption reads only the files directly in this folder, so nothing in it is adopted.'
          : kind === 'file' ? 'The engine does not read a file of this name here, so it is not adopted.' : 'This is not a plain file.';
      this.miss(child, part, reason, undefined, gate);
    }
    this.consumed.add(rel);
  }

  /**
   * Every file below a folder, relative to it, in byte order. A link, a hidden name, or an odd entry is listed as
   * unmapped and left out; `.DS_Store` is skipped as metadata.
   */
  tree(rel: string, part: UnmappedPart, depth = 1): { path: string; file: ReadFile }[] {
    const out: { path: string; file: ReadFile }[] = [];
    if (depth > READ_BUDGET.depth) refuse('ADOPTION_TOO_LARGE', [rel]);
    for (const { name, kind } of this.list(rel, part) ?? []) {
      const child = `${rel}/${name}`;
      if (name === '.DS_Store' && kind === 'file') { this.consumed.add(child); continue; }
      if (kind === 'link') { this.consumed.add(child); this.miss(child, part, LINK_REASON); continue; }
      if (name.startsWith('.') || /[\0-\x1f\x7f\\]/.test(name)) { this.consumed.add(child); this.miss(child, part, 'A definition cannot hold a hidden name, or a name with a control character or a backslash, so this is not copied.'); continue; }
      if (kind === 'dir') { for (const f of this.tree(child, part, depth + 1)) out.push({ path: `${name}/${f.path}`, file: f.file }); continue; }
      if (kind !== 'file') { this.consumed.add(child); this.miss(child, part, 'This is not a plain file.'); continue; }
      const file = this.file(child, part);
      if (file) out.push({ path: name, file });
    }
    return out;
  }

  /**
   * Lists every file below a folder that no reader took, with the reason that no reader knows it. Links are listed as
   * links. Paths already listed as unmapped are not listed again.
   */
  sweep(rel: string, depth = 1, reason = 'Adoption has no reader for this file, so it is not adopted.'): void {
    const k = this.kind(rel);
    if (k === null) return;
    if (k === 'link') { if (!this.consumed.has(rel)) { this.consumed.add(rel); this.miss(rel, null, LINK_REASON); } return; }
    if (k !== 'dir') { if (!this.consumed.has(rel)) { this.consumed.add(rel); this.miss(rel, null, reason); } return; }
    if (this.consumed.has(rel)) return;
    if (depth > READ_BUDGET.depth) refuse('ADOPTION_TOO_LARGE', [rel]);
    for (const name of this.names(rel) ?? []) {
      const child = `${rel}/${name}`;
      if (this.consumed.has(child) || (name === '.DS_Store')) continue;
      this.sweep(child, depth + 1, reason);
    }
  }
}

/** Strict UTF-8 text with no byte order mark and no NUL, or null; and LF line endings. The contract's own helpers. */
export { decodeText as utf8, toLf } from '../../harness-definition/src/json.js';
