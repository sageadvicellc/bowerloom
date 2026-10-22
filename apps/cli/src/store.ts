import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { strictJson } from '../../../packages/codex-adapter/src/safe.js';
import { inspectStore, projectRefusal, storeRootOf, verifyStorePins } from '../../../packages/project-context/src/index.js';
import type { StoreContext } from '../../../packages/project-context/src/index.js';
import { newCommandJson, plainText } from './human.js';

const STORE_STATUS_FORMAT = 'bowerloom/store-status/v1beta1';
const USAGE = 'Use bowerloom store status [--json].';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LEFTOVER_TEMP = /^\.store\.json\.[a-f0-9]{16}\.tmp$/;
const NAME_LIMIT = 256;
const SKILLS_JSON_LIMIT = 4 * 1024 * 1024;

type State = 'absent' | 'store' | 'foreign' | 'refused';
interface Counts { skillFolders: Count; pinnedSkills: number | null; prompts: Count; teams: Count }
/** A count of names, capped: `capped` is true when there were more than 256. */
interface Count { n: number; capped: boolean }
interface Report { state: State; path: string; code: string | null; message: string | null; counts: Counts | null; leftovers: string[] }

const errno = (error: unknown): unknown => (error as NodeJS.ErrnoException | null)?.code;

/**
 * Counts the names in `<store>/<folder>` that are plain ids: folders for skills and teams, `<id>.md` files for prompts. A
 * link, a stray file, a name that does not match, and a folder entry that is a link or not a folder all count nothing.
 */
function countNames(store: StoreContext, folder: 'skills' | 'prompts' | 'teams'): Count {
  const path = join(store.dir, folder);
  try { const stat = lstatSync(path); if (stat.isSymbolicLink() || !stat.isDirectory()) return { n: 0, capped: false }; }
  catch (error) { if (errno(error) === 'ENOENT') return { n: 0, capped: false }; throw projectRefusal('STORE_UNREADABLE'); }
  let entries: Dirent[];
  try { entries = readdirSync(path, { withFileTypes: true }); } catch { throw projectRefusal('STORE_UNREADABLE'); }
  let n = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (folder === 'prompts') { if (entry.isFile() && entry.name.endsWith('.md') && ID.test(entry.name.slice(0, -3))) n++; }
    else if (entry.isDirectory() && ID.test(entry.name)) n++;
  }
  return n > NAME_LIMIT ? { n: NAME_LIMIT, capped: true } : { n, capped: false };
}

/** The number of npm and git entries in the store's skills.json, read as a plain file of at most 4 MiB. Null when it cannot be read or parsed. A missing file counts 0. */
function pinnedSkills(store: StoreContext): number | null {
  const file = join(store.dir, 'skills.json');
  try {
    let before;
    try { before = lstatSync(file, { bigint: true }); } catch (error) { if (errno(error) === 'ENOENT') return 0; return null; }
    if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n || Number(before.uid) !== process.getuid!() || (Number(before.mode) & 0o022) !== 0 || before.size > BigInt(SKILLS_JSON_LIMIT)) return null;
    const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const open = fstatSync(fd, { bigint: true });
      if (open.dev !== before.dev || open.ino !== before.ino) return null;
      const buffer = Buffer.alloc(SKILLS_JSON_LIMIT + 1);
      let length = 0;
      for (;;) { const got = readSync(fd, buffer, length, buffer.length - length, null); if (got === 0 || (length += got) === buffer.length) break; }
      if (length > SKILLS_JSON_LIMIT) return null;
      bytes = buffer.subarray(0, length);
    } finally { closeSync(fd); }
    const value = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes), SKILLS_JSON_LIMIT) as { skills?: unknown } | null;
    if (value === null || typeof value !== 'object' || !Array.isArray(value.skills)) return null;
    return value.skills.filter(entry => { const kind = (entry as { source?: { kind?: unknown } } | null)?.source?.kind; return kind === 'npm' || kind === 'git'; }).length;
  } catch { return null; }
}

function report(home: string): Report {
  let path: string;
  try { path = storeRootOf(home); } catch (error) {
    if (errno(error) === 'USAGE') throw error;
    return { state: 'refused', path: join(resolve(home), '.bowerloom'), code: String(errno(error)), message: (error as Error).message, counts: null, leftovers: [] };
  }
  try {
    const found = inspectStore(home);
    if (found.state === 'absent') return { state: 'absent', path, code: null, message: null, counts: null, leftovers: [] };
    if (found.state === 'foreign') return { state: 'foreign', path, code: null, message: null, counts: null, leftovers: [] };
    const store = found.context;
    const counts: Counts = { skillFolders: countNames(store, 'skills'), pinnedSkills: pinnedSkills(store), prompts: countNames(store, 'prompts'), teams: countNames(store, 'teams') };
    let names: string[];
    try { names = readdirSync(store.dir); } catch { throw projectRefusal('STORE_UNREADABLE'); }
    verifyStorePins(store);
    return { state: 'store', path, code: null, message: null, counts, leftovers: names.filter(name => LEFTOVER_TEMP.test(name)).sort() };
  } catch (error) {
    const code = errno(error);
    if (typeof code === 'string' && code.startsWith('STORE_')) return { state: 'refused', path, code, message: (error as Error).message, counts: null, leftovers: [] };
    throw error;
  }
}

function render(r: Report): string {
  if (r.state === 'absent') return 'Store: none yet\n  Create one with bowerloom skill create <name> --global.\n';
  if (r.state === 'foreign') return `Store: not a store\n  ${plainText(r.path)} exists, but it has no store.json. Bowerloom will not use it.\n  Move it somewhere else first. Then run bowerloom skill create <name> --global.\n`;
  if (r.state === 'refused') return `Store: refused (${plainText(r.code ?? '')})\n  ${plainText(r.message ?? '')}\n`;
  const c = r.counts!, show = (count: Count): string => count.capped ? `${count.n} or more` : String(count.n);
  return [
    'Store: ready', `  Path: ${plainText(r.path)}`, `  Skill folders: ${show(c.skillFolders)}`,
    `  Pinned skills: ${c.pinnedSkills === null ? 'unreadable' : c.pinnedSkills}`, `  Prompts: ${show(c.prompts)}`, `  Teams: ${show(c.teams)}`,
    ...r.leftovers.map(name => `  Leftover: ${name} (the next --global write removes it)`), '',
  ].join('\n');
}

/**
 * `bowerloom store status [--json]`. Reads only. Every STORE_* refusal is reported as state `refused` and exits 0; USAGE
 * passes through. `home` is the HOME folder, and the store is always `<home>/.bowerloom`.
 */
export async function runStoreCommand(args: readonly string[], home: string, write: (text: string) => unknown): Promise<number> {
  const words = args.slice(1);
  if (words[0] !== 'status' || words.length > 2 || (words.length === 2 && words[1] !== '--json')) throw new DefinitionError('USAGE', USAGE);
  const r = report(home);
  if (words[1] === '--json') {
    const counts = r.counts === null ? null : { skillFolders: r.counts.skillFolders.n, pinnedSkills: r.counts.pinnedSkills, prompts: r.counts.prompts.n, teams: r.counts.teams.n };
    write(newCommandJson({ format: STORE_STATUS_FORMAT, state: r.state, path: r.path, code: r.code, counts, leftoverTemps: r.leftovers.length, git: null }));
  } else write(render(r));
  return 0;
}