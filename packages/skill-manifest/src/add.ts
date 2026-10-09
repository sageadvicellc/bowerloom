/**
 * Changes to `.bowerloom/skills.json`. A plan binds the manifest's sha256 from before the change (or null when the
 * file is absent), the `.bowerloom` folder's identity, and the new bytes. Apply runs under the project lock, plans
 * again, and writes only when nothing changed; the write replaces the file whole, through a temporary and a rename
 * (or a link, when the file is new, so a file that appeared meanwhile is never overwritten).
 */
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import { isHeldProjectLock } from '../../project-context/src/index.js';
import type { HeldProjectLock } from '../../project-context/src/types.js';
import { manifestRefusal, refuse, requireManifest } from './refusal.js';
import { HARNESSES, MANIFEST_FILE, MANIFEST_FORMAT, MANIFEST_LIMITS, isEntryId, isId, parseManifest, serializeManifest, validateEntry, validateManifest } from './schema.js';
import type { Entry, Manifest } from './schema.js';

export const MANIFEST_CHANGE_FORMAT = 'bowerloom/skills-manifest-change/v1beta1' as const;
export const MANIFEST_PATH = `.bowerloom/${MANIFEST_FILE}` as const;
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

export interface ManifestChangePlan {
  format: typeof MANIFEST_CHANGE_FORMAT;
  project: string;
  manifest: typeof MANIFEST_PATH;
  /** The device and inode of `.bowerloom`, as decimal strings. */
  bowerloom: { device: string; inode: string };
  before: { sha256: string; bytes: number } | null;
  after: { sha256: string; bytes: number };
  /** An add, or a replace of one pinned entry's pin: `from` is the entry as it stands, `to` the entry it becomes. */
  change: { add: Entry } | { replace: { from: Entry; to: Entry } };
  /** The exact new bytes of skills.json. */
  text: string;
  writesAuthorized: false; executionAuthorized: false;
  revision: string;
}
/** What planManifestChange takes: one entry to add, or one pinned entry whose id already exists, with its new pin. */
export type ManifestChange = { add: Entry } | { replace: Entry };
export type ManifestChangeReceipt = { manifest: typeof MANIFEST_PATH; sha256: string; bytes: number } & ({ added: string } | { replaced: string });

/** Adds a local skill entry to a manifest, or starts one for both harnesses. Pure: the input is not changed. */
export function addLocalEntry(m: Manifest | null, id: string, teams: string[]): Manifest {
  requireManifest(isEntryId(id), 'MANIFEST_INVALID');
  requireManifest(Array.isArray(teams) && teams.every(isId) && new Set(teams).size === teams.length, 'MANIFEST_INVALID');
  const base = m === null ? { format: MANIFEST_FORMAT, harnesses: [...HARNESSES], skills: [] as Entry[] } : validateManifest(JSON.parse(serializeManifest(m)));
  requireManifest(!base.skills.some(s => s.id === id), 'MANIFEST_DUPLICATE_ID');
  requireManifest(base.skills.length < MANIFEST_LIMITS.skills, 'MANIFEST_LIMIT');
  const entry: Entry = { id, ...(teams.length ? { teams: [...teams] } : {}), source: { kind: 'local', path: `skills/${id}` } };
  return validateManifest({ format: base.format, harnesses: [...base.harnesses], skills: [...base.skills, entry] });
}

// The temporary name applyManifestChange writes through. A kill between its link and its unlink leaves a second link.
const TEMP_NAME = /^\.skills\.json\.[a-f0-9]{16}\.tmp$/;
/** True when a leftover `.skills.json.*.tmp` in `.bowerloom` is the second link of skills.json. Reads names only. */
function leftoverTempLink(folder: string, file: fs.Stats): boolean {
  try { return fs.readdirSync(folder).some(name => { if (!TEMP_NAME.test(name)) return false; const s = fs.lstatSync(join(folder, name)); return s.isFile() && s.dev === file.dev && s.ino === file.ino; }); }
  catch { return false; }
}
/** MANIFEST_UNSAFE, with the hint that its plain words name the temporary file (review M3 finding 5). The message stays fixed. */
function leftoverLinkRefusal(): Error {
  const error = manifestRefusal('MANIFEST_UNSAFE');
  Object.defineProperty(error, 'hint', { value: 'skills-json-temp-link', enumerable: false });
  return error;
}
interface ManifestState { bowerloom: { device: string; inode: string }; file: { bytes: Buffer; sha256: string } | null }
const owned = (s: fs.Stats) => s.uid === process.getuid?.() && (s.mode & 0o022) === 0;
/**
 * Reads `.bowerloom/skills.json` with the full guards: `.bowerloom` is a real folder owned by this user with no write
 * for others; the file is a regular file with one link, owned by this user, with no write for others, at most 1 MiB,
 * opened without following a link and checked to be the file that was inspected.
 */
