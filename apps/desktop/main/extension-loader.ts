/**
 * Reads the manifests of the extensions that ship inside the app bundle: `<bundleRoot>/extensions/<name>/manifest.json`. It loads nothing from outside bundleRoot.
 * The bundle root must be an absolute path. A name with a path separator or "..", an absolute path, and a link that resolves outside bundleRoot are refused.
 * A manifest that is not valid JSON or fails the manifest check is skipped and reported, and so is a folder or a manifest file that a second link points to. Nothing here throws
 * for a bad extension. It never returns an empty result for a place it could not look: that is a skip with the code UNREADABLE. A bundle root that exists and
 * has no extensions folder is the one deliberate empty result. It reads only, and it runs no code.
 */

import { closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, sep } from 'node:path';
import { checkManifest, refuse } from '../shared/extensions/manifest.js';
import type { Answer, ExtensionManifest, Refusal } from '../shared/extensions/types.js';

export const EXTENSIONS_DIR = 'extensions';
export const MANIFEST_FILE = 'manifest.json';
/** A manifest is a few lines. A file past this is skipped without being parsed. */
export const MANIFEST_MAX_BYTES = 64 * 1024;
/** A folder name in a report is cut to this many characters. */
const NAME_SHOWN = 64;

/** The codes of a skipped folder. The extension API page lists each one (docs/v0.9/extension-api.md), and tools/lib/extension-kit.mjs repeats them. */
export const SKIP_CODES = Object.freeze(['BAD_NAME', 'OUTSIDE_ROOT', 'UNREADABLE', 'NOT_A_FILE', 'TOO_LARGE', 'NOT_JSON', 'BAD_MANIFEST', 'DUPLICATE'] as const);
export type SkipCode = (typeof SKIP_CODES)[number];
export interface Skipped { readonly name: string; readonly code: SkipCode; readonly message: string }
export interface LoadResult { readonly manifests: readonly ExtensionManifest[]; readonly skipped: readonly Skipped[] }

/** True when `child` is `root` or sits inside it. Both are real paths. */
const inside = (root: string, child: string): boolean => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
const fail = (code: SkipCode, message: string): { readonly ok: false; readonly refusal: Refusal } => refuse(code, message);

/** A name is one plain path part. */
function plainName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes('..') && !/[\\/\0]/.test(name) && !isAbsolute(name);
}

/**
 * Text made safe to show: control, format and invisible characters become "?", and long text is cut. That is the Unicode classes Cc, Cf, Zl and Zp, every default-ignorable
 * code point, the Khmer inherent vowels (U+17B4, U+17B5), the object replacement character (U+FFFC), the musical formatting characters (U+1D173 to U+1D17A), the non-ASCII
 * spaces (U+00A0, U+2000 to U+200A), and the braille blank (U+2800), which looks empty. An ordinary space stays.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u17b4\u17b5\ufffc\u{1d173}-\u{1d17a}\u00a0\u2000-\u200a\u2800]/gu;
function clean(text: string, max: number): string {
  const chars = [...text.replace(UNSAFE, '?')];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}
const shown = (name: string): string => clean(name, NAME_SHOWN);

/** The error code of a failed call as plain text (such as ENOENT), or "unknown". Only a short upper-case code passes. */
function codeOf(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unknown';
}

type Real = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly err: string };
function realOf(path: string): Real {
  try { return { ok: true, path: realpathSync(path) }; } catch (error) { return { ok: false, err: codeOf(error) }; }
}

/** Reads a file through one open descriptor: the size check and the read are about the same file. Never reads past the limit. A path that is not a regular file is refused before it is opened. */
function readManifestText(file: string, label: string): Answer<string> {
  let fd: number | undefined;
  try {
    // Look at the path first: opening a FIFO for reading blocks until a writer comes, and that would stop the main thread.
    if (!statSync(file).isFile()) return fail('NOT_A_FILE', `The ${MANIFEST_FILE} of "${label}" is not a regular file.`);
    fd = openSync(file, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile()) return fail('UNREADABLE', `The ${MANIFEST_FILE} of "${label}" is not a file.`);
    if (stat.size > MANIFEST_MAX_BYTES) return fail('TOO_LARGE', `The ${MANIFEST_FILE} of "${label}" is too large.`);
    const buffer = Buffer.alloc(MANIFEST_MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MANIFEST_MAX_BYTES) return fail('TOO_LARGE', `The ${MANIFEST_FILE} of "${label}" is too large.`);
    return { ok: true, value: buffer.toString('utf8', 0, length) };
  } catch (error) {
    return fail('UNREADABLE', `The ${MANIFEST_FILE} of "${label}" cannot be read (${codeOf(error)}).`);
  } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* nothing more to do */ }
  }
}

const isAbsolutePath = (value: unknown): value is string => typeof value === 'string' && value !== '' && isAbsolute(value);

