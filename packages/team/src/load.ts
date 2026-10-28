/**
 * `loadTeam(folder)` reads one `.bowerloom/teams/<id>/` folder laid out as in section 9 and checks it. It writes
 * nothing, opens no socket, and starts no process. Every file is read through the projection's safe reader: a plain
 * file of this user, one link, no symbolic link, at most 1 MiB. A folder on the way must be a real folder.
 */
import fs from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { DefinitionFile, Problem } from '../../harness-definition/src/index.js';
import { safeName } from '../../harness-definition/src/index.js';
import { PortableRefusal, readAbs } from '../../project-sync/src/portable-files.js';
import type { TeamLoadResult, TeamOptions } from './types.js';
import { validateTeam } from './validate.js';
import { CREW_BLOCK, MAP_NAMES, RELAY_MAP_PATH, TEAM_LEGACY_NAMES, TEAM_LIMITS, TEAM_NAMES } from './words.js';

class Unsafe extends Error {
  constructor(readonly rel: string) { super(rel); }
}

/** Loads and checks a team folder. `options.approvals` are the recorded fidelity approvals for team guardrails. */
export function loadTeam(folder: string, options: TeamOptions = {}): TeamLoadResult {
  const root = resolve(folder);
  const problems: Problem[] = [];
  const files: DefinitionFile[] = [];
  try {
    realFolder(root, '.');
    for (const name of fs.readdirSync(root).sort()) {
      if ((TEAM_NAMES as readonly string[]).includes(name) || (TEAM_LEGACY_NAMES as readonly string[]).includes(name)) continue;
      problems.push({ code: 'TEAM_UNKNOWN_FILE', path: name, message: `The team folder holds ${safeName(name)}, which a team folder does not define. The names are team.json, maps/, and ${CREW_BLOCK}/, and the 0.7 names ${TEAM_LEGACY_NAMES.join(', ')}.` });
    }
    const team = read(root, 'team.json');
    if (team) files.push(team);
    if (exists(root, 'maps')) {
      realFolder(root, 'maps');
      for (const name of fs.readdirSync(join(root, 'maps')).sort()) {
        if (!(MAP_NAMES as readonly string[]).includes(name)) problems.push({ code: 'TEAM_UNKNOWN_FILE', path: `maps/${name}`, message: `maps/ holds ${safeName(name)}. It holds only relay.json and the 0.7 vines.json.` });
      }
      const relay = read(root, RELAY_MAP_PATH);
      if (relay) files.push(relay);
    }
    if (exists(root, CREW_BLOCK)) files.push(...kept(root));
  } catch (error) {
    if (error instanceof Unsafe) return { ok: false, problems: [unsafe(error.rel)] };
    if (error instanceof KeptTooLarge) return { ok: false, problems: [{ code: 'TEAM_TOO_LARGE', path: CREW_BLOCK, message: `${CREW_BLOCK}/ holds more than ${TEAM_LIMITS.keptFiles} files or is deeper than ${TEAM_LIMITS.keptDepth} folders.` }] };
    throw error;
  }
  const result = validateTeam(files, { ...options, folderName: basename(root), folder: root });
  return problems.length ? { ok: false, problems: [...problems, ...(result.ok ? [] : result.problems)] } : result;
}

function unsafe(rel: string): Problem {
  return { code: 'TEAM_FILE_UNSAFE', path: rel, message: `${rel} is a link, is not a plain file or folder of yours, has more than one link, or is larger than 1 MiB. Nothing was read past it.` };
}

function exists(root: string, rel: string): boolean {
  try { fs.lstatSync(join(root, rel)); return true; } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new Unsafe(rel);
  }
}

function realFolder(root: string, rel: string): void {
  let st: fs.Stats;
  try { st = fs.lstatSync(join(root, rel)); } catch { throw new Unsafe(rel); }
  if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== process.getuid?.()) throw new Unsafe(rel);
}

function read(root: string, rel: string): DefinitionFile | null {
  try {
    const r = readAbs(join(root, rel), rel);
    return r ? { path: rel, bytes: r.bytes } : null;
  } catch (error) {
    if (error instanceof PortableRefusal) throw new Unsafe(rel);
    throw error;
  }
}

class KeptTooLarge extends Error {}

/** Every file under the kept 0.7 folder, for the secret and bypass scans and the revision. */
function kept(root: string): DefinitionFile[] {
  const out: DefinitionFile[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > TEAM_LIMITS.keptDepth) throw new KeptTooLarge();
    realFolder(root, rel);
    for (const name of fs.readdirSync(join(root, rel)).sort()) {
      const child = `${rel}/${name}`;
      let st: fs.Stats;
      try { st = fs.lstatSync(join(root, child)); } catch { throw new Unsafe(child); }
      if (st.isDirectory() && !st.isSymbolicLink()) { walk(child, depth + 1); continue; }
      if (out.length >= TEAM_LIMITS.keptFiles) throw new KeptTooLarge();
      const file = read(root, child);
      if (!file) throw new Unsafe(child);
      out.push(file);
    }
  };
  walk(CREW_BLOCK, 1);
  return out;
}
