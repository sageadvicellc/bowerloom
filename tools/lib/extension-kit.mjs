// The logic of tools/extension-kit.mjs: make, check, install and remove a stock extension of the desktop app. Never shipped.
// An extension of v0.9 is a manifest folder in apps/desktop/extensions plus a screen that is compiled into the app. A manifest carries no code, and this kit loads no code.
// The manifest rules here are the rules of apps/desktop/shared/extensions/manifest.ts, and the loader rules are those of apps/desktop/main/extension-loader.ts.
// A test (apps/desktop/tests/extension-kit-parity.test.ts) holds the two sides equal, so a rule cannot change on one side alone.
// The kit is stricter than the app in four places, on purpose, and the API page says so: it refuses every link (the loader keeps a link that stays inside the bundle), it needs the routes to include
// the id (the mount draws only route equal to id), it refuses a new id that does not start with a letter, and it refuses a new title with a character that is not plain text.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

/** Where things live, relative to the repository root. */
export const EXTENSIONS_DIR = 'apps/desktop/extensions';
export const TEMPLATE_DIR = 'apps/desktop/extension-template';
export const SCREENS_DIR = 'apps/desktop/renderer/harness/extensions';
export const MOUNTS_FILE = 'apps/desktop/renderer/harness/extension-mounts.tsx';
export const TEMPLATE_ID = 'extension-template';
export const TEMPLATE_SCREEN = 'ExtensionTemplate';
export const MANIFEST_FILE = 'manifest.json';
/** A manifest is a few lines. A file past this is not read. The same limit as the loader. */
export const MANIFEST_MAX_BYTES = 64 * 1024;

/** The default extensions and the 15 base routes of the app. A loaded extension cannot take one of these names. A test compares this list with shared/extensions/defaults.ts. */
export const DEFAULT_IDS = Object.freeze(['overview', 'harnesses', 'library', 'projects', 'interfaces-history-help', 'first-run']);
export const BASE_ROUTES = Object.freeze(['welcome', 'choose', 'read', 'notes', 'overview', 'harnesses', 'builder', 'file', 'library', 'projects', 'runs', 'compare', 'interfaces', 'history', 'help']);
export const RESERVED_NAMES = new Set([...DEFAULT_IDS, ...BASE_ROUTES]);

/** The codes the kit gives that the app does not. Every code of the app that the kit repeats keeps its meaning. */
export const KIT_CODES = Object.freeze(['BAD_ID', 'BAD_TITLE', 'NO_SCREEN', 'NO_MOUNT_TABLE', 'ROUTE_MISMATCH', 'NOT_A_TREE', 'UNSAFE_PATH', 'NOT_INSTALLED', 'REMOVE_INCOMPLETE']);
/** A warning is not a refusal and does not fail a check. */
export const KIT_WARNINGS = Object.freeze(['FIELD_DROPPED']);
const MANIFEST_FIELDS = Object.freeze(['id', 'title', 'kind', 'routes', 'protected']);
/** The codes of the loader (main/extension-loader.ts) that the kit repeats when it reads a folder. */
export const LOADER_CODES = Object.freeze(['BAD_NAME', 'OUTSIDE_ROOT', 'UNREADABLE', 'NOT_A_FILE', 'TOO_LARGE', 'NOT_JSON', 'BAD_MANIFEST', 'DUPLICATE']);

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TITLE_MAX = 120;
const ROUTES_MAX = 64;
export const KINDS = Object.freeze(['ui']);

/** A refusal of the kit: a short code and one sentence. */
export class KitError extends Error {
  constructor(code, message) { super(message); this.name = 'KitError'; this.code = code; }
}

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const bad = why => ({ ok: false, code: 'BAD_MANIFEST', message: `This extension manifest is not valid: ${why}.` });

