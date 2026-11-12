// The logic of tools/extension-kit.mjs: make, check, install and remove a stock extension of the desktop app. Never shipped.
// An extension of v0.9 is a manifest folder in apps/desktop/extensions plus a screen that is compiled into the app. A manifest carries no code, and this kit loads no code.
// The manifest rules here are the rules of apps/desktop/shared/extensions/manifest.ts, and the loader rules are those of apps/desktop/main/extension-loader.ts.
// A test (apps/desktop/tests/extension-kit-parity.test.ts) holds the two sides equal, so a rule cannot change on one side alone.
import fs from 'node:fs';
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
export const KIT_CODES = Object.freeze(['BAD_ID', 'NO_SCREEN', 'NOT_A_TREE', 'UNSAFE_PATH', 'NOT_INSTALLED']);
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
const plainName = name => typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && !path.isAbsolute(name);

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
  return { name, manifest: checked.value };
}

const isDir = at => { try { return fs.statSync(at).isDirectory(); } catch { return false; } };
const exists = at => { try { fs.lstatSync(at); return true; } catch { return false; } };

/** The id keys of the mount table in extension-mounts.tsx (the object named BUNDLED_MOUNTS), or null when the file or the table is not there. */
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

function needTree(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new KitError('NOT_A_TREE', 'The repository root must be an absolute path.');
  if (!isDir(path.join(root, 'apps', 'desktop'))) throw new KitError('NOT_A_TREE', 'This is not the Bowerloom repository: apps/desktop is missing.');
}

/**
 * Checks every folder under apps/desktop/extensions in name order, as the app loads them. A problem has a code: a loader code, RESERVED, EXTENSION_EXISTS, ROUTE_TAKEN,
 * or NO_SCREEN (a valid manifest that has no screen in the mount table, so the app would not register it). `only` limits the report to one folder, but every folder is still read, so a taken route is found.
 */
export function checkTree(root, only = null) {
  needTree(root);
  const dir = path.join(root, EXTENSIONS_DIR);
  const extensions = [], problems = [];
  let names = [];
  if (exists(dir)) {
    if (!isDir(dir)) throw new KitError('UNSAFE_PATH', `${EXTENSIONS_DIR} is not a folder.`);
    names = fs.readdirSync(dir).sort();
  }
  const mounted = mountedIds(root);
  const ids = new Map(), owners = new Map();
  for (const name of names) {
    const read = readExtension(dir, name);
    if (read.manifest === undefined) { problems.push({ name, code: read.code, message: read.message }); continue; }
    const m = read.manifest;
    const reserved = reservedProblem(m);
    if (reserved !== null) { problems.push({ name, ...reserved }); continue; }
    if (ids.has(m.id)) { problems.push({ name, code: 'EXTENSION_EXISTS', message: `An extension with the id "${m.id}" is already registered by the folder "${ids.get(m.id)}".` }); continue; }
    const taken = m.routes.find(r => owners.has(r));
    if (taken !== undefined) { problems.push({ name, code: 'ROUTE_TAKEN', message: `The route "${taken}" already belongs to the extension "${owners.get(taken)}".` }); continue; }
    ids.set(m.id, name);
    for (const route of m.routes) owners.set(route, m.id);
    if (mounted !== null && !mounted.has(m.id)) { problems.push({ name, code: 'NO_SCREEN', message: `The extension "${m.id}" has no screen in the mount table of ${MOUNTS_FILE}, so the app does not register it.` }); continue; }
    extensions.push({ name, id: m.id, title: m.title, routes: m.routes });
  }
  if (only !== null) {
    if (!names.includes(only)) throw new KitError('NOT_INSTALLED', `No folder named "${only}" is in ${EXTENSIONS_DIR}.`);
    return { extensions: extensions.filter(e => e.name === only), problems: problems.filter(p => p.name === only) };
  }
  return { extensions, problems };
}

const pascal = id => id.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const titleOf = id => { const text = id.split('-').join(' '); return text.charAt(0).toUpperCase() + text.slice(1); };

/** The id of a new extension must be a name, and not a default name. */
export function checkNewId(id) {
  if (typeof id !== 'string' || !NAME.test(id)) throw new KitError('BAD_ID', 'The id must be lowercase letters, digits and hyphens, and start with a letter or a digit.');
  if (RESERVED_NAMES.has(id)) throw new KitError('RESERVED', `The name "${id}" belongs to the app and cannot be the id of a loaded extension.`);
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

function writeNew(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o644 });
}

/** The line to add to the mount table, and the import that goes with it. The kit prints them and edits no source file. */
export function mountLines(id, component) {
  return {
    importLine: `import { ${component} } from './extensions/${component}.js';`,
    tableLine: `  '${id}': ({ route }) => (route.name === 'extension' && route.route === '${id}' ? <${component} /> : stray(route)),`,
  };
}

