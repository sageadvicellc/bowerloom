/**
 * The private state layout of the 0.8 harness commands, shared by the command line and the app so that one folder has
 * one record (step 5, decision I2 A). The record sits in the 0.7 per-project folder, keyed by the 0.7 project id:
 *
 *   <stateRoot>/<projectId>/harness/{adoption/, portable/, approvals.json, moved.json}
 *
 * The app of steps 2 to 4 kept its record at `<stateRoot>/desktop/<sha256(path), first 32 hex>/`. `settleLegacyState`
 * moves that folder once, with one rename under the project lock (decision I3 A). A receipt binds the project folder,
 * not its state path, so a moved record stays valid.
 *
 * A crash at any point of the move is safe. Before the rename, a marker (`moving.json`) is written inside the old
 * folder, so it travels with the rename. The next call finds the marker in the new folder and finishes the record, or
 * finds it in the old folder and renames again. `moved.json` is written only after the rename.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { DefinitionError } from '../../contracts/src/index.js';
import { withProjectLock } from '../../project-context/src/index.js';
import { pin, projectId } from '../../project-context/src/discovery.js';
import { readAbs, refuse, syncDir, uid, writeAbs } from './portable-files.js';
import { checkPaths, stateExists } from './portable-state.js';

// ---- refusals ----------------------------------------------------------------------------------------------------------

const MESSAGES = {
  HARNESS_STATE_TWO_RECORDS: 'Two private records exist for this folder: the record of the earlier app and the shared one. Bowerloom does not pick one. Nothing was changed.',
  HARNESS_APPROVAL_STALE: 'The entry this approval names changed, or is gone, since the line was shown. Plan again and accept the new line. Nothing was written.',
} as const;
export type HarnessStateCode = keyof typeof MESSAGES;
export const HARNESS_STATE_REFUSAL_CODES: readonly HarnessStateCode[] = Object.freeze(Object.keys(MESSAGES) as HarnessStateCode[]);

/** A refusal of the shared state layout or of an approval draft. The message never carries a path. */
export class HarnessStateRefusal extends DefinitionError {
  constructor(code: HarnessStateCode) {
    super(code, MESSAGES[code]);
    this.name = 'HarnessStateRefusal';
  }
}
export function refuseHarness(code: HarnessStateCode): never { throw new HarnessStateRefusal(code); }

// ---- the layout --------------------------------------------------------------------------------------------------------

export interface HarnessStateDirs {
  /** `<stateRoot>/<projectId>/harness`, mode 0700. */
  readonly base: string;
  /** `AdoptionInput.stateDir`. */
  readonly adoption: string;
  /** `PortableInput.stateDir`. */
  readonly portable: string;
  /** The approval drafts file (harness-approvals.ts). */
  readonly approvals: string;
  /** The record of the earlier app, `<stateRoot>/desktop/<key>`. Read only to move it. */
  readonly legacy: string;
}
export const HARNESS_MOVED_FORMAT = 'bowerloom/harness-state-moved/v1' as const;
export const HARNESS_MOVING_FORMAT = 'bowerloom/harness-state-moving/v1' as const;
const MOVED = 'moved.json', MOVING = 'moving.json';
const KEYS = ['base', 'adoption', 'portable', 'approvals', 'legacy'] as const;

const cleanPath = (p: unknown): p is string =>
  typeof p === 'string' && isAbsolute(p) && !p.includes('\0') && p.length <= 4096 && p !== '/' && !p.endsWith('/') && normalize(p) === p;

/** The key of the earlier app record: sha256 over the folder path as given, first 32 hex characters. */
const legacyKey = (projectDir: string): string => createHash('sha256').update(projectDir).digest('hex').slice(0, 32);

/**
 * The state folders of one project. `projectDir` must be the real path of a folder, as discovery gives it. Reads the
 * folder's device and inode for the 0.7 project id and touches nothing. PORTABLE_USAGE for any other input.
 */
export function harnessStateDirs(stateRoot: string, projectDir: string): HarnessStateDirs {
  if (!cleanPath(stateRoot) || !cleanPath(projectDir)) refuse('PORTABLE_USAGE');
  let id: string;
  try {
    if (fs.realpathSync(projectDir) !== projectDir) refuse('PORTABLE_USAGE');
    id = projectId(projectDir, pin(projectDir));
  } catch { return refuse('PORTABLE_USAGE'); }
  const base = join(stateRoot, id, 'harness');
  return Object.freeze({
    base, adoption: join(base, 'adoption'), portable: join(base, 'portable'), approvals: join(base, 'approvals.json'),
    legacy: join(stateRoot, 'desktop', legacyKey(projectDir)),
  });
}

