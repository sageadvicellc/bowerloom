/**
 * The portable projection of Bowerloom 0.8 (portable parts spec; harness definition spec, sections 8, 9, and 13).
 *
 * It writes the portable parts of one harness definition into the project paths of the engines it projects to: the
 * system prompt as `AGENTS.md`, skills as folders under `.claude/skills` and `.agents/skills`, and tool guidance,
 * memory, and commands inside those two. Step 3 adds the locked-in parts (MCP servers, subagents, hooks, guardrails, and
 * the sandbox) to the same plan, through locked.ts. Scripts and engine-private files are still not projected: the plan
 * reports them `absent` and says the projection is partial. Every loss line goes through the fidelity check, so an
 * enforced entry that is weakened or absent is refused unless a recorded approval matches it.
 *
 * This file plans. portable-run.ts applies, removes, and recovers; portable-files.ts and portable-state.ts hold the
 * file and state layers; locked.ts and locked-text.ts plan the locked-in files. README.md in this package states what
 * stays in the state folder.
 */
import fs from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { canonicalJson } from '../../contracts/src/index.js';
import {
  DEFINITION_LIMITS, ENGINE_IDS, PART_KEYS, REVISION_PREFIX, adoptedPaths, appliesTo, checkFidelity, isEngineId, loadDefinition, parseStrictJson,
  selectForEngine, skillContentHash,
} from '../../harness-definition/src/index.js';
import { decodeText } from '../../harness-definition/src/json.js';
import type { AdoptedRecord, Definition, EngineId, FidelityApproval, LossLine, LossPart, PartKey, SkillEntry } from '../../harness-definition/src/index.js';
import { LOCKED_PARTS, planLocked } from './locked.js';
import type { CodexTrust, LockedPart, ReviewItem, TrustLine } from './locked.js';
import {
  GROUP_OR_WORLD_WRITE, PortableRefusal, byBytes, caseClashes, checkAncestors, driftReason, isProjectedPath, readAbs, readProject, refuse, revisionOf, sameState, sha,
  stateOrUnsafe, writeAbs,
} from './portable-files.js';
import type { FileAfter, FileState } from './portable-files.js';
import { checkPaths, pendingExists, readReceipt, blob, stateExists } from './portable-state.js';
import type { PortableEngine, PortableReceipt, ReceiptFile, ReceiptSource } from './portable-state.js';

export const PORTABLE_PLAN_FORMAT = 'bowerloom/portable-projection-plan/v1beta3' as const;

// ---- engine facts (portable parts spec, sections 4.1 and 4.2) ----------------------------------------------------------

export type SkillRoot = '.claude/skills' | '.agents/skills';
/**
 * The project skill folders Bowerloom writes for each engine (section 4.2). Codex, Pi, and DeepSeek Harness share one
 * copy in `.agents/skills`. Pi and DeepSeek Harness get no private path, so no skill appears twice. OpenCode gets both.
 */
export const SKILL_ROOTS: Readonly<Record<EngineId, readonly SkillRoot[]>> = Object.freeze({
  'claude-code': Object.freeze(['.claude/skills'] as const),
  codex: Object.freeze(['.agents/skills'] as const),
  opencode: Object.freeze(['.claude/skills', '.agents/skills'] as const),
  pi: Object.freeze(['.agents/skills'] as const),
  'deepseek-harness': Object.freeze(['.agents/skills'] as const),
});

/** The text of a `CLAUDE.md` that follows `AGENTS.md` (decision 5): the single line `@AGENTS.md`. */
export const FOLLOW_TEXT = '@AGENTS.md\n';
/** True for the text of a `CLAUDE.md` that follows `AGENTS.md`, with or without its final newline. */
export const followsAgents = (text: string): boolean => text === FOLLOW_TEXT || text === '@AGENTS.md';

/**
 * For a tree that holds both `AGENTS.md` and a `CLAUDE.md` that does not follow it: which file each engine does not
 * load (section 4.1, rules 4 to 7). DeepSeek Harness loads both unless their text is identical, so it hides neither.
 */
export const HIDDEN_FILE: Readonly<Record<EngineId, { readonly hidden: 'AGENTS.md' | 'CLAUDE.md' | null; readonly rule: string }>> = Object.freeze({
  'claude-code': { hidden: 'AGENTS.md', rule: 'Claude Code reads CLAUDE.md. It reads AGENTS.md only when no CLAUDE.md or CLAUDE.local.md exists.' },
  codex: { hidden: 'CLAUDE.md', rule: 'Codex reads AGENTS.md and does not read CLAUDE.md.' },
  opencode: { hidden: 'CLAUDE.md', rule: 'OpenCode reads AGENTS.md. Version 1.x reads CLAUDE.md only when no AGENTS.md exists.' },
  pi: { hidden: 'CLAUDE.md', rule: 'Pi reads one instruction file per folder, and AGENTS.md hides CLAUDE.md.' },
  'deepseek-harness': { hidden: null, rule: 'DeepSeek Harness loads both files unless their text is identical.' },
});

/** The three ways a person reconciles a `CLAUDE.md` that does not follow `AGENTS.md` (section 4.1, rule 5). */
export const RECONCILE_ACTIONS = Object.freeze(['accept-agents', 'merge', 'keep-both'] as const);
export type ReconcileAction = (typeof RECONCILE_ACTIONS)[number];

/** The metadata key and value that mark a skill as a command (section 4.5). Only the loss report reads it. */
export const COMMAND_METADATA = Object.freeze({ key: 'bowerloom-kind', value: 'command' } as const);
/** The byte limit of the projected `AGENTS.md`: Codex stops loading instructions at 32 KiB by default (section 4.1, rule 3). */
export const INSTRUCTIONS_LIMIT = 32 * 1024;
/** The first Claude Code version that reads `AGENTS.md` when no `CLAUDE.md` exists (section 4.1, rule 4). */
export const CLAUDE_CODE_READS_AGENTS = '2.1.277';
/** The entry of a loss line for a listed part with nothing to project. */
export const NOTHING = '(none)';
/** The reason of a line for a part that is not projected yet: scripts, engine-private files, and skill private blocks. */
export const LOCKED_IN_REASON = 'Not projected in this step: scripts, engine-private files, and the private blocks of skills stay in the definition.';
/** What a partial plan says (ruling P14). */
export const PARTIAL_NOTICE = 'This projection is partial: some parts are absent in some engines. Every line marked absent says why.';

