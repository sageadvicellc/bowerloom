/**
 * `bowerloom context show` and `bowerloom context measure` (spec 05, sections 3.10 and 3.11). Both read only, never use
 * the network, and write nothing. The measure reports exact bytes and an estimate of tokens, for each agent at start and
 * on demand, next to the same agent loaded with every `.md` file of a baseline folder. It cannot prove answer quality or
 * what an agent actually reads, and it says so.
 */
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { readSliceTree } from '../../managed-skills/src/local-source.js';
import { instructionFiles, onDemandInstructions } from '../../context-slices/src/instructions.js';
import type { InstructionFile, InstructionOptions, InstructionReader } from '../../context-slices/src/instructions.js';
import { splitFrontmatter } from '../../context-slices/src/frontmatter.js';
import { estimateTokens, ratioPpm } from '../../context-slices/src/estimate.js';
import { renderSliceIndex } from '../../context-slices/src/render.js';
import type { ProjectContext } from '../../project-context/src/types.js';
import { scanAgents } from './agents.js';
import { planProjectApply, observeApply } from './apply-project.js';
import { registeredLookup, registeredSlices } from './slices.js';
import type { SliceItem } from './slices.js';
import { syncError } from './refusal.js';
import { shellArg } from '../../contracts/src/index.js';

/** Round 10 of the reviews of PR 101: the note for an agent that Claude Code does not find. A folder goes into --add-dir only through shellArg. */
export function notFoundNote(from: string, dir: string): string {
  const word = shellArg(dir);
  return `Claude Code started in ${from} does not find this agent. It finds agents only in the folders above where it starts. Start it inside ${dir}, or pass --add-dir ${word ?? 'with that folder'}.`;
}

export const MEASURE_FORMAT = 'bowerloom/context-measure/v1beta1' as const;
export const SHOW_FORMAT = 'bowerloom/context-slice-show/v1beta1' as const;
export const BASELINE_LIMIT = 100000;
const cmp = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));

export const NOT_COUNTED: readonly string[] = Object.freeze([
  'Claude Code\'s own system details and tool definitions', 'MCP tool definitions', 'git status', 'the sibling list', 'the task message', 'managed policy files',
  'agent memory', 'the skill list in the subagent', 'files the agent reads beyond its slices', 'model output',
]);
export const ASSUMPTIONS: readonly string[] = Object.freeze([
  'instructions: CLAUDE.md, .claude/CLAUDE.md, and CLAUDE.local.md load from the start folder and every folder above it (verified).',
  'instructions: AGENTS.md and .claude/AGENTS.md load from the start folder up only when no CLAUDE.md file of the three kinds exists on that chain (verified).',
  'instructions: @path imports expand up to four hops (verified). The import grammar is Bowerloom\'s reading of the docs.',
  'instructions: .claude/rules files without a paths key load at start (verified).',
  'instructions: omitClaudeMd removes the user, project, and local CLAUDE.md files (verified), and is assumed to remove AGENTS.md files and rules files too.',
  'instructions: a subfolder CLAUDE.md or AGENTS.md loads when a file in that subfolder is read (verified).',
  'skills: a preloaded skill counts as its whole SKILL.md, frontmatter included. Whether Claude Code injects the frontmatter is not documented.',
  'tokens: bytes divided by bytesPerToken. The error against Claude\'s tokenizer is not measured.',
]);

// ---------------------------------------------------------------------------------------------------------------- show

