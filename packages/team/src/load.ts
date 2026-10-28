/**
 * `loadTeam(folder)` reads one `.bowerloom/teams/<id>/` folder laid out as in section 9 and checks it. It writes
 * nothing, opens no socket, and starts no process.
 *
 * - It reads `team.json`, `maps/relay.json`, the kept `x-crew-v0.7/` files, and the 0.7 files of the folder
 *   (`team.yaml`, `agents/`, `prompts/`, `skills/`, `assets/`, `maps/vines.json`). All of them are scanned for secrets
 *   and bypass forms and are in the revision (ruling T10).
 * - A file name that is not plain, or that the secret scan finds, is refused and never shown (ruling T4).
 * - A missing folder, a folder that cannot be read, and a link are different problems (ruling T14).
 * Every file is read through the projection's safe reader: a plain file of this user, one link, at most 1 MiB.
 */
import fs from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { DefinitionFile, Problem } from '../../harness-definition/src/index.js';
import { isSafeName } from '../../harness-definition/src/index.js';
import { PortableRefusal, readAbs } from '../../project-sync/src/portable-files.js';
import { finish, unsafeText } from './messages.js';
import type { TeamLoadResult, TeamOptions } from './types.js';
import { validateTeam } from './validate.js';
import { CREW_BLOCK, MAP_NAMES, TEAM_LEGACY_NAMES, TEAM_LIMITS } from './words.js';

/** A fault that stops the read. */
export class ReadFault extends Error {
  constructor(readonly code: 'TEAM_FILE_MISSING' | 'TEAM_FILE_UNREADABLE' | 'TEAM_FILE_UNSAFE' | 'TEAM_TOO_LARGE', readonly rel: string, message: string) { super(message); }
}
const errno = (e: unknown) => (e as NodeJS.ErrnoException).code;

/** True when a file name can be read, shown, and kept: plain characters, no secret shape, no secret assignment. */
export function plainName(name: string): boolean {
  return isSafeName(name) && !unsafeText(name);
}

/** Loads and checks a team folder. `options.approvals` are the recorded fidelity approvals for team guardrails. */
export function loadTeam(folder: string, options: TeamOptions = {}): TeamLoadResult {
  const root = resolve(folder);
  const problems: Problem[] = [];
  const files: DefinitionFile[] = [];
  try {
    const reader = new TeamReader(root, problems);
    reader.folder('.');
    for (const name of reader.list('.')) {
      if (name === 'team.json') files.push(reader.file('team.json'));
      else if (name === 'maps') {
        reader.folder('maps');
        for (const n of reader.list('maps')) {
          if ((MAP_NAMES as readonly string[]).includes(n)) files.push(reader.file(`maps/${n}`));
          else problems.push({ code: 'TEAM_UNKNOWN_FILE', path: `maps/${n}`, message: `maps/ holds "${n}". It holds only relay.json and the 0.7 vines.json.` });
        }
      } else if (name === CREW_BLOCK || (TEAM_LEGACY_NAMES as readonly string[]).includes(name)) files.push(...reader.tree(name, 1));
      else problems.push({ code: 'TEAM_UNKNOWN_FILE', path: name, message: `The team folder holds "${name}", which a team folder does not define. The names are team.json, maps/, and ${CREW_BLOCK}/, and the 0.7 names ${TEAM_LEGACY_NAMES.join(', ')}.` });
    }
  } catch (error) {
    if (error instanceof ReadFault) return { ok: false, problems: finish([...problems, { code: error.code, path: error.rel, message: error.message }]) };
    throw error;
  }
  const result = validateTeam(files, { ...options, folderName: basename(root), folder: root });
  return problems.length ? { ok: false, problems: finish([...problems, ...(result.ok ? [] : result.problems)]) } : result;
}

/** Reads a team folder: checked names, real folders, and a bound on files and depth. */
export class TeamReader {
  private count = 0;
  private bytes = 0;
  constructor(readonly root: string, readonly problems: Problem[]) {}

