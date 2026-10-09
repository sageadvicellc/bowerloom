/**
 * Guarded reads of authored content: a local skill folder under `.bowerloom/skills/<id>/` and a prompt at
 * `.bowerloom/prompts/<name>.md`. Every read refuses a symlink, a second hard link, a foreign owner, group or
 * world write, special mode bits and oversize content, and a closing pass refuses any change during the read.
 * The result is content only, so two machines with the same authored bytes produce the same closure.
 */
import fs from 'node:fs';
import { join } from 'node:path';
import { relativeSkillPath, freezeSkillData } from '../../skill-sources/src/validation.js';
import { LIMITS, check, boundary, hash, same, identity, names, path as projectPath } from './observed.js';
import type { Identity } from './observed-types.js';
import type { ItemFile, InventoryRow, LocalClosure } from './v2-types.js';

export const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function itemName(value: unknown): asserts value is string { check(typeof value === 'string' && value.length <= 64 && ITEM_ID.test(value)); }
const LOCAL = Object.freeze({ files: 128, entries: 512, bytes: 2 * 1024 * 1024, depth: 8 });

interface Pin { path: string; identity: Identity; size: string; mtimeNs: string; ctimeNs: string }
const owned = (s: fs.BigIntStats): boolean => Number(s.uid) === process.getuid?.() && (Number(s.mode) & 0o7022) === 0;
const pinOf = (p: string, s: fs.BigIntStats): Pin => ({ path: p, identity: identity(s), size: String(s.size), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) });
function folder(p: string): Pin { const s = fs.lstatSync(p, { bigint: true }); check(!s.isSymbolicLink() && s.isDirectory() && owned(s)); return pinOf(p, s); }
/** One authored file: O_NOFOLLOW, one link, owner, no group or world write, bounded, unchanged across the read. */
function authored(p: string, max: number): { text: string; pin: Pin } {
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true }); check(before.isFile() && before.nlink === 1n && before.size >= 0n && before.size <= BigInt(max) && owned(before));
    const bytes = Buffer.alloc(Number(before.size)); let at = 0; while (at < bytes.length) { const n = fs.readSync(fd, bytes, at, bytes.length - at, null); check(n > 0); at += n; }
    check(fs.readSync(fd, Buffer.alloc(1), 0, 1, null) === 0); const after = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(p, { bigint: true });
    check(!named.isSymbolicLink() && named.nlink === 1n && owned(after) && owned(named) && same(pinOf(p, before), pinOf(p, after)) && same(pinOf(p, before), pinOf(p, named)));
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), pin: pinOf(p, before) };
  } finally { fs.closeSync(fd); }
}
/** The closing pass: the same entries with the same identities, sizes and times. */
function closing(pins: Pin[], live: () => void): void {
  for (const pin of pins) { live(); const s = fs.lstatSync(pin.path, { bigint: true }); check(!s.isSymbolicLink() && owned(s) && same(pinOf(pin.path, s), pin)); }
}
const byPath = <T extends { path: string }>(rows: T[]): T[] => rows.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
function closure(source: LocalClosure['source'], files: ItemFile[]): LocalClosure {
  const sorted = byPath(files), inventory: InventoryRow[] = sorted.map(f => ({ path: f.path, sha256: f.sha256, bytes: Buffer.byteLength(f.text) }));
  return freezeSkillData({ format: 'bowerloom/local-item-closure/v1beta2', source, files: sorted, inventory, executionAuthorized: false });
}
/** The fixed folders from the project down to `.bowerloom/<area>`. */
function base(projectDir: string, area: 'skills' | 'prompts', pins: Pin[]): string {
  projectPath(projectDir); const s = fs.lstatSync(projectDir, { bigint: true }); check(s.isDirectory() && !s.isSymbolicLink() && Number(s.uid) === process.getuid?.() && !(Number(s.mode) & 0o7022));
  const bowerloom = join(projectDir, '.bowerloom'), root = join(bowerloom, area); pins.push(folder(bowerloom), folder(root)); return root;
}

export function readLocalSkill(projectDir: string, relPath: string, live: () => void): LocalClosure {
  try {
    check(typeof relPath === 'string' && relPath.startsWith('skills/')); const id = relPath.slice('skills/'.length); itemName(id);
    const pins: Pin[] = []; live(); const root = join(base(projectDir, 'skills', pins), id), files: ItemFile[] = []; let bytes = 0, entries = 0;
    const visit = (abs: string, rel: string, depth: number): void => {
      live(); check(++entries <= LOCAL.entries && depth <= LOCAL.depth); const s = fs.lstatSync(abs, { bigint: true }); check(!s.isSymbolicLink());
      // A folder is never skipped silently: a hidden name refuses as a hidden file does, and so does an empty folder.
      if (s.isDirectory()) { pins.push(folder(abs)); if (rel) relativeSkillPath(rel); const children = names(abs); check(children.length > 0); for (const n of children) visit(join(abs, n), rel ? rel + '/' + n : n, depth + 1); return; }
      relativeSkillPath(rel); const got = authored(abs, LIMITS.file); pins.push(got.pin);
      bytes += Buffer.byteLength(got.text); check(files.length < LOCAL.files && bytes <= LOCAL.bytes);
      files.push({ path: rel, text: got.text, sha256: hash(got.text), mode: 420 });
    };
    visit(root, '', 0); check(files.some(f => f.path === 'SKILL.md')); closing(pins, live); live();
    return closure({ kind: 'local', path: relPath }, files);
  } catch (e) { return boundary(e); }
}

export function readLocalPrompt(projectDir: string, name: string, live: () => void): LocalClosure {
  try {
    itemName(name); const pins: Pin[] = []; live(); const file = join(base(projectDir, 'prompts', pins), name + '.md');
    const got = authored(file, LIMITS.file); pins.push(got.pin); closing(pins, live); live();
    return closure({ kind: 'prompt', path: 'prompts/' + name + '.md' }, [{ path: name + '.md', text: got.text, sha256: hash(got.text), mode: 420 }]);
  } catch (e) { return boundary(e); }
}