/**
 * Makes the folder of a new stock extension and its screen file, from the template. The route of the extension is its id. It writes two files and refuses to write over a file.
 * It edits no source file: the result says which two lines to add to the mount table, and `check` reports NO_SCREEN until they are added.
 */
export function scaffold(root, { id, title = null }) {
  needTree(root);
  checkNewId(id);
  const shown = title === null ? titleOf(id) : title;
  const checked = checkManifestValue({ id, title: shown, kind: 'ui', routes: [id], protected: false });
  if (!checked.ok) throw new KitError('BAD_MANIFEST', checked.message);
  needFree(root, id);
  const component = pascal(id);
  const source = path.join(root, SCREENS_DIR, `${TEMPLATE_SCREEN}.tsx`);
  let screen;
  try { screen = fs.readFileSync(source, 'utf8'); } catch { throw new KitError('NOT_A_TREE', `The template screen ${SCREENS_DIR}/${TEMPLATE_SCREEN}.tsx is missing.`); }
  const target = path.join(root, SCREENS_DIR, `${component}.tsx`);
  if (exists(target)) throw new KitError('EXTENSION_EXISTS', `The screen file ${SCREENS_DIR}/${component}.tsx already exists.`);
  const made = screen.split(TEMPLATE_SCREEN).join(component).split(TEMPLATE_ID).join(id).split('Extension template').join(shown);
  const manifestFile = path.join(root, EXTENSIONS_DIR, id, MANIFEST_FILE);
  const manifestText = `${JSON.stringify({ id, title: shown, kind: 'ui', routes: [id], protected: false }, null, 2)}\n`;
  writeNew(manifestFile, manifestText);
  try { writeNew(target, made); } catch (error) { fs.rmSync(path.dirname(manifestFile), { recursive: true, force: true }); throw error; }
  return { id, created: [`${EXTENSIONS_DIR}/${id}/${MANIFEST_FILE}`, `${SCREENS_DIR}/${component}.tsx`], next: mountLines(id, component) };
}

/** Installs the template extension: copies its manifest folder into apps/desktop/extensions. The screen of the template is already compiled into the app. */
export function installTemplate(root) {
  needTree(root);
  const source = path.join(root, TEMPLATE_DIR);
  const read = readExtension(path.dirname(source), path.basename(source));
  if (read.manifest === undefined) throw new KitError(read.code, read.message);
  if (read.manifest.id !== TEMPLATE_ID) throw new KitError('BAD_MANIFEST', `The template manifest must have the id "${TEMPLATE_ID}".`);
  needFree(root, TEMPLATE_ID);
  const text = fs.readFileSync(path.join(source, MANIFEST_FILE), 'utf8');
  writeNew(path.join(root, EXTENSIONS_DIR, TEMPLATE_ID, MANIFEST_FILE), text);
  return { id: TEMPLATE_ID, created: [`${EXTENSIONS_DIR}/${TEMPLATE_ID}/${MANIFEST_FILE}`] };
}

/**
 * Removes the manifest folder of an extension, which is all that installs it. After that the app registers no route for it. The folder must be a real folder with a manifest file in it, and nothing else but
 * regular files is deleted. A link is refused. The screen file stays: it is source, and git holds it. Removing a default extension is impossible, because a default has no folder here.
 */
export function removeExtension(root, name) {
  needTree(root);
  if (!plainName(name)) throw new KitError('BAD_ID', 'The extension name must be one plain folder name.');
  const dir = path.join(root, EXTENSIONS_DIR), folder = path.join(dir, name);
  let stat;
  try { stat = fs.lstatSync(folder); } catch { throw new KitError('NOT_INSTALLED', `No folder named "${name}" is in ${EXTENSIONS_DIR}.`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new KitError('UNSAFE_PATH', `"${name}" is not a real folder, so it is not removed.`);
  const real = fs.realpathSync(folder);
  if (path.dirname(real) !== fs.realpathSync(dir)) throw new KitError('UNSAFE_PATH', `"${name}" resolves outside ${EXTENSIONS_DIR}, so it is not removed.`);
  const entries = fs.readdirSync(folder, { withFileTypes: true });
  for (const entry of entries) if (!entry.isFile()) throw new KitError('UNSAFE_PATH', `"${name}" holds "${entry.name}", which is not a plain file, so nothing is removed.`);
  for (const entry of entries) fs.unlinkSync(path.join(folder, entry.name));
  fs.rmdirSync(folder);
  return { name, removed: [`${EXTENSIONS_DIR}/${name}`] };
}

/** The folders and their ids, for `list`. A folder that cannot be read is listed with its code. */
export function listTree(root) {
  const { extensions, problems } = checkTree(root);
  return { extensions, problems };
}
