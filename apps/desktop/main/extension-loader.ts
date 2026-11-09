/**
 * Reads the manifests of the extensions that ship inside the app bundle: `<bundleRoot>/extensions/<name>/manifest.json`. It loads nothing from outside bundleRoot.
 * A name with a path separator or "..", an absolute path, and a link that resolves outside bundleRoot are refused. A manifest that is not valid JSON or fails the
 * manifest check is skipped and reported. Nothing here throws for a bad extension. It reads only, and it runs no code.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { checkManifest, refuse } from '../shared/extensions/manifest.js';
import type { Answer, ExtensionManifest, Refusal } from '../shared/extensions/types.js';

export const EXTENSIONS_DIR = 'extensions';
export const MANIFEST_FILE = 'manifest.json';
/** A manifest is a few lines. A file past this is skipped without being read. */
export const MANIFEST_MAX_BYTES = 64 * 1024;

export type SkipCode = 'BAD_NAME' | 'OUTSIDE_ROOT' | 'UNREADABLE' | 'TOO_LARGE' | 'NOT_JSON' | 'BAD_MANIFEST';
export interface Skipped { readonly name: string; readonly code: SkipCode; readonly message: string }
export interface LoadResult { readonly manifests: readonly ExtensionManifest[]; readonly skipped: readonly Skipped[] }

/** True when `child` is `root` or sits inside it. Both are real paths. */
const inside = (root: string, child: string): boolean => child === root || child.startsWith(root.endsWith(sep) ? root : root + sep);
const fail = (code: SkipCode, message: string): { readonly ok: false; readonly refusal: Refusal } => refuse(code, message);

/** A name is one plain path part. */
function plainName(name: unknown): name is string {
  return typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes('..') && !/[\\/\0]/.test(name) && !isAbsolute(name);
}

function realOf(path: string): string | null { try { return realpathSync(path); } catch { return null; } }

/** Loads one manifest by folder name. The refusal code is a SkipCode. */
export function loadBundledManifest(bundleRoot: string, name: string): Answer<ExtensionManifest> {
  if (!plainName(name)) return fail('BAD_NAME', 'The extension name must be one plain folder name.');
  const root = typeof bundleRoot === 'string' && bundleRoot !== '' ? realOf(bundleRoot) : null;
  if (root === null) return fail('UNREADABLE', 'The bundle folder cannot be read.');
  const base = realOf(join(bundleRoot, EXTENSIONS_DIR));
  if (base === null) return fail('UNREADABLE', 'The bundle has no extensions folder.');
  if (!inside(root, base)) return fail('OUTSIDE_ROOT', 'The extensions folder resolves outside the bundle.');
  const folder = realOf(join(bundleRoot, EXTENSIONS_DIR, name));
  if (folder === null) return fail('UNREADABLE', `The extension "${name}" cannot be read.`);
  if (!inside(root, folder)) return fail('OUTSIDE_ROOT', `The extension "${name}" resolves outside the bundle.`);
  const file = realOf(join(folder, MANIFEST_FILE));
  if (file === null) return fail('UNREADABLE', `The extension "${name}" has no ${MANIFEST_FILE}.`);
  if (!inside(root, file)) return fail('OUTSIDE_ROOT', `The ${MANIFEST_FILE} of "${name}" resolves outside the bundle.`);
  let text: string;
  try {
    const stat = statSync(file);
    if (!stat.isFile()) return fail('UNREADABLE', `The ${MANIFEST_FILE} of "${name}" is not a file.`);
    if (stat.size > MANIFEST_MAX_BYTES) return fail('TOO_LARGE', `The ${MANIFEST_FILE} of "${name}" is too large.`);
    text = readFileSync(file, 'utf8');
  } catch { return fail('UNREADABLE', `The ${MANIFEST_FILE} of "${name}" cannot be read.`); }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail('NOT_JSON', `The ${MANIFEST_FILE} of "${name}" is not valid JSON.`); }
  const checked = checkManifest(parsed);
  return checked.ok ? checked : { ok: false, refusal: checked.refusal };
}

/** Loads every manifest under `<bundleRoot>/extensions`, in name order. Returns the valid ones and a report of each one skipped. */
export function loadBundledManifests(bundleRoot: string): LoadResult {
  const manifests: ExtensionManifest[] = [], skipped: Skipped[] = [];
  if (typeof bundleRoot !== 'string' || bundleRoot === '' || !isAbsolute(bundleRoot)) return { manifests, skipped };
  const dir = join(bundleRoot, EXTENSIONS_DIR);
  let names: string[];
  const root = realOf(bundleRoot), base = realOf(dir);
  if (root === null || base === null) return { manifests, skipped };
  if (!inside(root, base)) return { manifests, skipped: [{ name: EXTENSIONS_DIR, code: 'OUTSIDE_ROOT', message: 'The extensions folder resolves outside the bundle.' }] };
  try { names = readdirSync(base).sort(); } catch { return { manifests, skipped: [{ name: EXTENSIONS_DIR, code: 'UNREADABLE', message: 'The extensions folder cannot be read.' }] }; }
  for (const name of names) {
    const answer = loadBundledManifest(bundleRoot, name);
    if (answer.ok) manifests.push(answer.value);
    else skipped.push({ name, code: answer.refusal.code as SkipCode, message: answer.refusal.message });
  }
  return { manifests, skipped };
}