/** The manifest check of shared/extensions/manifest.ts. Returns { ok: true, value } or { ok: false, code: 'BAD_MANIFEST', message }. */
export function checkManifestValue(value) {
  if (!isRecord(value)) return bad('it is not an object');
  const { id, title, kind, routes } = value;
  if (typeof id !== 'string' || !NAME.test(id)) return bad('id must be lowercase letters, digits and hyphens');
  if (typeof title !== 'string' || title.trim() === '' || title.length > TITLE_MAX) return bad('title must be a short, non-empty text');
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return bad('kind must be "ui"');
  if (!Array.isArray(routes) || routes.length === 0 || routes.length > ROUTES_MAX) return bad('routes must be a non-empty list');
  const seen = new Set();
  for (const route of routes) {
    if (typeof route !== 'string' || !NAME.test(route)) return bad('each route must be a name of lowercase letters, digits and hyphens');
    if (seen.has(route)) return bad(`route "${route}" is listed twice`);
    seen.add(route);
  }
  if (typeof value.protected !== 'boolean') return bad('protected must be true or false');
  return { ok: true, value: { id, title, kind, routes: [...seen], protected: value.protected } };
}

/** The rules of registerLoaded (shared/extensions/register.ts): a loaded extension cannot take a default name and cannot be protected. Returns null or { code: 'RESERVED', message }. */
export function reservedProblem(manifest) {
  if (RESERVED_NAMES.has(manifest.id)) return { code: 'RESERVED', message: `The name "${manifest.id}" belongs to the app and cannot be the id of a loaded extension.` };
  const route = manifest.routes.find(r => RESERVED_NAMES.has(r));
  if (route !== undefined) return { code: 'RESERVED', message: `The route "${route}" belongs to the app and cannot be taken by a loaded extension.` };
  if (manifest.protected) return { code: 'RESERVED', message: `The extension "${manifest.id}" is loaded from outside the app, so it cannot be protected.` };
  return null;
}

const codeOf = error => (typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code) ? error.code : 'unknown');
// The loader rule: one plain path part, and no two dots anywhere in it.
const plainName = name => typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !name.includes('..') && !/[\\/\0]/.test(name) && !path.isAbsolute(name);

/** Reads one extension folder as the loader does. Returns { name, manifest } or { name, code, message }. Never throws. */
export function readExtension(extensionsDir, name) {
  const fail = (code, message) => ({ name, code, message });
  if (!plainName(name)) return fail('BAD_NAME', 'The extension name must be one plain folder name.');
  const folder = path.join(extensionsDir, name);
  let stat;
  try { stat = fs.lstatSync(folder); } catch (error) { return fail('UNREADABLE', `The extension "${name}" cannot be read (${codeOf(error)}).`); }
  if (stat.isSymbolicLink()) return fail('OUTSIDE_ROOT', `The extension "${name}" is a link. A stock extension is a real folder.`);
  const file = path.join(folder, MANIFEST_FILE);
  let fileStat;
  try { fileStat = fs.lstatSync(file); } catch (error) { return fail('UNREADABLE', `The extension "${name}" has no ${MANIFEST_FILE} (${codeOf(error)}).`); }
  if (fileStat.isSymbolicLink()) return fail('OUTSIDE_ROOT', `The ${MANIFEST_FILE} of "${name}" is a link. A stock extension holds the file itself.`);
  if (!fileStat.isFile()) return fail('NOT_A_FILE', `The ${MANIFEST_FILE} of "${name}" is not a regular file.`);
  if (fileStat.size > MANIFEST_MAX_BYTES) return fail('TOO_LARGE', `The ${MANIFEST_FILE} of "${name}" is too large.`);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { return fail('UNREADABLE', `The ${MANIFEST_FILE} of "${name}" cannot be read (${codeOf(error)}).`); }
  let parsed;
  try { parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (error) {
    const position = error instanceof SyntaxError ? /\bposition (\d+)/.exec(error.message)?.[1] : undefined;
    return fail('NOT_JSON', `The ${MANIFEST_FILE} of "${name}" is not valid JSON${position === undefined ? '' : ` (at position ${position})`}.`);
  }
  const checked = checkManifestValue(parsed);
  if (!checked.ok) return fail(checked.code, checked.message);
  // The app drops every field that is not one of the five and says nothing. The kit says which ones.
  const dropped = Object.keys(parsed).filter(key => !MANIFEST_FIELDS.includes(key)).sort();
  return { name, manifest: checked.value, dropped };
}

const isDir = at => { try { return fs.statSync(at).isDirectory(); } catch { return false; } };
const exists = at => { try { fs.lstatSync(at); return true; } catch { return false; } };

/** Refuses a link in the place of a folder the kit reads or writes in. A folder that is not there yet is fine. */
function needRealFolder(at, label) {
  let stat;
  try { stat = fs.lstatSync(at); } catch { return; }
  if (stat.isSymbolicLink()) throw new KitError('UNSAFE_PATH', `${label} is a link. The kit does not read or write through a link.`);
  if (!stat.isDirectory()) throw new KitError('UNSAFE_PATH', `${label} is not a folder.`);
}

/**
 * The id keys of the mount table in extension-mounts.tsx (the object named BUNDLED_MOUNTS). Null when the file or the table is not there. A caller that needs the answer
 * must treat null as the refusal NO_MOUNT_TABLE: a check that cannot read the table cannot say that a screen exists.
 */
export function mountedIds(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, MOUNTS_FILE), 'utf8'); } catch { return null; }
  const start = text.indexOf('const BUNDLED_MOUNTS');
  if (start < 0) return null;
  const end = text.indexOf('});', start);
  const body = text.slice(start, end < 0 ? text.length : end);
  const ids = new Set();
  for (const match of body.matchAll(/^\s*(?:'([a-z0-9][a-z0-9-]*)'|([a-z0-9][a-z0-9-]*))\s*:/gm)) ids.add(match[1] ?? match[2]);
  return ids;
}