export function readManifestState(project: string): ManifestState {
  requireManifest(typeof project === 'string' && isAbsolute(project) && resolve(project) === project && !project.includes('\0'), 'USAGE');
  const folder = join(project, '.bowerloom'), file = join(folder, MANIFEST_FILE);
  let dir: fs.Stats; try { dir = fs.lstatSync(folder); } catch { return refuse('MANIFEST_UNSAFE'); }
  requireManifest(dir.isDirectory() && !dir.isSymbolicLink() && owned(dir), 'MANIFEST_UNSAFE');
  const bowerloom = { device: String(dir.dev), inode: String(dir.ino) };
  let stat: fs.Stats;
  try { stat = fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { bowerloom, file: null }; return refuse('MANIFEST_UNSAFE'); }
  if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink !== 1 && leftoverTempLink(folder, stat)) throw leftoverLinkRefusal();
  requireManifest(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && owned(stat), 'MANIFEST_UNSAFE');
  requireManifest(stat.size <= MANIFEST_LIMITS.bytes, 'MANIFEST_LIMIT');
  let fd: number; try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); } catch { return refuse('MANIFEST_UNSAFE'); }
  try {
    const opened = fs.fstatSync(fd);
    requireManifest(opened.dev === stat.dev && opened.ino === stat.ino && opened.isFile() && opened.nlink === 1, 'MANIFEST_UNSAFE');
    const buffer = Buffer.alloc(MANIFEST_LIMITS.bytes + 1); let length = 0, read = 0;
    while ((read = fs.readSync(fd, buffer, length, buffer.length - length, null)) > 0) { length += read; requireManifest(length <= MANIFEST_LIMITS.bytes, 'MANIFEST_LIMIT'); }
    requireManifest(length === opened.size, 'MANIFEST_UNSAFE');
    const bytes = Buffer.from(buffer.subarray(0, length));
    return { bowerloom, file: { bytes, sha256: sha256(bytes) } };
  } finally { fs.closeSync(fd); }
}

const sourceKey = (e: Entry): string => {
  const s = e.source;
  if (s.kind === 'local') return `local:${s.path}`;
  const root = (e as { skill: { sourceRoot: string } }).skill.sourceRoot;
  return s.kind === 'npm' ? `npm:${s.package}@${s.version}:${root}` : `git:${s.repository}@${s.commit}:${root}`;
};
function revisionOf(body: Omit<ManifestChangePlan, 'revision'>): string { return sha256(canonicalJson(body)); }

/** The package of an npm entry or the repository of a Git entry, with its kind: what a replace must keep. */
const originKey = (e: Entry): string => e.source.kind === 'npm' ? `npm:${e.source.package}` : e.source.kind === 'git' ? `git:${e.source.repository}` : `local:${e.id}`;
/** The entry a replace moves: it must exist, be pinned, and keep its kind and its package or repository. */
export function replaceTarget(skills: readonly Entry[], entry: Entry): Entry {
  const from = skills.find(s => s.id === entry.id);
  requireManifest(from, 'SKILLS_ADD_REPLACE_MISSING');
  requireManifest(from.source.kind !== 'local' && originKey(from) === originKey(entry), 'SKILLS_ADD_SOURCE_CHANGED');
  return from;
}

/**
 * A plan to add one entry, or to replace the pin of one entry. It reads skills.json and writes nothing.
 * A replace keeps the id, the kind and the package or repository; the version or commit, the folder and the teams
 * come from the new entry. Like an add, it binds the sha256 of skills.json as it stands.
 */