export interface ShowInput { project: ProjectContext; stateRoot: string; slice: string; home?: string; sliceTree?: Parameters<typeof observeApply>[0]['sliceTree'] }
export interface ShowResult {
  format: typeof SHOW_FORMAT;
  id: string;
  /** The root as a path from the project folder; for a held registered slice, the path the definition names inside the folder; null when the definition cannot be read. */
  root: string | null;
  /** The absolute real path of a registered root, when it was resolved. */
  folder: string | null;
  /** What the index copies out of a registered folder, or null. */
  copies: SliceItem['copies'];
  /** The name of the registered folder the root is in, or null for a root in the project. `root` is then the path from the project folder. */
  registered: string | null;
  members: string[]; covered: string[];
  notes: SliceItem['notes']; hold: { code: string; next: string } | null; guard: 'root' | 'none' | null; agents: string[];
  index: { text: string; bytes: number; sha256: string } | null;
  installed: 'installed and the same' | 'installed and out of date' | 'not installed';
}
export async function showSlice(input: ShowInput): Promise<ShowResult> {
  const dir = input.project.dir;
  if (!registeredSlices(dir).includes(input.slice)) throw syncError('CONTEXT_SLICE_NOT_FOUND');
  const home = input.home ?? homedir();
  const plan = await planProjectApply({ project: input.project, stateRoot: input.stateRoot, harnesses: ['claude'], team: null, agentsOnly: true, home, ...(input.sliceTree ? { sliceTree: input.sliceTree } : {}) });
  const item = plan.slices.find(s => s.id === input.slice)!;
  const tree = (input.sliceTree ?? readSliceTree)(dir, input.slice, { kind: 'project' }, () => {}, registeredLookup(home, input.project.projectId, input.project.identity.birthtimeNs, input.stateRoot));
  const def = tree.definition, text = tree.index, root = item.root !== null ? (item.root.kind === 'registered' ? relative(dir, item.root.dir) : item.root.path) : def === null ? null : def.root.path;
  const installed = !item.installed ? 'not installed' : item.hold === null && item.action === 'none' ? 'installed and the same' : 'installed and out of date';
  const { createHash } = await import('node:crypto');
  return {
    format: SHOW_FORMAT, id: item.id, root, folder: item.root?.kind === 'registered' ? item.root.dir : null, copies: item.copies, registered: item.root?.kind === 'registered' ? item.root.name : tree.definition?.root.kind === 'registered' ? tree.definition.root.name : null, members: item.members, covered: item.covered, notes: item.notes, hold: item.hold, guard: item.guard, agents: item.agents,
    index: text === null ? null : { text, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') }, installed,
  };
}

// -------------------------------------------------------------------------------------------------------------- measure

export interface MeasureInput {
  project: ProjectContext; stateRoot: string; home?: string;
  agents?: readonly string[]; team?: string | null; from: string; baseline?: string | null;
  /** Thousandths of a byte per token; null for the default of 4. */
  bytesPerTokenMilli?: number | null; user?: boolean;
}
export interface MeasureAgent {
  role: string; team: string; omitClaudeMd: boolean; discovered: boolean;
  start: {
    prompt: number;
    instructions: { files: { path: string; bytes: number; via: string }[]; skippedImports: { from: string; target: string }[]; unreadable: { path: string; reason: string }[]; bytes: number };
    skills: { files: { name: string; path: string; bytes: number }[]; unresolved: string[]; unreadable: { path: string; reason: string }[]; beyondPreloadLimit: string[] };
    slices: { id: string; indexBytes: number; source: 'installed' | 'live'; memberBytes: number; indexToMembersPpm: number; installed: boolean; hold: string | null }[];
    bytes: number; tokens: number; nonAsciiPpm: number;
  };
  onDemand: { members: { files: number; bytes: number }; instructions: { path: string; bytes: number }[]; bytes: number; tokens: number };
  mentioned: { path: string; bytes: number }[];
  listing: { descriptionBytes: number };
  baseline: { bytes: number; tokens: number };
  ratios: { startToBaselinePpm: number; onDemandToBaselinePpm: number };
  reference: { unslicedStartBytes: number };
  notes: string[];
}
export interface MeasureResult {
  format: typeof MEASURE_FORMAT; project: string; from: string;
  estimator: { id: 'bytes-per-token/v1'; bytesPerToken: string; band: ['3.0', '4.5']; calibrated: false | 'user' };
  baseline: { folder: string; chosenBy: 'flag' | 'slice-roots' | 'project'; include: '**/*.md'; files: number; bytes: number; skipped: { hidden: number; links: number; notRegular: number } };
  agents: MeasureAgent[];
  /** Agents with a file that is held, so they are not measured: the code and the next step. */
  held: { role: string; team: string; code: string; next: string }[];
  notCounted: string[]; assumptions: string[]; executionAuthorized: false;
}

const MAX_FILE = 8 * 1024 * 1024;
const errno = (error: unknown): string => { const code = (error as NodeJS.ErrnoException | null)?.code; return typeof code === 'string' ? code : 'IO_ERROR'; };
/** Absent is null. Present but not countable is `unreadable` with the reason: an errno code, `too large`, or `not a regular file`. */
const fsReader: InstructionReader = {
  read(p) {
    let s: fs.BigIntStats;
    try { s = fs.statSync(p, { bigint: true }); } catch (e) { const c = errno(e); return c === 'ENOENT' || c === 'ENOTDIR' ? null : { unreadable: c }; }
    if (!s.isFile()) return { unreadable: 'not a regular file' };
    if (s.size > BigInt(MAX_FILE)) return { unreadable: 'too large' };
    try { return { text: fs.readFileSync(p, 'utf8'), id: `${s.dev}:${s.ino}` }; } catch (e) { return { unreadable: errno(e) }; }
  },
  list(d) { try { return fs.readdirSync(d); } catch { return null; } },
};
const readText = (p: string): string => { const got = fsReader.read(p); return got !== null && 'text' in got ? got.text : ''; };
/** The words of an unreadable reason. */
const why = (reason: string): string => reason === 'too large' ? 'is too large' : reason === 'not a regular file' ? 'is not a regular file' : `cannot be read (${reason})`;
const nonAscii = (text: string): number => { let n = 0; for (const b of Buffer.from(text)) if (b >= 0x80) n++; return n; };
const rel = (project: string, p: string): string => { const r = relative(project, p); return r === '' ? '.' : r; };
const common = (paths: readonly string[]): string => {
  const segs = paths.map(p => p.split(sep)); let n = 0;
  while (segs.every(s => n < s.length && s[n] === segs[0]![n])) n++;
  return segs[0]!.slice(0, n).join(sep) || sep;
};

/** Every non-hidden `.md` file under the folder, once by device and inode. Entries over BASELINE_LIMIT refuse CONTEXT_MEASURE_LIMIT. */
function walkBaseline(folder: string): { list: { id: string; bytes: number }[]; files: number; bytes: number; skipped: { hidden: number; links: number; notRegular: number } } {
  const seen = new Set<string>(), skipped = { hidden: 0, links: 0, notRegular: 0 }, list: { id: string; bytes: number }[] = []; let files = 0, bytes = 0, entries = 0;
  const visit = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort(cmp)) {
      if (++entries > BASELINE_LIMIT) throw syncError('CONTEXT_MEASURE_LIMIT');
      if (name.startsWith('.')) { skipped.hidden++; continue; }
      const path = join(dir, name); let s: fs.BigIntStats;
      try { s = fs.lstatSync(path, { bigint: true }); } catch { skipped.notRegular++; continue; }
      if (s.isSymbolicLink()) { skipped.links++; continue; }
      if (s.isDirectory()) { visit(path); continue; }
      if (!s.isFile()) { skipped.notRegular++; continue; }
      if (!name.endsWith('.md')) continue;
      const id = `${s.dev}:${s.ino}`; if (seen.has(id)) continue;
      seen.add(id); files++; bytes += Number(s.size); list.push({ id, bytes: Number(s.size) });
    }
  };
  visit(folder); return { list, files, bytes, skipped };
}
function checkedFolder(path: string): string {
  try {
    const s = fs.lstatSync(path, { bigint: true });
    if (s.isSymbolicLink() || !s.isDirectory() || Number(s.uid) !== process.getuid?.() || (Number(s.mode) & 0o022) !== 0) throw new Error('unsafe');
    return fs.realpathSync(path);
  } catch { throw syncError('CONTEXT_BASELINE_INVALID'); }
}