/** The state root of a layout. */
const rootOf = (dirs: HarnessStateDirs): string => dirname(dirname(dirs.base));

/**
 * Checks that `dirs` is the layout of `projectDir`, exactly, and that the state sits outside the project. Returns the
 * layout as computed now. PORTABLE_USAGE for layout folders of another project, PORTABLE_STATE_UNSAFE for state inside it.
 */
export function checkLayout(dirs: unknown, projectDir: unknown): HarnessStateDirs {
  if (typeof dirs !== 'object' || dirs === null || Array.isArray(dirs)) return refuse('PORTABLE_USAGE');
  const given = dirs as Record<string, unknown>;
  if (Object.keys(given).length !== KEYS.length || !KEYS.every(k => cleanPath(given[k]))) refuse('PORTABLE_USAGE');
  if (!cleanPath(projectDir)) refuse('PORTABLE_USAGE');
  const expected = harnessStateDirs(rootOf(given as unknown as HarnessStateDirs), projectDir);
  if (!KEYS.every(k => given[k] === expected[k])) refuse('PORTABLE_USAGE');
  checkPaths(projectDir, expected.base);
  return expected;
}

// ---- folder checks -----------------------------------------------------------------------------------------------------

/**
 * A folder above a record (the state root, the project id folder, `desktop/`): false when absent; otherwise it must be
 * a real folder, not a link, owned by this user, with no group or world write. PORTABLE_STATE_UNSAFE when not.
 */