export function planManifestChange(project: string, change: ManifestChange): ManifestChangePlan {
  const state = readManifestState(project);
  requireManifest(change !== null && typeof change === 'object' && Object.keys(change).length === 1 && (Object.hasOwn(change, 'add') || Object.hasOwn(change, 'replace')), 'MANIFEST_INVALID');
  const replacing = 'replace' in change;
  const entry = validateEntry(replacing ? change.replace : change.add);
  const current = state.file ? parseManifest(state.file.bytes) : null;
  let skills: Entry[], from: Entry | null = null;
  if (replacing) {
    requireManifest(entry.source.kind !== 'local', 'MANIFEST_INVALID');
    from = replaceTarget(current?.skills ?? [], entry);
    // An unchanged pin, or a pin another entry already holds, is the add refusal: skills.json already pins this.
    requireManifest(!current!.skills.some(s => sourceKey(s) === sourceKey(entry)), 'SKILLS_ADD_EXISTS');
    skills = current!.skills.map(s => s.id === entry.id ? entry : s);
  } else {
    if (current) requireManifest(!current.skills.some(s => s.id === entry.id || sourceKey(s) === sourceKey(entry)), 'SKILLS_ADD_EXISTS');
    requireManifest((current?.skills.length ?? 0) < MANIFEST_LIMITS.skills, 'MANIFEST_LIMIT');
    skills = [...(current?.skills ?? []), entry];
  }
  const next = validateManifest({ format: MANIFEST_FORMAT, harnesses: [...(current?.harnesses ?? HARNESSES)], skills });
  const text = serializeManifest(next);
  const written = next.skills.find(s => s.id === entry.id)!;
  const body: Omit<ManifestChangePlan, 'revision'> = {
    format: MANIFEST_CHANGE_FORMAT, project, manifest: MANIFEST_PATH, bowerloom: state.bowerloom,
    before: state.file ? { sha256: state.file.sha256, bytes: state.file.bytes.length } : null,
    after: { sha256: sha256(text), bytes: Buffer.byteLength(text) },
    change: from ? { replace: { from, to: written } } : { add: written }, text, writesAuthorized: false, executionAuthorized: false,
  };
  return { ...body, revision: revisionOf(body) };
}
/** The input that makes `plan` again. */
const changeOf = (plan: ManifestChangePlan): ManifestChange => {
  const c = plan.change as Partial<{ add: Entry; replace: { to: Entry } }> | null;
  requireManifest(c !== null && typeof c === 'object', 'STALE_APPROVAL');
  if (c.replace !== undefined && c.add === undefined) { requireManifest(c.replace !== null && typeof c.replace === 'object', 'STALE_APPROVAL'); return { replace: c.replace.to }; }
  requireManifest(c.add !== undefined && c.replace === undefined, 'STALE_APPROVAL');
  return { add: c.add };
};

const stale = () => manifestRefusal('STALE_APPROVAL');
function syncFolder(path: string): void { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

/**
 * Writes the planned bytes. `held` must be the live lock of this project. The plan must be self-consistent and equal
 * a plan made again now, and the file must still have its planned sha256 just before the rename; otherwise
 * STALE_APPROVAL, and nothing is written.
 */
export function applyManifestChange(plan: ManifestChangePlan, revision: string, held: HeldProjectLock): ManifestChangeReceipt {
  if (!isHeldProjectLock(held)) refuse('PROJECT_LOCKED');
  requireManifest(plan !== null && typeof plan === 'object' && typeof plan.project === 'string', 'STALE_APPROVAL');
  held.assertHeld(plan.project);
  const { revision: claimed, ...body } = plan;
  if (typeof revision !== 'string' || revision !== claimed || revisionOf(body) !== revision) throw stale();
  const again = planManifestChange(plan.project, changeOf(plan));
  if (again.revision !== revision) throw stale();
  const folder = join(plan.project, '.bowerloom'), target = join(folder, MANIFEST_FILE);
  const temp = join(folder, `.${MANIFEST_FILE}.${randomBytes(8).toString('hex')}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644); created = true;
    try { fs.fchmodSync(fd, 0o644); const data = Buffer.from(again.text); let at = 0; while (at < data.length) at += fs.writeSync(fd, data, at); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    held.assertHeld(plan.project);
    const now = readManifestState(plan.project);
    if (now.bowerloom.device !== again.bowerloom.device || now.bowerloom.inode !== again.bowerloom.inode || (now.file?.sha256 ?? null) !== (again.before?.sha256 ?? null)) throw stale();
    if (again.before === null) {
      try { fs.linkSync(temp, target); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw stale(); throw error; }
      fs.unlinkSync(temp);
    } else fs.renameSync(temp, target);
    created = false;
    syncFolder(folder);
  } finally { if (created) { try { fs.unlinkSync(temp); } catch { /* Already gone. */ } } }
  // The file was written. A mismatch now is not a stale plan: it gets its own code and words (review M3 finding 5).
  const written = readManifestState(plan.project);
  requireManifest(written.file?.sha256 === again.after.sha256, 'MANIFEST_WRITE_UNCONFIRMED');
  const done = 'replace' in again.change ? { replaced: again.change.replace.to.id } : { added: again.change.add.id };
  return { manifest: MANIFEST_PATH, ...done, sha256: again.after.sha256, bytes: again.after.bytes };
}
