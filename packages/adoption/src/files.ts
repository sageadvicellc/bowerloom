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
import type { Unmapped, UnmappedPart } from './model.js';

export interface ReadFile { readonly bytes: Buffer; readonly sha256: string; readonly executable: boolean }
export type Kind = 'file' | 'dir' | 'link' | 'other';
export interface Listed { readonly name: string; readonly kind: Kind }

export class ProjectReader {
  /** Files a reader took, mapped or not. The sweep lists every other file of an engine folder. */
  readonly consumed = new Set<string>();
  readonly unmapped: Unmapped[] = [];
  /** Every file read, with its hash, so the plan shows what it read and a test can see nothing changed. */
  readonly read = new Map<string, string>();
  constructor(readonly projectDir: string) {}

  miss(path: string, part: UnmappedPart, reason: string, pointer?: string): void {
    this.unmapped.push({ path, ...(pointer !== undefined ? { pointer } : {}), part, reason });
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

  /** Reads one file. Null when it is missing. A link or an unsafe file is listed as unmapped and gives null. */
  file(rel: string, part: UnmappedPart): ReadFile | null {
    this.consumed.add(rel);
    const k = this.kind(rel);
    if (k === null) return null;
    if (k === 'link') { this.miss(rel, part, 'This is a link. Adoption reads no link.'); return null; }
    if (k !== 'file') { this.miss(rel, part, 'This is not a plain file, or a folder above it is a link.'); return null; }
    let got: ReturnType<typeof readProject>;
    try { got = readProject(this.projectDir, rel); } catch (e) {
      if (e instanceof PortableRefusal) { this.miss(rel, part, 'This file cannot be read safely: it has more than one link, is not yours, or is larger than 1 MiB.'); return null; }
      throw e;
    }
    if (got === null) return null;
    this.read.set(rel, got.state.sha256);
    return { bytes: got.bytes, sha256: got.state.sha256, executable: (got.state.mode & 0o111) !== 0 };
  }

  /** The entries of a folder in byte order, or null when it is not a real folder. A link folder is listed as unmapped. */
  list(rel: string, part: UnmappedPart): Listed[] | null {
    const k = this.kind(rel);
    if (k === null) return null;
    if (k === 'link') { this.consumed.add(rel); this.miss(rel, part, 'This is a link. Adoption reads no link.'); return null; }
    if (k !== 'dir') return null;
    let names: string[];
    try { names = fs.readdirSync(join(this.projectDir, rel)); } catch { this.miss(rel, part, 'This folder cannot be listed.'); return null; }
    if (names.length > DEFINITION_LIMITS.folderEntries) { this.miss(rel, part, `This folder holds more than ${DEFINITION_LIMITS.folderEntries} entries, so adoption does not read it.`); return null; }
    return names.sort(byBytes).map(name => ({ name, kind: this.kind(`${rel}/${name}`) ?? 'other' }));
  }

  /**
   * Every file below a folder, relative to it, in byte order. A link, a hidden name, or an odd entry is listed as
   * unmapped and left out; `.DS_Store` is skipped as metadata.
   */
  tree(rel: string, part: UnmappedPart, depth = 1): { path: string; file: ReadFile }[] {
    const out: { path: string; file: ReadFile }[] = [];
    if (depth > DEFINITION_LIMITS.depth) { this.miss(rel, part, `Adoption reads folders at most ${DEFINITION_LIMITS.depth} deep.`); return out; }
    for (const { name, kind } of this.list(rel, part) ?? []) {
      const child = `${rel}/${name}`;
      if (name === '.DS_Store' && kind === 'file') { this.consumed.add(child); continue; }
      if (kind === 'link') { this.consumed.add(child); this.miss(child, part, 'This is a link. Adoption reads no link.'); continue; }
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
    if (k === 'link') { if (!this.consumed.has(rel)) { this.consumed.add(rel); this.miss(rel, null, 'This is a link. Adoption reads no link.'); } return; }
    if (k !== 'dir') { if (!this.consumed.has(rel)) { this.consumed.add(rel); this.miss(rel, null, reason); } return; }
    if (this.consumed.has(rel) || depth > DEFINITION_LIMITS.depth) return;
    let names: string[];
    try { names = fs.readdirSync(join(this.projectDir, rel)); } catch { return; }
    for (const name of names.sort(byBytes)) {
      const child = `${rel}/${name}`;
      if (this.consumed.has(child) || (name === '.DS_Store')) continue;
      this.sweep(child, depth + 1, reason);
    }
  }
}

/** Strict UTF-8 text with no byte order mark and no NUL, or null; and LF line endings. The contract's own helpers. */
export { decodeText as utf8, toLf } from '../../harness-definition/src/json.js';
