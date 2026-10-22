/**
 * The instruction chain of an agent (spec 05, section 3.11): the CLAUDE.md and AGENTS.md files, the imports, and the
 * rules that Claude Code loads at start, and the subfolder files that load when a file there is read. It models the
 * documented rules and says which are assumed. It reads through a reader and does no I/O of its own.
 */
import { posix } from 'node:path';
import { splitFrontmatter } from './frontmatter.js';
import { withoutFences, withoutSpans } from './links.js';

export interface InstructionReader {
  /**
   * The text of a regular file and its identity (device and inode); null when nothing is there; `{ unreadable }` with a reason
   * (an errno code, `too large`, `not a regular file`) when something is there that cannot be counted.
   */
  read(path: string): { text: string; id: string } | { unreadable: string } | null;
  /** The names in a folder, or null when it is not a readable folder. */
  list(dir: string): string[] | null;
}
export interface InstructionOptions {
  /** `omitClaudeMd: true` drops the user, project, and local files (verified), and is assumed to drop AGENTS.md and rules too. */
  omitClaudeMd: boolean;
  /** Also count `~/.claude/CLAUDE.md` and the user rules. */
  user: boolean;
  home: string;
}
export type InstructionVia = 'claude' | 'agents' | 'import' | 'rules' | 'user';
export interface InstructionFile { path: string; bytes: number; via: InstructionVia; id: string }
export interface InstructionResult {
  files: InstructionFile[];
  skippedImports: { from: string; target: string }[];
  /** Files that are there and cannot be counted, each with the reason. */
  unreadable: { path: string; reason: string }[];
  /** True when no CLAUDE.md of any kind sits on the chain, so AGENTS.md files count. */
  usesAgents: boolean;
}

export const MAX_HOPS = 4;
const CLAUDE_NAMES = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'], AGENTS_NAMES = ['AGENTS.md', '.claude/AGENTS.md'];

/** `@path` imports: `@` at the start of a line or after white space, then the characters up to the first space that does not follow a backslash. */
export function parseImports(text: string): string[] {
  const clean = withoutSpans(withoutFences(text)), out: string[] = [];
  for (const m of clean.matchAll(/(?<=^|\s)@((?:\\ |\S)+)/gm)) out.push(m[1]!.replace(/\\ /g, ' '));
  return out;
}

const chainDirs = (from: string): string[] => { const out: string[] = []; for (let p = from; ; p = posix.dirname(p)) { out.push(p); if (p === '/') break; } return out.reverse(); };
const hasPathsKey = (text: string): boolean => { const fm = splitFrontmatter(text); return fm !== null && /^paths[ \t]*:/m.test(fm.block); };

export function instructionFiles(from: string, opts: InstructionOptions, reader: InstructionReader): InstructionResult {
  const dirs = chainDirs(posix.resolve(from));
  const userClaude = posix.join(opts.home, '.claude/CLAUDE.md'), userRules = posix.join(opts.home, '.claude/rules');
  const hasClaude = dirs.some(d => CLAUDE_NAMES.some(n => { const p = posix.join(d, n); return p !== userClaude && reader.read(p) !== null; }));
  const result: InstructionResult = { files: [], skippedImports: [], unreadable: [], usesAgents: !hasClaude };
  if (opts.omitClaudeMd) return result;
  const seen = new Set<string>(), skipped = new Set<string>();
  const add = (path: string, via: InstructionVia, hop: number): void => {
    const got = reader.read(path);
    if (got === null) return;
    if ('unreadable' in got) { if (!result.unreadable.some(u => u.path === path)) result.unreadable.push({ path, reason: got.unreadable }); return; }
    if (seen.has(got.id)) return;
    seen.add(got.id);
    result.files.push({ path, bytes: Buffer.byteLength(got.text), via, id: got.id });
    if (hop >= MAX_HOPS) return;
    for (const target of parseImports(got.text)) {
      const abs = target.startsWith('~/') ? posix.resolve(opts.home, target.slice(2)) : posix.resolve(posix.dirname(path), target);
      if (reader.read(abs) === null) { const key = `${path}\0${target}`; if (!skipped.has(key)) { skipped.add(key); result.skippedImports.push({ from: path, target }); } continue; }
      add(abs, 'import', hop + 1); // An unreadable import is recorded by `add`.
    }
  };
  const rules = (dir: string, via: InstructionVia, depth = 0): void => {
    const names = reader.list(dir); if (names === null) return;
    for (const name of [...names].sort()) {
      const path = posix.join(dir, name);
      if (name.endsWith('.md')) { const got = reader.read(path); if (got !== null && ('unreadable' in got || !hasPathsKey(got.text))) add(path, via, 0); }
      else if (depth < 4 && !name.includes('.')) rules(path, via, depth + 1);
    }
  };
  if (opts.user) { add(userClaude, 'user', 0); rules(userRules, 'user'); }
  for (const d of dirs) {
    for (const n of CLAUDE_NAMES) { const p = posix.join(d, n); if (p !== userClaude) add(p, 'claude', 0); }
    if (!hasClaude) for (const n of AGENTS_NAMES) add(posix.join(d, n), 'agents', 0);
    const r = posix.join(d, '.claude/rules'); if (r !== userRules) rules(r, 'rules');
  }
  return result;
}

/** The subfolder files that load when the agent reads the members: those below the folder the chain already covers. */
export function onDemandInstructions(from: string, members: readonly string[], _opts: InstructionOptions, reader: InstructionReader, start: Pick<InstructionResult, 'files' | 'usesAgents'>): InstructionResult {
  const result: InstructionResult = { files: [], skippedImports: [], unreadable: [], usesAgents: start.usesAgents };
  const seen = new Set<string>(start.files.map(f => f.id)), fromSegs = posix.resolve(from).split('/').filter(Boolean);
  const dirs = new Set<string>();
  for (const m of members) {
    const segs = posix.dirname(posix.resolve(m)).split('/').filter(Boolean);
    let common = 0; while (common < fromSegs.length && common < segs.length && fromSegs[common] === segs[common]) common++;
    for (let i = common + 1; i <= segs.length; i++) dirs.add('/' + segs.slice(0, i).join('/'));
  }
  for (const d of [...dirs].sort()) {
    let claude = false;
    for (const n of CLAUDE_NAMES) { const got = reader.read(posix.join(d, n)); if (got && 'unreadable' in got) { claude = true; result.unreadable.push({ path: posix.join(d, n), reason: got.unreadable }); } else if (got) { claude = true; if (!seen.has(got.id)) { seen.add(got.id); result.files.push({ path: posix.join(d, n), bytes: Buffer.byteLength(got.text), via: 'claude', id: got.id }); } } }
    if (start.usesAgents && !claude) for (const n of AGENTS_NAMES) { const got = reader.read(posix.join(d, n)); if (got && 'unreadable' in got) result.unreadable.push({ path: posix.join(d, n), reason: got.unreadable }); else if (got && !seen.has(got.id)) { seen.add(got.id); result.files.push({ path: posix.join(d, n), bytes: Buffer.byteLength(got.text), via: 'agents', id: got.id }); } }
  }
  return result;
}