function needMountTable(root) {
  const ids = mountedIds(root);
  if (ids === null) throw new KitError('NO_MOUNT_TABLE', `The mount table BUNDLED_MOUNTS cannot be read in ${MOUNTS_FILE}, so no screen can be checked.`);
  return ids;
}

function needTree(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new KitError('NOT_A_TREE', 'The repository root must be an absolute path.');
  if (!isDir(path.join(root, 'apps', 'desktop'))) throw new KitError('NOT_A_TREE', 'This is not the Bowerloom repository: apps/desktop is missing.');
}

/**
 * Checks every folder under apps/desktop/extensions in name order, as the app loads them. A problem has a code: a loader code, RESERVED, EXTENSION_EXISTS, ROUTE_TAKEN,
 * ROUTE_MISMATCH (the routes do not include the id), or NO_SCREEN (a valid manifest that has no screen in the mount table, so the app would not register it). A mount table that cannot be read
 * throws NO_MOUNT_TABLE. `only` limits the report to one folder, but every folder is still read, so a taken route is found. `warnings` lists each field the app drops.
 */
export function checkTree(root, only = null) {
  needTree(root);
  const dir = path.join(root, EXTENSIONS_DIR);
  needRealFolder(dir, EXTENSIONS_DIR);
  const extensions = [], problems = [], warnings = [];
  const names = exists(dir) ? fs.readdirSync(dir).sort() : [];
  const mounted = needMountTable(root);
  const ids = new Map(), owners = new Map();
  for (const name of names) {
    const read = readExtension(dir, name);
    if (read.manifest === undefined) { problems.push({ name, code: read.code, message: read.message }); continue; }
    const m = read.manifest;
    if (read.dropped.length > 0) warnings.push({ name, code: 'FIELD_DROPPED', fields: read.dropped, message: `The app drops the field${read.dropped.length === 1 ? '' : 's'} ${read.dropped.map(f => `"${f}"`).join(', ')} of "${name}" and never reads ${read.dropped.length === 1 ? 'it' : 'them'}. A manifest names no code.` });
    const reserved = reservedProblem(m);
    if (reserved !== null) { problems.push({ name, ...reserved }); continue; }
    if (ids.has(m.id)) { problems.push({ name, code: 'EXTENSION_EXISTS', message: `An extension with the id "${m.id}" is already registered by the folder "${ids.get(m.id)}".` }); continue; }
    const taken = m.routes.find(r => owners.has(r));
    if (taken !== undefined) { problems.push({ name, code: 'ROUTE_TAKEN', message: `The route "${taken}" already belongs to the extension "${owners.get(taken)}".` }); continue; }
    ids.set(m.id, name);
    for (const route of m.routes) owners.set(route, m.id);
    if (!m.routes.includes(m.id)) { problems.push({ name, code: 'ROUTE_MISMATCH', message: `The routes of "${m.id}" do not include "${m.id}". The mount draws the screen only for the route that equals the id.` }); continue; }
    if (!mounted.has(m.id)) { problems.push({ name, code: 'NO_SCREEN', message: `The extension "${m.id}" has no screen in the mount table of ${MOUNTS_FILE}, so the app does not register it.` }); continue; }
    extensions.push({ name, id: m.id, title: m.title, routes: m.routes });
  }
  if (only !== null) {
    if (!names.includes(only)) throw new KitError('NOT_INSTALLED', `No folder named "${only}" is in ${EXTENSIONS_DIR}.`);
    return { extensions: extensions.filter(e => e.name === only), problems: problems.filter(p => p.name === only), warnings: warnings.filter(w => w.name === only) };
  }
  return { extensions, problems, warnings };
}