  /** The plain names in a folder, in byte order. A name that is not plain is a problem and is skipped. */
  list(rel: string): string[] {
    let names: string[];
    try { names = fs.readdirSync(join(this.root, rel)); } catch (e) { throw this.fault(e, rel); }
    const out: string[] = [];
    for (const name of names.sort()) {
      if (plainName(name)) { out.push(name); continue; }
      this.problems.push({ code: 'TEAM_FILE_NAME', path: rel === '.' ? '(a name not shown)' : `${rel}/(a name not shown)`, message: 'A file name is not plain: it has a character outside letters, digits, and . _ @ : -, is longer than 64 characters, or looks like a secret. Rename the file.' });
    }
    return out;
  }

  /** Requires a real folder of this user at `rel`. */
  folder(rel: string): void {
    let st: fs.Stats;
    try { st = fs.lstatSync(join(this.root, rel)); } catch (e) { throw this.fault(e, rel); }
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== process.getuid?.()) throw new ReadFault('TEAM_FILE_UNSAFE', rel, `${rel} is a link, or not a folder of yours. Nothing was read past it.`);
  }

  /** Reads one plain file. */
  file(rel: string): DefinitionFile {
    if (++this.count > TEAM_LIMITS.files) throw new ReadFault('TEAM_TOO_LARGE', rel, `The team folder holds more than ${TEAM_LIMITS.files} files.`);
    const abs = join(this.root, rel);
    let st: fs.Stats;
    try { st = fs.lstatSync(abs); } catch (e) { throw this.fault(e, rel); }
    if (st.isSymbolicLink() || !st.isFile()) throw new ReadFault('TEAM_FILE_UNSAFE', rel, `${rel} is a link or not a plain file. Nothing was read past it.`);
    try {
      const r = readAbs(abs, rel);
      if (!r) throw new ReadFault('TEAM_FILE_MISSING', rel, `${rel} went away while it was read.`);
      this.bytes += r.bytes.length;
      if (this.bytes > TEAM_LIMITS.totalBytes) throw new ReadFault('TEAM_TOO_LARGE', rel, `The team folder holds more than ${TEAM_LIMITS.totalBytes} bytes.`);
      return { path: rel, bytes: r.bytes };
    } catch (error) {
      if (!(error instanceof PortableRefusal)) throw error;
      try { fs.accessSync(abs, fs.constants.R_OK); } catch { throw new ReadFault('TEAM_FILE_UNREADABLE', rel, `${rel} cannot be read.`); }
      throw new ReadFault('TEAM_FILE_UNSAFE', rel, `${rel} is not a plain file of yours, has more than one link, or is larger than 1 MiB.`);
    }
  }

  /** Every file under `rel`, a file or a folder, to the depth limit. */
  tree(rel: string, depth: number): DefinitionFile[] {
    let st: fs.Stats;
    try { st = fs.lstatSync(join(this.root, rel)); } catch (e) { throw this.fault(e, rel); }
    if (!st.isDirectory() || st.isSymbolicLink()) return [this.file(rel)];
    if (depth > TEAM_LIMITS.keptDepth) throw new ReadFault('TEAM_TOO_LARGE', rel, `${rel} is deeper than ${TEAM_LIMITS.keptDepth} folders.`);
    this.folder(rel);
    return this.list(rel).flatMap(name => this.tree(`${rel}/${name}`, depth + 1));
  }

  private fault(e: unknown, rel: string): ReadFault {
    const code = errno(e);
    if (code === 'ENOENT') return new ReadFault('TEAM_FILE_MISSING', rel, rel === '.' ? 'The team folder does not exist.' : `${rel} does not exist.`);
    if (code === 'EACCES' || code === 'EPERM') return new ReadFault('TEAM_FILE_UNREADABLE', rel, `${rel === '.' ? 'The team folder' : rel} cannot be read (${code}).`);
    return new ReadFault('TEAM_FILE_UNSAFE', rel, `${rel === '.' ? 'The team folder' : rel} cannot be read safely (${code ?? 'unknown error'}).`);
  }
}