export function parentFolder(p: string): boolean {
  let st: fs.Stats;
  try { st = fs.lstatSync(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; return refuse('PORTABLE_STATE_UNSAFE'); }
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid() || (st.mode & 0o022) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  return true;
}
/** True when the record folder `base` of a layout exists, after every folder from the state root down is checked. */
export function recordExists(dirs: HarnessStateDirs): boolean {
  return parentFolder(rootOf(dirs)) && parentFolder(dirname(dirs.base)) && stateExists(dirs.base);
}
/** Creates the record folder, 0700, after the checks; the project id folder too, 0700, when absent. */
export function ensureRecordFolder(dirs: HarnessStateDirs): void {
  if (recordExists(dirs)) return;
  fs.mkdirSync(dirs.base, { recursive: true, mode: 0o700 });
  if (!recordExists(dirs)) refuse('PORTABLE_STATE_UNSAFE');
}
const legacyExists = (dirs: HarnessStateDirs): boolean =>
  parentFolder(rootOf(dirs)) && parentFolder(dirname(dirs.legacy)) && stateExists(dirs.legacy);

// ---- small records -----------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isoSeconds = (d: Date): string => `${d.toISOString().slice(0, 19)}Z`;

/** A private JSON record: null when absent. A link, a shared file, or a file open to others refuses PORTABLE_STATE_UNSAFE. */
export function readPrivateJson(abs: string, name: string): unknown {
  let got: ReturnType<typeof readAbs>;
  try { got = readAbs(abs, name); } catch { return refuse('PORTABLE_STATE_UNSAFE'); }
  if (got === null) return null;
  if ((got.state.mode & 0o077) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  try { return JSON.parse(got.bytes.toString('utf8')) as unknown; } catch { return refuse('PORTABLE_STATE_INVALID', [name]); }
}
export function writePrivateJson(abs: string, value: unknown): void {
  writeAbs(abs, Buffer.from(JSON.stringify(value, null, 2) + '\n'), 0o600);
}
function unlinkIfThere(abs: string): void {
  try { fs.unlinkSync(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

/** The move marker or the move record in `folder`: null when absent, refused when damaged or of another project. */
function readMoveFile(folder: string, name: typeof MOVED | typeof MOVING, projectDir: string, from: string): Record<string, unknown> | null {
  const raw = readPrivateJson(join(folder, name), name);
  if (raw === null) return null;
  const keys = name === MOVED ? ['format', 'projectDir', 'from', 'when'] : ['format', 'projectDir', 'from'];
  if (!isObj(raw) || Object.keys(raw).length !== keys.length || !keys.every(k => Object.hasOwn(raw, k))) refuse('PORTABLE_STATE_INVALID', [name]);
  const format = name === MOVED ? HARNESS_MOVED_FORMAT : HARNESS_MOVING_FORMAT;
  if (raw.format !== format || raw.from !== from || typeof raw.projectDir !== 'string') refuse('PORTABLE_STATE_INVALID', [name]);
  if (name === MOVED && (typeof raw.when !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(raw.when))) refuse('PORTABLE_STATE_INVALID', [name]);
  if (raw.projectDir !== projectDir) refuse('PORTABLE_STATE_FOREIGN');
  return raw;
}

// ---- the move ----------------------------------------------------------------------------------------------------------

/** `moved`: this call renamed the old record. `completed`: it finished a move that stopped part way. `none`: nothing to do. */
export type LegacySettle = 'none' | 'moved' | 'completed';
/** Test hooks: each runs at one point of the move, so a test can stop the move there. */
export interface SettleHooks {
  readonly beforeRename?: () => void;
  readonly afterRename?: () => void;
  readonly afterRecord?: () => void;
}

/**
 * Moves the record of the earlier app into the shared layout, once, under the project lock. Old record present and
 * shared record absent: one rename, then `moved.json`. Both present: HARNESS_STATE_TWO_RECORDS, and nothing changes.
 * A link, a folder of another owner, or a folder open to others on either path refuses PORTABLE_STATE_UNSAFE.
 * Run it before the first read of the record. A second call changes nothing.
 */
export async function settleLegacyState(dirs: HarnessStateDirs, projectDir: string, signal?: AbortSignal): Promise<LegacySettle> {
  return settleLegacyStateWith(dirs, projectDir, signal, {});
}

/** `settleLegacyState` with test hooks. Not exported from the package index. */
export async function settleLegacyStateWith(dirs: HarnessStateDirs, projectDir: string, signal: AbortSignal | undefined, hooks: SettleHooks): Promise<LegacySettle> {
  const layout = checkLayout(dirs, projectDir);
  const from = relative(rootOf(layout), layout.legacy);
  return withProjectLock(projectDir, signal ?? new AbortController().signal, async held => {
    const hasBase = recordExists(layout), hasLegacy = legacyExists(layout);
    if (hasBase && hasLegacy) refuseHarness('HARNESS_STATE_TWO_RECORDS');
    if (hasBase) {
      // A marker in the shared record means a move stopped after its rename: finish the record.
      if (readMoveFile(layout.base, MOVING, projectDir, from) === null) return 'none';
      if (readMoveFile(layout.base, MOVED, projectDir, from) === null) {
        held.assertHeld(projectDir);
        writePrivateJson(join(layout.base, MOVED), { format: HARNESS_MOVED_FORMAT, projectDir, from, when: isoSeconds(new Date()) });
      }
      unlinkIfThere(join(layout.base, MOVING)); syncDir(layout.base);
      return 'completed';
    }
    if (!hasLegacy) return 'none';

    // The marker goes inside the old folder, so the rename carries it.
    if (readMoveFile(layout.legacy, MOVING, projectDir, from) === null) {
      held.assertHeld(projectDir);
      writePrivateJson(join(layout.legacy, MOVING), { format: HARNESS_MOVING_FORMAT, projectDir, from });
    }
    hooks.beforeRename?.();
    const projectFolder = dirname(layout.base);
    if (!parentFolder(projectFolder)) { fs.mkdirSync(projectFolder, { recursive: true, mode: 0o700 }); if (!parentFolder(projectFolder)) refuse('PORTABLE_STATE_UNSAFE'); }
    // Check again right before the rename: the old record is still a private folder, and nothing sits at the new path.
    held.assertHeld(projectDir);
    if (recordExists(layout)) refuseHarness('HARNESS_STATE_TWO_RECORDS');
    if (!legacyExists(layout)) refuse('PORTABLE_STATE_UNSAFE');
    fs.renameSync(layout.legacy, layout.base);
    syncDir(projectFolder); syncDir(dirname(layout.legacy));
    hooks.afterRename?.();
    writePrivateJson(join(layout.base, MOVED), { format: HARNESS_MOVED_FORMAT, projectDir, from, when: isoSeconds(new Date()) });
    hooks.afterRecord?.();
    unlinkIfThere(join(layout.base, MOVING)); syncDir(layout.base);
    return 'moved';
  });
}