const pascal = id => id.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const titleOf = id => { const text = id.split('-').join(' '); return text.charAt(0).toUpperCase() + text.slice(1); };

/** The id of a new extension must be a name, not a default name, and its component name must start with a letter. */
export function checkNewId(id) {
  if (typeof id !== 'string' || !NAME.test(id)) throw new KitError('BAD_ID', 'The id must be lowercase letters, digits and hyphens, and start with a letter or a digit.');
  if (!/^[a-z]/.test(id)) throw new KitError('BAD_ID', 'The id of a new extension must start with a letter, because the screen component takes its name from it.');
  if (RESERVED_NAMES.has(id)) throw new KitError('RESERVED', `The name "${id}" belongs to the app and cannot be the id of a loaded extension.`);
}

// A title goes into source code as a string. Plain text only: no quote, brace, angle bracket, backtick or backslash, and no control or line-break character.
const BAD_TITLE_CHARS = /["{}<>`\\\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export function checkNewTitle(title) {
  if (typeof title !== 'string' || BAD_TITLE_CHARS.test(title)) throw new KitError('BAD_TITLE', 'The title cannot hold a quote, a brace, an angle bracket, a backtick, a backslash or a control character.');
}

/** The refusal when a folder that holds the id or a route is already in the tree. Checks the real manifests, not only the folder names. */
function needFree(root, id) {
  const dir = path.join(root, EXTENSIONS_DIR);
  if (exists(path.join(dir, id))) throw new KitError('EXTENSION_EXISTS', `The folder "${id}" is already in ${EXTENSIONS_DIR}.`);
  if (!isDir(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const read = readExtension(dir, name);
    if (read.manifest === undefined) continue;
    if (read.manifest.id === id) throw new KitError('EXTENSION_EXISTS', `An extension with the id "${id}" is already in the folder "${name}".`);
    if (read.manifest.routes.includes(id)) throw new KitError('ROUTE_TAKEN', `The route "${id}" already belongs to the extension "${read.manifest.id}".`);
  }
}

const defaultWrite = (file, text) => fs.writeFileSync(file, text, { flag: 'wx', mode: 0o644 });

/** The line to add to the mount table, and the import that goes with it. The kit prints them and edits no source file. */
export function mountLines(id, component) {
  return {
    importLine: `import { ${component} } from './extensions/${component}.js';`,
    tableLine: `  '${id}': ({ route }) => (route.name === 'extension' && route.route === '${id}' ? <${component} /> : stray(route)),`,
  };
}

/**
 * Makes the folder of a new stock extension and its screen file, from the template. The route of the extension is its id. It writes two files and refuses to write over a file.
 * The title becomes one JSON string literal that replaces the whole literal "Extension template" of the template, after a check that it is plain text.
 * If the second write fails, the first file is unlinked and the folder is removed with rmdir, which fails and leaves the folder when anything else is in it. Nothing is deleted recursively.
 * It edits no source file: the result says which two lines to add to the mount table, and `check` reports NO_SCREEN until they are added. `ops.write` is a test seam.
 */
export function scaffold(root, { id, title = null }, ops = {}) {
  const write = ops.write ?? defaultWrite;
  needTree(root);
  checkNewId(id);
  const shown = title === null ? titleOf(id) : title;
  checkNewTitle(shown);
  const checked = checkManifestValue({ id, title: shown, kind: 'ui', routes: [id], protected: false });
  if (!checked.ok) throw new KitError('BAD_MANIFEST', checked.message);
  needRealFolder(path.join(root, EXTENSIONS_DIR), EXTENSIONS_DIR);
  needRealFolder(path.join(root, SCREENS_DIR), SCREENS_DIR);
  needFree(root, id);
  const component = pascal(id);
  const source = path.join(root, SCREENS_DIR, `${TEMPLATE_SCREEN}.tsx`);
  let screen;
  try { screen = fs.readFileSync(source, 'utf8'); } catch { throw new KitError('NOT_A_TREE', `The template screen ${SCREENS_DIR}/${TEMPLATE_SCREEN}.tsx is missing.`); }
  const target = path.join(root, SCREENS_DIR, `${component}.tsx`);
  if (exists(target)) throw new KitError('EXTENSION_EXISTS', `The screen file ${SCREENS_DIR}/${component}.tsx already exists.`);
  const made = screen.split(TEMPLATE_SCREEN).join(component).split(TEMPLATE_ID).join(id).split('"Extension template"').join(JSON.stringify(shown));
  const folder = path.join(root, EXTENSIONS_DIR, id);
  const manifestFile = path.join(folder, MANIFEST_FILE);
  const manifestText = `${JSON.stringify({ id, title: shown, kind: 'ui', routes: [id], protected: false }, null, 2)}\n`;
  fs.mkdirSync(folder, { recursive: true });
  const wrote = [];
  try {
    write(manifestFile, manifestText); wrote.push(manifestFile);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    write(target, made); wrote.push(target);
  } catch (error) {
    for (const file of wrote) { try { fs.unlinkSync(file); } catch { /* nothing more to do */ } }
    try { fs.rmdirSync(folder); } catch { /* the folder holds something the kit did not write, so it stays */ }
    throw error;
  }
  return { id, created: [`${EXTENSIONS_DIR}/${id}/${MANIFEST_FILE}`, `${SCREENS_DIR}/${component}.tsx`], next: mountLines(id, component) };
}

/** Installs the template extension: copies its manifest folder into apps/desktop/extensions. It refuses when the template has no screen in the mount table, because the app would not register it. */
export function installTemplate(root) {
  needTree(root);
  needRealFolder(path.join(root, EXTENSIONS_DIR), EXTENSIONS_DIR);
  const source = path.join(root, TEMPLATE_DIR);
  const read = readExtension(path.dirname(source), path.basename(source));
  if (read.manifest === undefined) throw new KitError(read.code, read.message);
  if (read.manifest.id !== TEMPLATE_ID) throw new KitError('BAD_MANIFEST', `The template manifest must have the id "${TEMPLATE_ID}".`);
  if (!needMountTable(root).has(TEMPLATE_ID)) throw new KitError('NO_SCREEN', `The mount table of ${MOUNTS_FILE} has no screen for "${TEMPLATE_ID}", so the app would not register it.`);
  needFree(root, TEMPLATE_ID);
  const text = fs.readFileSync(path.join(source, MANIFEST_FILE), 'utf8');
  fs.mkdirSync(path.join(root, EXTENSIONS_DIR, TEMPLATE_ID), { recursive: true });
  defaultWrite(path.join(root, EXTENSIONS_DIR, TEMPLATE_ID, MANIFEST_FILE), text);
  return { id: TEMPLATE_ID, created: [`${EXTENSIONS_DIR}/${TEMPLATE_ID}/${MANIFEST_FILE}`] };
}

const REMOVE_NOTE = 'The screen file and the line in the mount table stay. They are source code, and git holds them. Remove them by hand to remove the extension from the app for good.';

/**
 * Removes the manifest folder of an extension, which is all that installs it. After that the app registers no route for it.
 * The folder must be a real folder that holds a manifest.json and plain files only. It is renamed to a unique temporary name inside the extensions folder, checked again (not a link, real path inside
 * the folder), and then only plain files in the renamed folder are deleted, manifest.json last. If an unlink fails, the rest stays where it is under the temporary name, and REMOVE_INCOMPLETE lists it.
 * `ops.unlink` is a test seam. A default extension has no folder here, so it cannot be removed.
 */
export function removeExtension(root, name, ops = {}) {
  const unlink = ops.unlink ?? fs.unlinkSync;
  needTree(root);
  if (!plainName(name)) throw new KitError('BAD_ID', 'The extension name must be one plain folder name.');
  const dir = path.join(root, EXTENSIONS_DIR), folder = path.join(dir, name);
  needRealFolder(dir, EXTENSIONS_DIR);
  let stat;
  try { stat = fs.lstatSync(folder); } catch { throw new KitError('NOT_INSTALLED', `No folder named "${name}" is in ${EXTENSIONS_DIR}.`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new KitError('UNSAFE_PATH', `"${name}" is not a real folder, so it is not removed.`);
  const realDir = fs.realpathSync(dir);
  if (path.dirname(fs.realpathSync(folder)) !== realDir) throw new KitError('UNSAFE_PATH', `"${name}" resolves outside ${EXTENSIONS_DIR}, so it is not removed.`);
  const before = fs.readdirSync(folder, { withFileTypes: true });
  for (const entry of before) if (!entry.isFile()) throw new KitError('UNSAFE_PATH', `"${name}" holds "${entry.name}", which is not a plain file, so nothing is removed.`);
  if (!before.some(entry => entry.name === MANIFEST_FILE)) throw new KitError('NOT_INSTALLED', `The folder "${name}" has no ${MANIFEST_FILE}, so it is not an extension and is not removed.`);
  const temporary = path.join(dir, `.removing-${crypto.randomBytes(6).toString('hex')}`);
  fs.renameSync(folder, temporary);
  const after = fs.lstatSync(temporary);
  if (after.isSymbolicLink() || !after.isDirectory() || path.dirname(fs.realpathSync(temporary)) !== realDir) throw new KitError('UNSAFE_PATH', `"${name}" changed while it was removed, so the kit stopped. It is now ${path.basename(temporary)}.`);
  const entries = fs.readdirSync(temporary, { withFileTypes: true });
  for (const entry of entries) if (!entry.isFile()) throw new KitError('UNSAFE_PATH', `"${name}" changed while it was removed: "${entry.name}" is not a plain file. Nothing was deleted from ${path.basename(temporary)}.`);
  const order = [...entries.map(entry => entry.name).filter(entry => entry !== MANIFEST_FILE).sort(), ...entries.some(entry => entry.name === MANIFEST_FILE) ? [MANIFEST_FILE] : []];
  try {
    for (const entry of order) unlink(path.join(temporary, entry));
    fs.rmdirSync(temporary);
  } catch (error) {
    const left = fs.existsSync(temporary) ? fs.readdirSync(temporary).sort() : [];
    throw new KitError('REMOVE_INCOMPLETE', `The removal of "${name}" stopped (${codeOf(error)}). ${left.length === 0 ? 'Only the empty folder' : `These files remain: ${left.join(', ')}. They are in`} ${EXTENSIONS_DIR}/${path.basename(temporary)}. Delete that by hand.`);
  }
  return { name, removed: [`${EXTENSIONS_DIR}/${name}`], note: REMOVE_NOTE };
}

/** The folders and their ids, for `list`. A folder that cannot be read is listed with its code. */
export function listTree(root) {
  return checkTree(root);
}