/** One manifest by folder name, with the real path of its folder and of its manifest file (for finding two names for one folder or one file). */
interface One { readonly answer: Answer<ExtensionManifest>; readonly folder?: string; readonly file?: string }
function loadOne(bundleRoot: string, name: string): One {
  if (!plainName(name)) return { answer: fail('BAD_NAME', 'The extension name must be one plain folder name.') };
  const label = shown(name);
  if (!isAbsolutePath(bundleRoot)) return { answer: fail('UNREADABLE', 'The bundle folder must be an absolute path.') };
  const root = realOf(bundleRoot);
  if (!root.ok) return { answer: fail('UNREADABLE', `The bundle folder cannot be read (${root.err}).`) };
  const base = realOf(join(bundleRoot, EXTENSIONS_DIR));
  if (!base.ok) return { answer: fail('UNREADABLE', `The bundle has no extensions folder (${base.err}).`) };
  if (!inside(root.path, base.path)) return { answer: fail('OUTSIDE_ROOT', 'The extensions folder resolves outside the bundle.') };
  const folder = realOf(join(bundleRoot, EXTENSIONS_DIR, name));
  if (!folder.ok) return { answer: fail('UNREADABLE', `The extension "${label}" cannot be read (${folder.err}).`) };
  if (!inside(root.path, folder.path)) return { answer: fail('OUTSIDE_ROOT', `The extension "${label}" resolves outside the bundle.`) };
  const file = realOf(join(folder.path, MANIFEST_FILE));
  if (!file.ok) return { answer: fail('UNREADABLE', `The extension "${label}" has no ${MANIFEST_FILE} (${file.err}).`), folder: folder.path };
  if (!inside(root.path, file.path)) return { answer: fail('OUTSIDE_ROOT', `The ${MANIFEST_FILE} of "${label}" resolves outside the bundle.`), folder: folder.path };
  if (basename(file.path) !== MANIFEST_FILE) return { answer: fail('BAD_NAME', `The ${MANIFEST_FILE} of "${label}" is a link to a file with another name.`), folder: folder.path };
  const at = { folder: folder.path, file: file.path };
  const read = readManifestText(file.path, label);
  if (!read.ok) return { answer: read, ...at };
  let parsed: unknown;
  try { parsed = JSON.parse(read.value.charCodeAt(0) === 0xfeff ? read.value.slice(1) : read.value); } catch (error) {
    // Only the position of the fault is shown. The parser quotes the manifest text in its message, and that text is not ours to show.
    const position = error instanceof SyntaxError ? /\bposition (\d+)/.exec(error.message)?.[1] : undefined;
    return { answer: fail('NOT_JSON', `The ${MANIFEST_FILE} of "${label}" is not valid JSON${position === undefined ? '' : ` (at position ${position})`}.`), ...at };
  }
  return { answer: checkManifest(parsed), ...at };
}

/** Loads one manifest by folder name. The refusal code is a SkipCode. The bundle root must be an absolute path. */
export function loadBundledManifest(bundleRoot: string, name: string): Answer<ExtensionManifest> {
  return loadOne(bundleRoot, name).answer;
}

/**
 * Loads every manifest under `<bundleRoot>/extensions`, in name order. Returns the valid ones and a report of each one skipped.
 * A relative or empty root, a missing root, an extensions entry that is not a folder, and a read error each give one skip named "extensions" with the code UNREADABLE.
 * A root with no extensions folder gives an empty result with no skip.
 */
export function loadBundledManifests(bundleRoot: string): LoadResult {
  const manifests: ExtensionManifest[] = [], skipped: Skipped[] = [];
  const unreadable = (message: string): LoadResult => ({ manifests, skipped: [{ name: EXTENSIONS_DIR, code: 'UNREADABLE', message }] });
  if (!isAbsolutePath(bundleRoot)) return unreadable('The bundle folder must be an absolute path.');
  const root = realOf(bundleRoot);
  if (!root.ok) return unreadable(`The bundle folder cannot be read (${root.err}).`);
  const dir = join(bundleRoot, EXTENSIONS_DIR);
  try { lstatSync(dir); } catch (error) {
    // The one deliberate empty result: the bundle has no extensions folder at all.
    if (codeOf(error) === 'ENOENT') return { manifests, skipped };
    return unreadable(`The extensions folder cannot be read (${codeOf(error)}).`);
  }
  const base = realOf(dir);
  if (!base.ok) return unreadable(`The extensions folder cannot be read (${base.err}).`);
  if (!inside(root.path, base.path)) return { manifests, skipped: [{ name: EXTENSIONS_DIR, code: 'OUTSIDE_ROOT', message: 'The extensions folder resolves outside the bundle.' }] };
  let names: string[];
  try {
    if (!statSync(base.path).isDirectory()) return unreadable('The extensions entry is not a folder (ENOTDIR).');
    names = readdirSync(base.path).sort();
  } catch (error) { return unreadable(`The extensions folder cannot be read (${codeOf(error)}).`); }
  const folders = new Map<string, string>(), files = new Map<string, string>();
  for (const name of names) {
    const { answer, folder, file } = loadOne(bundleRoot, name);
    const firstFolder = folder === undefined ? undefined : folders.get(folder);
    const firstFile = file === undefined ? undefined : files.get(file);
    if (firstFolder !== undefined) { skipped.push({ name: shown(name), code: 'DUPLICATE', message: `The folder "${shown(name)}" is the same real folder as "${firstFolder}".` }); continue; }
    if (firstFile !== undefined) { skipped.push({ name: shown(name), code: 'DUPLICATE', message: `The ${MANIFEST_FILE} of "${shown(name)}" is the same real file as the one in "${firstFile}".` }); continue; }
    if (folder !== undefined) folders.set(folder, shown(name));
    if (file !== undefined) files.set(file, shown(name));
    if (answer.ok) manifests.push(answer.value);
    else skipped.push({ name: shown(name), code: answer.refusal.code as SkipCode, message: answer.refusal.message });
  }
  return { manifests, skipped };
}