// ---- @path imports (section 4.1, rule 2; ruling P25) ---------------------------------------------------------------------

/**
 * The `@path` imports of a Markdown text, outside fenced code and inline code, with their line numbers. A token counts
 * when `@` starts a word and the rest names a file: it holds `/` or `.`, starts with `~`, or `exists(token)` says a file
 * of that name exists, such as `@README`. A mention such as `@someone` or an address such as `a@b.dev` does not count.
 * A fence closes only with the same character, at least as long as the opener, and nothing after it.
 */
export function atImports(markdown: string, exists: (name: string) => boolean = () => false): { readonly line: number; readonly token: string }[] {
  const out: { line: number; token: string }[] = [];
  let fence: { char: string; length: number } | null = null;
  markdown.split('\n').forEach((raw, i) => {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(raw);
      if (open && !(open[1]![0] === '`' && raw.slice(open[0].length).includes('`'))) { fence = { char: open[1]![0]!, length: open[1]!.length }; return; }
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) fence = null;
      return;
    }
    const line = raw.replace(/(`+)[^`]*?\1/g, ' ');
    for (const m of line.matchAll(/(?:^|[\s([{<"'*_])@([^\s)\]}>"'`]+)/g)) {
      const token = m[1]!.replace(/[.,;:!?]+$/, '');
      if (token.length === 0) continue;
      const pathLike = token.includes('/') || token.includes('.') || token.startsWith('~');
      if (pathLike || (/^[A-Za-z0-9_-]{1,255}$/.test(token) && exists(token))) out.push({ line: i + 1, token: '@' + token });
    }
  });
  return out;
}
/** True when the project holds an entry of that plain name. */
const inProject = (projectDir: string) => (name: string): boolean => { try { fs.lstatSync(join(projectDir, name)); return true; } catch { return false; } };

// ---- CLAUDE.md -----------------------------------------------------------------------------------------------------------

/** The project's `CLAUDE.md`: absent, a file (following or not), or a link to the project's own `AGENTS.md` (ruling P22). */
export type ClaudeFile = { readonly kind: 'absent' } | { readonly kind: 'file'; readonly state: FileState; readonly follows: boolean } | { readonly kind: 'link-to-agents' };
export function readClaude(projectDir: string): ClaudeFile {
  const abs = join(projectDir, 'CLAUDE.md');
  let st: fs.Stats;
  try { st = fs.lstatSync(abs); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'absent' }; return refuse('PORTABLE_PATH_UNSAFE', ['CLAUDE.md']); }
  if (st.isSymbolicLink()) {
    let target: string;
    try { target = fs.readlinkSync(abs); } catch { return refuse('PORTABLE_PATH_UNSAFE', ['CLAUDE.md']); }
    // Review item V8: the folder of the target is resolved for real, so a linked folder on the way cannot fake it.
    // The folder part is joined as text and resolved by the system, which follows each link before each `..`.
    const raw = target.startsWith('/') ? dirname(target) : `${projectDir}/${dirname(target)}`;
    let same = false;
    try { const a = fs.statSync(fs.realpathSync.native(raw)), b = fs.statSync(projectDir); same = a.dev === b.dev && a.ino === b.ino; } catch { same = false; }
    if (same && basename(target) === 'AGENTS.md') return { kind: 'link-to-agents' };
    return refuse('PORTABLE_PATH_UNSAFE', ['CLAUDE.md']);
  }
  const got = readAbs(abs, 'CLAUDE.md')!;
  return { kind: 'file', state: got.state, follows: followsAgents(got.bytes.toString('utf8')) };
}

/**
 * Files that keep Claude Code from reading `AGENTS.md` when the project has no `CLAUDE.md` (section 4.1, rule 4):
 * a `CLAUDE.local.md` in the project or a folder above it, and a `CLAUDE.md` in a folder above it.
 */
export function claudeFilesAbove(projectDir: string): string[] {
  const out: string[] = [];
  const has = (p: string): boolean => { try { fs.lstatSync(p); return true; } catch { return false; } };
  if (has(join(projectDir, 'CLAUDE.local.md'))) out.push(join(projectDir, 'CLAUDE.local.md'));
  for (let at = dirname(projectDir); ; at = dirname(at)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) if (has(join(at, name))) out.push(join(at, name));
    if (dirname(at) === at) break;
  }
  return out;
}
/** True, false, or null for a version that is not `major.minor.patch`. */
export function versionAtLeast(version: string | null, floor: string): boolean | null {
  const m = version === null ? null : /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return null;
  const f = floor.split('.').map(Number), v = m.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) if (v[i]! !== f[i]!) return v[i]! > f[i]!;
  return true;
}

// ---- recorded modes (decision D5A) ---------------------------------------------------------------------------------------

/**
 * The modes a person recorded with `recordMode`, in `modes.json` of the state folder. Each entry names the content and
 * the mode the projection had planned when the mode was recorded. While the receipt still holds that content at the
 * recorded mode, and the plan still wants that content at that planned mode, install keeps the recorded mode: no chmod
 * back and no change. A new planned content or mode follows the normal rules. Removal deletes the file.
 */
export const RECORDED_MODES_FORMAT = 'bowerloom/portable-recorded-modes/v1beta1' as const;
export const RECORDED_MODES = 'modes.json';
export interface RecordedMode { readonly path: string; readonly sha256: string; readonly planned: number; readonly recorded: number }
export interface RecordedModes { readonly format: typeof RECORDED_MODES_FORMAT; readonly projectDir: string; readonly files: readonly RecordedMode[] }

const okMode = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0o777;
/** The recorded modes, checked against their strict shape and project. A recorded mode never holds group or world write. */
export function readRecordedModes(stateDir: string, projectDir: string): ReadonlyMap<string, RecordedMode> {
  if (!stateExists(stateDir)) return new Map();
  const got = readAbs(join(stateDir, RECORDED_MODES), RECORDED_MODES);
  if (got === null) return new Map();
  if ((got.state.mode & 0o077) !== 0) refuse('PORTABLE_STATE_UNSAFE');
  const bad = (): never => refuse('PORTABLE_STATE_INVALID', [RECORDED_MODES]);
  let v: unknown;
  try { v = JSON.parse(got.bytes.toString('utf8')); } catch { return bad(); }
  const closed = (o: unknown, keys: readonly string[]): o is Record<string, unknown> => typeof o === 'object' && o !== null && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
  if (!closed(v, ['format', 'projectDir', 'files']) || v.format !== RECORDED_MODES_FORMAT || !Array.isArray(v.files) || v.files.length > 100_000) return bad();
  if (v.projectDir !== projectDir) refuse('PORTABLE_STATE_FOREIGN');
  const out = new Map<string, RecordedMode>();
  for (const f of v.files as unknown[]) {
    if (!closed(f, ['path', 'sha256', 'planned', 'recorded']) || !isProjectedPath(f.path) || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)
      || !okMode(f.planned) || !okMode(f.recorded) || (f.recorded & GROUP_OR_WORLD_WRITE) !== 0 || out.has(f.path)) return bad();
    out.set(f.path, { path: f.path, sha256: f.sha256, planned: f.planned, recorded: f.recorded });
  }
  return out;
}
/** Writes the recorded modes, mode 0600, in path order. The state folder must exist. */
export function writeRecordedModes(stateDir: string, projectDir: string, files: readonly RecordedMode[]): void {
  const body: RecordedModes = { format: RECORDED_MODES_FORMAT, projectDir, files: [...files].sort((a, b) => byBytes(a.path, b.path)) };
  writeAbs(join(stateDir, RECORDED_MODES), Buffer.from(JSON.stringify(body, null, 2) + '\n'), 0o600);
}
/** Deletes the recorded modes. */
export function clearRecordedModes(stateDir: string): void {
  try { fs.unlinkSync(join(stateDir, RECORDED_MODES)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}

// ---- types -------------------------------------------------------------------------------------------------------------

export interface PortableInput {
  /** The real absolute path of the project folder. */
  readonly projectDir: string;
  /** The `.bowerloom` folder that holds `harness.json`. */
  readonly definitionFolder: string;
  /** The private state folder of this projection, outside the project. Apply creates it, mode 0700. */
  readonly stateDir: string;
  /** The engines to project to, each listed in harness.json. Default: every engine harness.json lists. */
  readonly engines?: readonly { readonly id: EngineId; readonly version?: string }[];
  /** How to reconcile a `CLAUDE.md` that does not follow `AGENTS.md`. Default: accept-agents. */
  readonly reconcile?: ReconcileAction;
  /** True once a person saved trust for this project in Pi. Default: false, so Pi skills are `pending trust`. */
  readonly piTrustSaved?: boolean;
  /** Accept the offer to write `CLAUDE.md` as `@AGENTS.md` when Claude Code would not read `AGENTS.md` (ruling P23). */
  readonly writeClaudeMd?: boolean;
  /**
   * Recorded approvals (`FidelityApproval` records) of enforced entries that are weakened or absent in an engine. The
   * plan uses those that match a line, and the receipt records them. Default: none.
   */
  readonly approvals?: readonly unknown[];
  /** A person's statement that both Codex trust steps are done. Default: none, so Codex files are `pending trust`. */
  readonly codexTrust?: CodexTrust;
}

/** The drift report of a tree with both `AGENTS.md` and a `CLAUDE.md` that does not follow it (section 4.1, rule 5). */
export interface InstructionDrift {
  readonly claude: FileState;
  /** `present`: the tree holds `AGENTS.md`. `planned`: the projection writes it. */
  readonly agents: 'present' | 'planned';
  readonly engines: readonly { readonly engine: EngineId; readonly hidden: 'AGENTS.md' | 'CLAUDE.md' | null; readonly rule: string }[];
  readonly actions: readonly ReconcileAction[];
  readonly defaultAction: 'accept-agents';
}

export type ChangeAction = 'create' | 'replace' | 'update' | 'unchanged' | 'restore' | 'delete';
export interface PlannedChange {
  /** Relative to the project folder, with `/`. */
  readonly path: string;
  /**
   * `create`: no file was there. `replace`: a file Bowerloom did not write is saved and replaced. `update`: a file
   * Bowerloom wrote changes. `unchanged`: it stays. `restore`: Bowerloom no longer projects it and puts back the file it
   * replaced. `delete`: Bowerloom no longer projects it and nothing was there before.
   */
  readonly action: ChangeAction;
  readonly before: FileState | null;
  readonly after: FileAfter | null;
  /** The file this path held before Bowerloom first wrote it, kept for removal. */
  readonly original: FileState | null;
  /** The engines that load this file. Empty for `restore` and `delete`. */
  readonly engines: readonly EngineId[];
}

/** A part that this projection does not write: scripts, engine-private files, and private blocks of skills. */
export interface Deferred {
  readonly engine: EngineId;
  readonly part: 'subagents' | 'guardrails' | 'hooks' | 'mcp' | 'scripts' | 'engine-private' | 'skill-private';
  readonly id: string;
}
/** A skill that a projected engine loads although its engine filter leaves that engine out (ruling P19). */
export interface FilterLeak { readonly skill: string; readonly path: string; readonly engines: readonly EngineId[] }
/** An input choice that did not apply, and why (ruling P16). */
export interface Ignored { readonly option: 'reconcile' | 'writeClaudeMd' | 'piTrustSaved' | 'codexTrust'; readonly value: string | boolean; readonly reason: string }
/** An action the plan offers but does not take unless the input asks (ruling P23). */
export interface Offer { readonly action: 'write-claude-md'; readonly reason: string }

/** The report a person reads with the plan, and gets back from apply (ruling P20). */
export interface PortableReport {
  readonly loss: readonly LossLine[];
  /** True when any part is not projected in this step. `notice` then says so plainly. */
  readonly partial: boolean;
  readonly notice: string | null;
  readonly deferred: readonly Deferred[];
  readonly filterLeaks: readonly FilterLeak[];
  /** Skills that Pi skips in non-interactive runs until a person saves trust for the project. */
  readonly pendingTrust: readonly string[];
  readonly ignored: readonly Ignored[];
  readonly offers: readonly Offer[];
  /** Whether each engine loads a written locked-in file now, or after a person's trust step (checks 8 and 14). */
  readonly trust: readonly TrustLine[];
  /** Code a person reads before Bowerloom writes it: the OpenCode hook plugin (decision 3). */
  readonly review: readonly ReviewItem[];
  /** The recorded approvals that cover a line of this plan. The receipt records them. */
  readonly approved: readonly FidelityApproval[];
}

export interface PortablePlan extends PortableReport {
  readonly format: typeof PORTABLE_PLAN_FORMAT;
  readonly projectDir: string;
  readonly stateDir: string;
  readonly definition: { readonly folder: string; readonly harness: string; readonly revision: string };
  readonly engines: readonly PortableEngine[];
  /** Every path the projection writes, keeps, restores, or deletes, in byte order. */
  readonly changes: readonly PlannedChange[];
  /** Folders apply creates, relative to the project, parents first. */
  readonly createDirs: readonly string[];
  /** The created folders the receipt will list: the earlier ones that still exist, and the new ones. */
  readonly createdDirs: readonly string[];
  readonly sources: readonly ReceiptSource[];
  readonly drift: InstructionDrift | null;
  /** The reconcile action this plan carries out, or null when there is no drift. */
  readonly reconcile: ReconcileAction | null;
  readonly previousReceipt: string | null;
  /** True when apply would write nothing: every change is `unchanged` and the receipt would be the same. */
  readonly noop: boolean;
  readonly writesAuthorized: false;
  readonly revision: string;
}

// ---- the drift report --------------------------------------------------------------------------------------------------

/**
 * The drift report for a tree that holds `AGENTS.md` (or a projection that writes it) and a `CLAUDE.md` that does not
 * follow it. Null when there is no such drift. A `CLAUDE.md` that is a link to the project's own `AGENTS.md` follows
 * it; any other link refuses PORTABLE_PATH_UNSAFE.
 */
export function instructionDrift(projectDir: string, engines: readonly EngineId[], agentsPlanned = false): InstructionDrift | null {
  const claude = readClaude(projectDir);
  if (claude.kind !== 'file' || claude.follows) return null;
  const agents = readAbs(join(projectDir, 'AGENTS.md'), 'AGENTS.md') !== null ? 'present' : agentsPlanned ? 'planned' : null;
  if (agents === null) return null;
  const listed = ENGINE_IDS.filter(e => engines.includes(e));
  return { claude: claude.state, agents, engines: listed.map(engine => ({ engine, ...HIDDEN_FILE[engine] })), actions: RECONCILE_ACTIONS, defaultAction: 'accept-agents' };
}

// ---- helpers of the plan -------------------------------------------------------------------------------------------------

export function loadForProjection(folder: string): Definition {
  if (typeof folder !== 'string' || !folder.startsWith('/')) return refuse('PORTABLE_USAGE');
  const r = loadDefinition(folder);
  if (!r.ok) return refuse('PORTABLE_DEFINITION_INVALID', [...new Set(r.problems.map(p => `${p.path} (${p.code})`))], r.problems);
  return r.definition;
}

function enginesOf(def: Definition, wanted: PortableInput['engines']): PortableEngine[] {
  const listed = new Map(def.harness.engines.map(e => [e.id, e.version ?? null]));
  const list: readonly { readonly id: EngineId; readonly version?: string }[] = wanted ?? def.harness.engines.map(e => ({ id: e.id }));
  if (!Array.isArray(list) || list.length === 0) return refuse('PORTABLE_USAGE');
  const out = new Map<EngineId, string | null>();
  for (const e of list) {
    if (!isEngineId(e?.id) || out.has(e.id)) return refuse('PORTABLE_USAGE');
    if (!listed.has(e.id)) return refuse('PORTABLE_ENGINE_NOT_LISTED', [e.id]);
    if (e.version !== undefined && (typeof e.version !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(e.version))) return refuse('PORTABLE_USAGE');
    out.set(e.id, e.version ?? listed.get(e.id) ?? null);
  }
  return ENGINE_IDS.filter(id => out.has(id)).map(id => ({ id, version: out.get(id)! }));
}

const isCommand = (s: SkillEntry): boolean => s.metadata?.[COMMAND_METADATA.key] === COMMAND_METADATA.value;

/** The 0.7 managed item that holds a skill folder, or null (ruling P27). */
function managedHolder(projectDir: string, folder: string): string | null {
  const name = folder.split('/')[2]!;
  const has = (rel: string): boolean => { try { fs.lstatSync(join(projectDir, rel)); return true; } catch { return false; } };
  const ids = [name, ...(name.startsWith('slice-') ? [`slice_${name.slice(6)}`] : [])];
  for (const id of ids) if (has(`.bowerloom/managed/catalog/${id}.json`) || has(`.bowerloom/managed/skills/${id}`)) return id;
  return has('.bowerloom-skills') && has(`.bowerloom-skills/skills/${name}`) ? name : null;
}

/**
 * The files of a skill folder and the hex of their skill content hash, as `sources.json` records it for a 0.7 managed
 * copy. Null when the folder holds anything but plain files and folders, or more than the loader reads.
 */
function folderContent(projectDir: string, folder: string): { readonly files: readonly string[]; readonly sha256: string } | null {
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (rel: string, depth: number): boolean => {
    if (depth > DEFINITION_LIMITS.depth) return false;
    let names: string[];
    try { names = fs.readdirSync(join(projectDir, folder, rel)); } catch { return false; }
    for (const n of names) {
      const r = rel ? `${rel}/${n}` : n;
      let st: fs.Stats;
      try { st = fs.lstatSync(join(projectDir, folder, r)); } catch { return false; }
      if (st.isDirectory() && !st.isSymbolicLink()) { if (!walk(r, depth + 1)) return false; continue; }
      if (!st.isFile() || files.length >= DEFINITION_LIMITS.files) return false;
      let got: ReturnType<typeof readProject>;
      try { got = readProject(projectDir, `${folder}/${r}`); } catch { return false; }
      if (!got) return false;
      files.push({ path: `skills/x/${r}`, bytes: got.bytes });
    }
    return true;
  };
  if (!walk('', 1)) return null;
  return { files: files.map(f => f.path.slice('skills/x/'.length)), sha256: skillContentHash('x', files).slice(REVISION_PREFIX.length) };
}

/**
 * The content hash of the canonical 0.7 copy a record names, or null. The path must be one of the two 0.7 forms for the
 * record's own id, and the catalog of that form must be a file that parses as a JSON object (review item K2).
 */
function canonicalHash(projectDir: string, record: AdoptedRecord): string | null {
  const [managed, v1] = adoptedPaths(record.id);
  const path = record.adoptedFrom.path;
  const catalog = path === managed ? `.bowerloom/managed/catalog/${record.id}.json` : path === v1 ? '.bowerloom-skills/catalog.json' : null;
  if (catalog === null) return null;
  let got: ReturnType<typeof readProject>;
  try { got = readProject(projectDir, catalog); } catch { return null; }
  const text = got ? decodeText(got.bytes) : null;
  const parsed = text === null ? null : parseStrictJson(text);
  if (!parsed?.ok || parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return null;
  return folderContent(projectDir, path)?.sha256 ?? null;
}

interface Target { bytes: Uint8Array; mode: number; engines: Set<EngineId> }

export function receiptFilesOf(changes: readonly PlannedChange[]): ReceiptFile[] {
  return changes.filter(c => c.after !== null).map(c => ({ path: c.path, ...c.after!, engines: c.engines, original: c.original }));
}
const isDir = (projectDir: string, rel: string): boolean => {
  try { if (checkAncestors(projectDir, rel + '/x').length) return false; const st = fs.lstatSync(join(projectDir, rel)); return st.isDirectory() && !st.isSymbolicLink(); } catch { return false; }
};

// ---- the plan ----------------------------------------------------------------------------------------------------------

/** Plans the projection. Reads only. A refusal is a PortableRefusal. */
export function planPortable(input: PortableInput): PortablePlan {
  return planWithBytes(input).plan;
}

/** The plan and the bytes of every path it writes. Apply takes the bytes from here, so plan and write never differ. */
export function planWithBytes(input: PortableInput): { readonly plan: PortablePlan; readonly bytes: ReadonlyMap<string, Uint8Array> } {
  if (input === null || typeof input !== 'object') return refuse('PORTABLE_USAGE');
  checkPaths(input.projectDir, input.stateDir);
  const { projectDir, stateDir } = input;
  if (pendingExists(stateDir)) refuse('PORTABLE_RECOVERY_REQUIRED');
  const reconcileWanted = input.reconcile ?? 'accept-agents';
  if (!RECONCILE_ACTIONS.includes(reconcileWanted)) refuse('PORTABLE_USAGE');
  const def = loadForProjection(input.definitionFolder);
  const engines = enginesOf(def, input.engines), ids = engines.map(e => e.id);
  const ignored: Ignored[] = [], offers: Offer[] = [];
  const previous = readReceipt(stateDir, projectDir);
  const owned = new Map((previous?.files ?? []).map(f => [f.path, f]));
  const recordedModes = readRecordedModes(stateDir, projectDir);

  // Section 4.1: the system prompt. No @path import, and at most 32 KiB.
  const instructions = def.instructions;
  if (instructions !== undefined) {
    const found = atImports(instructions, inProject(projectDir));
    if (found.length) refuse('PORTABLE_AT_IMPORT', found.map(f => `instructions/AGENTS.md line ${f.line}`));
    if (Buffer.byteLength(instructions) > INSTRUCTIONS_LIMIT) refuse('PORTABLE_INSTRUCTIONS_TOO_LARGE');
  }

  // Parts that are not projected yet. The locked-in parts are planned below, by locked.ts.
  const deferred: Deferred[] = [];
  const views = new Map(ids.map(id => [id, selectForEngine(def, id)] as const));
  for (const [engine, view] of views) {
    deferred.push(...def.scripts.map(id => ({ engine, part: 'scripts' as const, id })), ...view.enginePrivate.map(id => ({ engine, part: 'engine-private' as const, id })));
    for (const s of view.skills) if (s.privateBlocks[engine] !== undefined) deferred.push({ engine, part: 'skill-private', id: s.id });
  }
  if (input.codexTrust !== undefined && (input.codexTrust === null || typeof input.codexTrust !== 'object' || typeof input.codexTrust.folderTrusted !== 'boolean'
    || !Array.isArray(input.codexTrust.reviewedHooks) || input.codexTrust.reviewedHooks.some(h => typeof h !== 'string'))) refuse('PORTABLE_USAGE');
  if (input.approvals !== undefined && !Array.isArray(input.approvals)) refuse('PORTABLE_USAGE');
  const locked = planLocked({
    projectDir, stateDir, def, engines, views, owned, piTrustSaved: input.piTrustSaved === true, codexTrust: input.codexTrust ?? null,
  });

  // The targets: AGENTS.md, the skill folders, and CLAUDE.md when a person accepts AGENTS.md or the offer of P23.
  const targets = new Map<string, Target>();
  const add = (path: string, bytes: Uint8Array, mode: number, engine: EngineId): void => {
    const t = targets.get(path);
    if (t) t.engines.add(engine); else targets.set(path, { bytes, mode, engines: new Set([engine]) });
  };
  if (instructions !== undefined) for (const id of ids) add('AGENTS.md', Buffer.from(instructions), 0o644, id);
  for (const [path, t] of locked.targets) add(path, t.bytes, t.mode, t.engine);
  const files = new Map(def.files.map(f => [f.path, f]));
  const skillsById = new Map<string, SkillEntry>();
  for (const [engine, view] of views) for (const s of view.skills) {
    skillsById.set(s.id, s);
    for (const root of SKILL_ROOTS[engine]) for (const rel of s.files) {
      const f = files.get(`skills/${s.id}/${rel}`)!;
      add(`${root}/${s.name}/${rel}`, f.bytes, f.executable ? 0o755 : 0o644, engine);
    }
  }

  // Section 4.1, rules 4 to 6, and rulings P17, P22, P23. With no instructions, AGENTS.md and CLAUDE.md are not touched.
  let drift: InstructionDrift | null = null, reconcile: ReconcileAction | null = null, claudeLine: { result: 'exact' | 'weakened'; reason: string } | null = null;
  const addClaude = (): void => { for (const id of ids) add('CLAUDE.md', Buffer.from(FOLLOW_TEXT), 0o644, id); };
  if (instructions === undefined) {
    if (input.reconcile !== undefined) ignored.push({ option: 'reconcile', value: input.reconcile, reason: 'The definition has no instructions, so AGENTS.md and CLAUDE.md are not touched.' });
    if (input.writeClaudeMd !== undefined) ignored.push({ option: 'writeClaudeMd', value: input.writeClaudeMd, reason: 'The definition has no instructions, so AGENTS.md and CLAUDE.md are not touched.' });
  } else {
    const claude = readClaude(projectDir);
    drift = instructionDrift(projectDir, ids, true);
    if (drift) {
      reconcile = reconcileWanted;
      if (reconcile === 'merge') refuse('PORTABLE_MERGE_NOT_BUILT');
      if (reconcile === 'accept-agents') { addClaude(); claudeLine = { result: 'exact', reason: 'CLAUDE.md becomes the single line @AGENTS.md, so Claude Code loads AGENTS.md.' }; }
      else claudeLine = { result: 'weakened', reason: 'CLAUDE.md does not follow AGENTS.md, so Claude Code does not load AGENTS.md. Keep both leaves the drift reported.' };
      if (input.writeClaudeMd !== undefined) ignored.push({ option: 'writeClaudeMd', value: input.writeClaudeMd, reason: 'CLAUDE.md exists; the reconcile action decides what happens to it.' });
    } else {
      if (input.reconcile !== undefined) ignored.push({ option: 'reconcile', value: input.reconcile, reason: claude.kind === 'absent' ? 'There is no CLAUDE.md, so there is no drift to reconcile.' : 'CLAUDE.md already follows AGENTS.md, so there is no drift to reconcile.' });
      if (claude.kind === 'link-to-agents') claudeLine = { result: 'exact', reason: 'CLAUDE.md is a link to AGENTS.md, so Claude Code loads AGENTS.md. Bowerloom leaves the link in place.' };
      else if (claude.kind === 'file' || owned.has('CLAUDE.md')) {
        if (owned.has('CLAUDE.md')) addClaude();
        claudeLine = { result: 'exact', reason: 'CLAUDE.md is the single line @AGENTS.md, so Claude Code loads AGENTS.md.' };
        if (input.writeClaudeMd !== undefined) ignored.push({ option: 'writeClaudeMd', value: input.writeClaudeMd, reason: 'CLAUDE.md already follows AGENTS.md.' });
      } else if (ids.includes('claude-code')) {
        const version = engines.find(e => e.id === 'claude-code')!.version;
        const above = claudeFilesAbove(projectDir), atLeast = versionAtLeast(version, CLAUDE_CODE_READS_AGENTS);
        const why: string[] = [];
        if (above.length) why.push(`Claude Code reads AGENTS.md only when no CLAUDE.md or CLAUDE.local.md exists at or above the project, and these exist: ${above.join(', ')}.`);
        if (atLeast === false) why.push(`Claude Code ${version} is older than ${CLAUDE_CODE_READS_AGENTS}, the first version that reads AGENTS.md.`);
        if (why.length === 0) {
          claudeLine = { result: 'exact', reason: `No CLAUDE.md exists, so Claude Code ${CLAUDE_CODE_READS_AGENTS} or later reads AGENTS.md.${atLeast === null ? ' The Claude Code version is not known, so this assumes a version that reads AGENTS.md.' : ''}` };
          if (input.writeClaudeMd !== undefined) ignored.push({ option: 'writeClaudeMd', value: input.writeClaudeMd, reason: 'Claude Code already reads AGENTS.md here.' });
        } else if (input.writeClaudeMd === true) {
          addClaude(); claudeLine = { result: 'exact', reason: 'CLAUDE.md becomes the single line @AGENTS.md, so Claude Code loads AGENTS.md.' };
        } else {
          claudeLine = { result: 'weakened', reason: why.join(' ') };
          offers.push({ action: 'write-claude-md', reason: `${why.join(' ')} Writing CLAUDE.md as @AGENTS.md makes Claude Code load AGENTS.md.` });
        }
      } else if (input.writeClaudeMd !== undefined) ignored.push({ option: 'writeClaudeMd', value: input.writeClaudeMd, reason: 'The projection does not include Claude Code.' });
    }
  }
  if (input.piTrustSaved !== undefined && !ids.includes('pi')) ignored.push({ option: 'piTrustSaved', value: input.piTrustSaved, reason: 'The projection does not include Pi.' });
  if (input.codexTrust !== undefined && !ids.includes('codex')) ignored.push({ option: 'codexTrust', value: input.codexTrust.folderTrusted, reason: 'The projection does not include Codex.' });

  // Case clashes, among the targets and against the files on disk (ruling P6).
  const folded = new Map<string, string>(), clashes: string[] = [], listing = new Map<string, string[] | null>();
  for (const path of targets.keys()) {
    const key = path.toLowerCase(), other = folded.get(key);
    if (other !== undefined) clashes.push(`${other} and ${path}`); else folded.set(key, path);
    for (const c of caseClashes(projectDir, path, listing)) clashes.push(`${path} and ${c}`);
  }
  if (clashes.length) refuse('PORTABLE_CASE_CLASH', [...new Set(clashes)]);

  // Skill folders that Bowerloom did not project are never written into. A folder that a 0.7 managed copy holds is taken
  // only when sources.json records that the skill was adopted from that copy, and the folder still holds exactly it:
  // its files are then replaced, with their originals saved, so removal restores the 0.7 copy (step 3 contract).
  const occupied: string[] = [], managed: string[] = [];
  const folders = new Set([...targets.keys()].filter(p => p.startsWith('.claude/skills/') || p.startsWith('.agents/skills/')).map(p => p.split('/').slice(0, 3).join('/')));
  for (const folder of [...folders].sort(byBytes)) {
    if ([...owned.keys()].some(p => p.startsWith(folder + '/'))) continue;
    if (checkAncestors(projectDir, folder + '/x').length) continue;
    const holder = managedHolder(projectDir, folder);
    if (holder === null) { occupied.push(folder); continue; }
    const name = folder.split('/')[2]!;
    const record = def.adopted.find(a => a.part === 'skills' && a.id === name);
    const held = record ? folderContent(projectDir, folder) : null;
    // Review item K2: a cloned repository can forge the marker and the record, so the real canonical copy is read too.
    const canonical = record ? canonicalHash(projectDir, record) : null;
    if (record && held && canonical !== null && held.sha256 === record.adoptedFrom.sha256 && canonical === record.adoptedFrom.sha256
      && held.files.every(f => targets.has(`${folder}/${f}`))) continue;
    managed.push(`${folder} (0.7 item ${holder})`);
  }
  if (managed.length) refuse('PORTABLE_MANAGED_COPY', managed);
  if (occupied.length) refuse('PORTABLE_PATH_OCCUPIED', occupied);

  // The changes, against the receipt and the files on disk.
  const changes: PlannedChange[] = [], drifted: string[] = [];
  const createDirs = new Set<string>();
  for (const path of [...new Set([...targets.keys(), ...owned.keys()])].sort(byBytes)) {
    const target = targets.get(path), mine = owned.get(path);
    const now = stateOrUnsafe(projectDir, path);
    if (now === 'unsafe') { if (!mine) refuse('PORTABLE_PATH_UNSAFE', [path]); drifted.push(`${path} (unsafe)`); continue; }
    if (mine && !sameState(now, mine)) { drifted.push(`${path} (${driftReason(now, mine)})`); continue; }
    if (target) for (const d of checkAncestors(projectDir, path)) createDirs.add(d);
    if (!target) {
      if (mine!.original) blob(stateDir, mine!.original, path);
      changes.push({ path, action: mine!.original ? 'restore' : 'delete', before: now, after: null, original: mine!.original, engines: [] });
      continue;
    }
    // Decision D5A: a recorded mode stays while the plan still wants the content and mode it was recorded against.
    const rec = recordedModes.get(path), want = sha(target.bytes);
    const keepMode = mine !== undefined && rec !== undefined && rec.sha256 === want && mine.sha256 === want && mine.mode === rec.recorded && target.mode === rec.planned;
    const after: FileAfter = { sha256: want, mode: keepMode ? mine.mode : target.mode, bytes: target.bytes.length };
    const action: ChangeAction = mine ? (sameState(now, after) ? 'unchanged' : 'update') : now === null ? 'create' : 'replace';
    if (mine?.original) blob(stateDir, mine.original, path);
    changes.push({ path, action, before: now, after, original: mine ? mine.original : now, engines: ENGINE_IDS.filter(e => target.engines.has(e)) });
  }
  if (drifted.length) refuse('PORTABLE_DRIFT', drifted);

  // Engines being projected that load a skill their filter leaves out, because they read its folder (ruling P19).
  const filterLeaks: FilterLeak[] = [];
  for (const s of [...skillsById.values()].sort((a, b) => byBytes(a.id, b.id))) {
    for (const root of ['.claude/skills', '.agents/skills'] as const) {
      if (!targets.has(`${root}/${s.name}/SKILL.md`)) continue;
      const leak = ids.filter(e => SKILL_ROOTS[e].includes(root) && !appliesTo(s, e));
      if (leak.length) filterLeaks.push({ skill: s.id, path: `${root}/${s.name}`, engines: leak });
    }
  }

  const report = lossReport(def, engines, views, claudeLine, filterLeaks, input.piTrustSaved === true, locked.lines, input.approvals ?? []);
  const approved = report.approved;
  // Rulings B7 and B18: a sentence about the engine version goes on every line of that engine.
  const loss = report.loss.map(l => (locked.notes.has(l.engine) ? { ...l, reason: l.reason + locked.notes.get(l.engine)! } : l));
  const pendingTrust = ids.includes('pi') && input.piTrustSaved !== true ? views.get('pi')!.skills.map(s => s.id) : [];
  const partial = loss.some(l => l.result === 'absent') || deferred.length > 0;

  // Sources of the borrowed skills (ruling P18).
  const projected = new Set(skillsById.keys());
  const sources: ReceiptSource[] = def.sources.flatMap(s => s.items.filter(i => i.part === 'skills' && projected.has(i.id)).map(i => ({ skill: i.id, name: s.name, marketplace: s.marketplace, version: s.version, ...(s.claimed ? { claimed: true as const } : {}) })))
    .sort((a, b) => byBytes(a.skill, b.skill));

  const definition = { folder: def.folder, harness: def.harness.id, revision: def.revision };
  const receiptFiles = receiptFilesOf(changes);
  const existing = (previous?.createdDirs ?? []).filter(d => isDir(projectDir, d));
  const createdDirs = [...new Set([...existing, ...createDirs])].sort(byBytes);
  const sameReceipt = previous !== null && canonicalJson({ d: previous.definition, e: previous.engines, f: previous.files, s: previous.sources, c: existing, a: previous.approvals })
    === canonicalJson({ d: definition, e: engines, f: receiptFiles, s: sources, c: createdDirs, a: approved });
  const noop = changes.every(c => c.action === 'unchanged') && sameReceipt;
  const body = {
    format: PORTABLE_PLAN_FORMAT, projectDir, stateDir, definition, engines, changes, createDirs: [...createDirs].sort(byBytes), createdDirs, sources,
    drift, reconcile, loss, partial, notice: partial ? PARTIAL_NOTICE : null, deferred, filterLeaks, pendingTrust, ignored, offers,
    trust: locked.trust, review: locked.review, approved, previousReceipt: previous?.revision ?? null, noop, writesAuthorized: false as const,
  };
  const bytes = new Map([...targets].map(([path, t]) => [path, t.bytes] as const));
  return { plan: { ...body, revision: revisionOf(body) }, bytes };
}

/** The parts of the loss report that go through the fidelity check (ruling P14, and step 3 for the locked-in parts). */
const CHECKED_PARTS: readonly LossPart[] = ['system-prompt', 'memory', 'tool-guidance', 'skills', ...LOCKED_PARTS];

/**
 * The loss report (section 6; ruling P14): every part the harness lists gets lines for every engine being projected.
 * An empty part gets one `exact` line, entry `(none)`. The locked-in parts get the lines of their translations. Every
 * line of an entry goes through the fidelity check with the recorded approvals: an enforced entry that is weakened or
 * absent with no matching approval refuses PORTABLE_FIDELITY, and the refusal carries the refused lines (`refused`).
 */
function lossReport(
  def: Definition, engines: readonly PortableEngine[], views: ReadonlyMap<EngineId, ReturnType<typeof selectForEngine>>,
  claudeLine: { result: 'exact' | 'weakened'; reason: string } | null, leaks: readonly FilterLeak[], trustSaved: boolean,
  locked: ReadonlyMap<EngineId, ReadonlyMap<LockedPart, readonly LossLine[]>>, approvals: readonly unknown[],
): { loss: LossLine[]; approved: FidelityApproval[] } {
  const loss: LossLine[] = [], leakLines = new Set<LossLine>();
  const parts = def.harness.parts as Record<string, unknown>;
  const listed = PART_KEYS.filter(k => parts[k] !== undefined);
  const none = (part: PartKey, engine: EngineId): void => { loss.push({ part, entry: NOTHING, engine, result: 'exact', reason: 'Nothing to project.' }); };
  for (const { id: engine } of engines) {
    const view = views.get(engine)!;
    for (const part of listed) {
      if (part === 'system-prompt') {
        const line = engine === 'claude-code' && claudeLine ? claudeLine
          : { result: 'exact' as const, reason: engine === 'pi' ? 'Pi reads AGENTS.md, and AGENTS.md hides CLAUDE.md.' : 'The engine reads AGENTS.md as written.' };
        loss.push({ part, entry: 'AGENTS.md', engine, ...line });
      } else if (part === 'memory') {
        loss.push({ part, entry: 'instructions', engine, result: 'translated', reason: 'Standing facts project as instructions in AGENTS.md. Engine-written memory is runtime state and is not projected.' });
      } else if (part === 'tool-guidance') {
        const pointers = def.harness.parts['tool-guidance'] ?? [];
        if (pointers.length === 0) none(part, engine);
        for (const pointer of pointers) {
          const skill = /^skills\/(.+)$/.exec(pointer)?.[1];
          if (skill !== undefined && !view.skills.some(s => s.id === skill)) loss.push({ part, entry: pointer, engine, result: 'absent', reason: `The skill ${skill} is filtered out for ${engine}, so its tool guidance does not reach it.` });
          else loss.push({ part, entry: pointer, engine, result: 'exact', reason: skill !== undefined ? 'Tool guidance projects as the body of a skill.' : 'Tool guidance projects as a section of AGENTS.md.' });
        }
      } else if (part === 'skills') {
        if (view.skills.length === 0) none(part, engine);
        for (const s of view.skills) {
          const trust = engine === 'pi' && !trustSaved ? ' Pending trust: Pi skips project .agents/skills in non-interactive runs until a person saves trust.' : '';
          loss.push(isCommand(s)
            ? { part, entry: s.id, engine, result: 'translated', reason: `A command projects as a skill in ${SKILL_ROOTS[engine].join(' and ')}. Bowerloom writes no command file.${trust}` }
            : { part, entry: s.id, engine, result: 'exact', reason: `The engine reads ${SKILL_ROOTS[engine].join(' and ')}.${trust}` });
          if (s.privateBlocks[engine] !== undefined) loss.push({ part, entry: s.id, field: `x-${engine}`, engine, result: 'absent', reason: LOCKED_IN_REASON });
        }
        for (const leak of leaks) if (leak.engines.includes(engine)) {
          const line: LossLine = { part, entry: leak.skill, engine, result: 'weakened', reason: `The engine filter of ${leak.skill} leaves ${engine} out, but ${engine} reads ${leak.path}, so it loads the skill.` };
          loss.push(line); leakLines.add(line);
        }
      } else if (part === 'plugins') {
        if (def.sources.length === 0) none(part, engine);
        for (const s of def.sources) loss.push({ part, entry: s.name, engine, result: 'translated', reason: 'A plugin is unpacked into its items. The receipt records the source, marketplace, and version of each borrowed skill.' });
      } else if ((LOCKED_PARTS as readonly PartKey[]).includes(part)) {
        const lines = locked.get(engine)?.get(part as LockedPart) ?? [];
        if (lines.length === 0) none(part, engine);
        loss.push(...lines);
      } else {
        const entries: readonly { id: string }[] = part === 'scripts' ? def.scripts.map(id => ({ id })) : [];
        if (entries.length === 0) none(part, engine);
        for (const e of entries) loss.push({ part, entry: e.id, engine, result: 'absent', reason: LOCKED_IN_REASON });
      }
    }
    // Review item V12 and the step 3 contract: a file under engines/<engine>/ has the loss-line part engine-private.
    for (const file of view.enginePrivate) loss.push({ part: 'engine-private', entry: `engines/${engine}/${file}`, engine, result: 'absent', reason: LOCKED_IN_REASON });
  }
  const has = (part: PartKey): boolean => listed.includes(part);
  const e = def.entries;
  const entries = {
    skills: has('skills') ? e.skills : [], subagents: has('subagents') ? e.subagents : [], rules: has('guardrails') ? e.rules : [],
    sandbox: has('guardrails') ? e.sandbox : [], hooks: has('hooks') ? e.hooks : [], mcp: has('mcp') ? e.mcp : [],
  };
  const checked = loss.filter(l => CHECKED_PARTS.includes(l.part) && l.entry !== NOTHING && !leakLines.has(l));
  const verdict = checkFidelity({ entries, engines: engines.map(x => x.id) }, checked, approvals);
  if (verdict.problems.length) refuse('PORTABLE_FIDELITY', [...new Set(verdict.problems.map(p => p.code))], verdict.problems);
  if (verdict.refused.length) {
    const paths = verdict.refused.map(l => `${l.part}/${l.entry}${l.field ? `.${l.field}` : ''} in ${l.engine} (${l.result})`);
    throw Object.assign(new PortableRefusal('PORTABLE_FIDELITY', paths), { refused: verdict.refused });
  }
  const approved: FidelityApproval[] = [];
  for (const a of verdict.approved) if (!approved.includes(a.approval)) approved.push(a.approval);
  return { loss, approved };
}