export async function measureContext(input: MeasureInput): Promise<MeasureResult> {
  const dir = input.project.dir, home = input.home ?? homedir(), from = resolve(input.from), milli = input.bytesPerTokenMilli ?? 4000;
  const everything = scanAgents(dir).entries, scan = everything.filter(e => e.hold === null && e.parsed !== null && e.closure !== null);
  let chosen = scan, heldEntries = everything.filter(e => e.hold !== null);
  if (input.agents && input.agents.length) {
    // A held agent is a known agent: it is reported with its code, not refused as unknown.
    for (const role of input.agents) if (!everything.some(e => e.role === role)) throw syncError('CONTEXT_AGENT_NOT_FOUND');
    chosen = scan.filter(e => input.agents!.includes(e.role)); heldEntries = heldEntries.filter(e => input.agents!.includes(e.role));
  }
  if (input.team) { chosen = chosen.filter(e => e.team === input.team); heldEntries = heldEntries.filter(e => e.team === input.team); }
  const held = heldEntries.map(e => ({ role: e.role, team: e.team, code: e.hold!.code, next: e.hold!.next })).sort((a, b) => cmp(a.role, b.role) || cmp(a.team, b.team));
  const plan = await planProjectApply({ project: input.project, stateRoot: input.stateRoot, harnesses: ['claude'], team: null, agentsOnly: true, home });
  const planned = (e: (typeof chosen)[number]) => { const item = plan.agents.find(a => a.id === e.role && a.team === e.team); if (item === undefined) throw new Error(`context measure: the plan holds no item for agent ${e.role}`); return item; };
  const sliceOf = (id: string): SliceItem | undefined => plan.slices.find(s => s.id === id && s.state !== 'orphaned');

  // The baseline folder.
  const rootsOfAgents = [...new Set(chosen.flatMap(e => planned(e).context.slices.flatMap(id => { const r = sliceOf(id)?.root; return r ? [r.dir] : []; })))];
  let baselineDir: string, chosenBy: MeasureResult['baseline']['chosenBy'];
  if (input.baseline) { baselineDir = checkedFolder(resolve(input.baseline)); chosenBy = 'flag'; }
  else if (rootsOfAgents.length) { baselineDir = common(rootsOfAgents); chosenBy = 'slice-roots'; }
  else { baselineDir = dir; chosenBy = 'project'; }
  if (chosenBy !== 'flag') baselineDir = checkedFolder(baselineDir);
  const baselineStat = walkBaseline(baselineDir);

  const userOn = input.user === true;
  const agents: MeasureAgent[] = [];
  for (const e of chosen) {
    const parsed = e.parsed!, text = e.closure!.files[0]!.text, ctx = planned(e).context;
    const fm = splitFrontmatter(text), body = fm === null ? '' : fm.rest, omit = parsed.omitClaudeMd;
    const opts: InstructionOptions = { omitClaudeMd: omit, user: userOn, home };
    const atStart = instructionFiles(from, opts, fsReader), full = instructionFiles(from, { ...opts, omitClaudeMd: false }, fsReader);
    const instrBytes = atStart.files.reduce((n, f) => n + f.bytes, 0), fullBytes = full.files.reduce((n, f) => n + f.bytes, 0);
    const counted: string[] = [body, ...atStart.files.map(f => readText(f.path))];
    const chainIds = new Set<string>(full.files.map(f => f.id));

    // Skills: the first 32 distinct entries; a slice entry is counted under Slices.
    const entries = [...new Set(parsed.skills ?? [])];
    const preloaded = entries.slice(0, 32), beyond = entries.slice(32);
    const sliceIds = new Set(ctx.slices);
    const skillFiles: { name: string; path: string; bytes: number }[] = [], unresolved: string[] = [], skillUnreadable: { path: string; reason: string }[] = [], skillNotes: string[] = [], skillIds = new Set<string>();
    const dirsUp: string[] = []; for (let p = from; ; p = resolve(p, '..')) { dirsUp.push(p); if (p === '/') break; }
    for (const name of preloaded) {
      if (name.startsWith('slice-') && sliceIds.has(name.slice(6))) continue;
      const candidates = [...dirsUp.map(d => join(d, '.claude/skills', name, 'SKILL.md')), ...(userOn ? [join(home, '.claude/skills', name, 'SKILL.md')] : [])];
      const found = candidates.map(c => ({ c, got: fsReader.read(c) })).find(x => x.got !== null);
      if (found === undefined) unresolved.push(name);
      else if ('unreadable' in found.got!) { skillUnreadable.push({ path: rel(dir, found.c), reason: found.got.unreadable }); skillNotes.push(`skill ${name} cannot be counted: ${rel(dir, found.c)} ${why(found.got.unreadable)}.`); }
      else if (!skillIds.has(found.got!.id)) { skillIds.add(found.got!.id); skillFiles.push({ name, path: rel(dir, found.c), bytes: Buffer.byteLength(found.got!.text) }); counted.push(found.got!.text); }
    }
    const skillBytes = skillFiles.reduce((n, f) => n + f.bytes, 0);

    // Slices: the installed index when it is current, else the live render.
    const heldNotes: string[] = [], staleNotes: string[] = [], sliceRows: MeasureAgent['start']['slices'] = [], memberIdents = new Map<string, number>(), memberPaths: string[] = [];
    let sliceBytes = 0, descriptionBytes = 0;
    for (const id of preloaded.filter(n => n.startsWith('slice-')).map(n => n.slice(6)).filter(id => sliceIds.has(id))) {
      const s = sliceOf(id)!, tree = readSliceTree(dir, id, { kind: 'project' }, () => {}, registeredLookup(home, input.project.projectId, input.project.identity.birthtimeNs, input.stateRoot));
      if (s.hold !== null && !(s.installed && s.state === 'drift')) { heldNotes.push(`slice ${id} is held (${s.hold.code}), so it is not counted.`); sliceRows.push({ id, indexBytes: 0, source: 'live', memberBytes: 0, indexToMembersPpm: 0, installed: s.installed, hold: s.hold.code }); continue; }
      const def = tree.definition!, res = tree.resolution, installedIndex = (() => { try { return fs.readFileSync(join(dir, '.claude/skills', 'slice-' + id, 'SKILL.md'), 'utf8'); } catch { return null; } })();
      const current = s.installed && s.action === 'none' && installedIndex !== null;
      const shown = def.root.kind === 'registered' && tree.rootDir !== null ? relative(dir, tree.rootDir) : null;
      const live = tree.index ?? renderSliceIndex(id, def, res, shown !== null ? { source: `${shown} (registered folder ${(def.root as { name: string }).name})`, prefix: shown } : { source: def.root.kind === 'project' && def.root.path !== '.' ? def.root.path : 'the project folder', prefix: def.root.kind === 'project' && def.root.path !== '.' ? def.root.path : '' });
      const indexText = current ? installedIndex! : live, indexBytes = Buffer.byteLength(indexText);
      if (s.installed && !current) staleNotes.push(`the index of slice ${id} is out of date, so the live render is counted. Run bowerloom apply.`);
      counted.push(indexText); sliceBytes += indexBytes; descriptionBytes += Buffer.byteLength(def.description);
      const rootDir = tree.rootDir!, memberBytes = res.members.reduce((n, m) => n + m.bytes, 0);
      for (const m of res.members) {
        const abs = join(rootDir, m.path); let ident = abs; try { const st = fs.statSync(abs, { bigint: true }); ident = `${st.dev}:${st.ino}`; } catch { /* Counted by path. */ }
        if (!memberIdents.has(ident)) { memberIdents.set(ident, m.bytes); memberPaths.push(abs); }
      }
      sliceRows.push({ id, indexBytes, source: current ? 'installed' : 'live', memberBytes, indexToMembersPpm: ratioPpm(indexBytes, memberBytes), installed: s.installed, hold: null });
    }
    const startBytes = Buffer.byteLength(body) + instrBytes + skillBytes + sliceBytes;
    const nonAsciiPpm = ratioPpm(counted.reduce((n, t) => n + nonAscii(t), 0), Math.max(1, counted.reduce((n, t) => n + Buffer.byteLength(t), 0)));
    const memberBytesTotal = [...memberIdents.values()].reduce((n, b) => n + b, 0);
    const demand = onDemandInstructions(from, memberPaths, opts, fsReader, atStart);
    // A subfolder instruction file that is also a member is one file.
    const demandFiles = demand.files.filter(f => !memberIdents.has(f.id));
    const demandBytes = memberBytesTotal + demandFiles.reduce((n, f) => n + f.bytes, 0);
    // The baseline files leave out every file that the chain or the skills already count.
    const baselineFiles = baselineStat.list.filter(f => !chainIds.has(f.id) && !skillIds.has(f.id)).reduce((n, f) => n + f.bytes, 0);
    const baselineBytes = Buffer.byteLength(body) + fullBytes + skillBytes + baselineFiles;
    const discovered = from === dir || from.startsWith(dir + sep);
    // The notes, in the order of the spec.
    const ordered: string[] = [];
    if (!discovered) ordered.push(notFoundNote(from, dir));
    if (instrBytes > 0 && !omit && sliceIds.size > 0) ordered.push(`starts with ${instrBytes} bytes of CLAUDE.md or AGENTS.md files. Set omitClaudeMd: true to start it with its slices only.`);
    const mentioned: { path: string; bytes: number }[] = [];
    for (const m of body.matchAll(/`([^`\n]+)`/g)) {
      const candidate = m[1]!; if (candidate.length > 512 || /[\p{Cc}]/u.test(candidate)) continue;
      const abs = resolve(dir, candidate); let st: fs.Stats; try { st = fs.statSync(abs); } catch { continue; }
      if (st.isFile() && !mentioned.some(x => x.path === rel(dir, abs))) { mentioned.push({ path: rel(dir, abs), bytes: st.size }); ordered.push(`names ${rel(dir, abs)} in its prompt (${st.size} bytes). An agent that follows that line reads it on demand.`); }
    }
    for (const u of atStart.unreadable) ordered.push(`${rel(dir, u.path)} cannot be counted: it ${why(u.reason)}.`);
    if (unresolved.length) ordered.push(`skills not found, so not counted: ${unresolved.join(', ')}.`);
    ordered.push(...skillNotes);
    ordered.push(...heldNotes, ...staleNotes);
    agents.push({
      role: e.role, team: e.team, omitClaudeMd: omit, discovered,
      start: {
        prompt: Buffer.byteLength(body),
        instructions: { files: atStart.files.map(f => ({ path: rel(dir, f.path), bytes: f.bytes, via: f.via })), skippedImports: atStart.skippedImports.map(x => ({ from: rel(dir, x.from), target: x.target })), unreadable: atStart.unreadable.map(u => ({ path: rel(dir, u.path), reason: u.reason })), bytes: instrBytes },
        skills: { files: skillFiles, unresolved, unreadable: skillUnreadable, beyondPreloadLimit: beyond }, slices: sliceRows, bytes: startBytes, tokens: estimateTokens(startBytes, milli), nonAsciiPpm,
      },
      onDemand: { members: { files: memberIdents.size, bytes: memberBytesTotal }, instructions: demandFiles.map((f: InstructionFile) => ({ path: rel(dir, f.path), bytes: f.bytes })), bytes: demandBytes, tokens: estimateTokens(demandBytes, milli) },
      mentioned, listing: { descriptionBytes }, baseline: { bytes: baselineBytes, tokens: estimateTokens(baselineBytes, milli) },
      ratios: { startToBaselinePpm: ratioPpm(startBytes, baselineBytes), onDemandToBaselinePpm: ratioPpm(demandBytes, baselineBytes) },
      reference: { unslicedStartBytes: Buffer.byteLength(body) + instrBytes + skillBytes }, notes: ordered,
    });
  }
  agents.sort((a, b) => cmp(a.role, b.role) || cmp(a.team, b.team));
  return {
    format: MEASURE_FORMAT, project: dir, from,
    estimator: { id: 'bytes-per-token/v1', bytesPerToken: String(milli / 1000), band: ['3.0', '4.5'], calibrated: input.bytesPerTokenMilli ? 'user' : false },
    baseline: { folder: rel(dir, baselineDir), chosenBy, include: '**/*.md', files: baselineStat.files, bytes: baselineStat.bytes, skipped: baselineStat.skipped },
    agents, held, notCounted: [...NOT_COUNTED], assumptions: [...ASSUMPTIONS], executionAuthorized: false,
  };
}
